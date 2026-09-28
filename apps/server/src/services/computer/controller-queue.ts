import { randomUUID } from "node:crypto";

export interface ControllerLease {
  readonly leaseId: string;
  readonly runId: string;
  readonly acquiredAt: number;
  readonly expiresAt: number;
  release(): void;
}

interface Pending {
  readonly runId: string;
  readonly enqueuedAt: number;
  readonly resolve: (lease: ControllerLease) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  abortListener: (() => void) | null;
}

interface ActiveLease {
  readonly leaseId: string;
  readonly runId: string;
  readonly acquiredAt: number;
  expiresAt: number;
}

export class SingleControllerQueue {
  readonly #leaseTtlMs: number;
  readonly #maxQueueLength: number;
  readonly #now: () => number;
  readonly #pending: Pending[] = [];
  #active: ActiveLease | null = null;
  #expiryTimer: ReturnType<typeof setTimeout> | null = null;
  #closed = false;

  constructor(options: { leaseTtlMs?: number; maxQueueLength?: number; now?: () => number } = {}) {
    this.#leaseTtlMs = options.leaseTtlMs ?? 30_000;
    this.#maxQueueLength = options.maxQueueLength ?? 50;
    this.#now = options.now ?? Date.now;
  }

  acquire(runId: string, signal: AbortSignal): Promise<ControllerLease> {
    if (this.#closed) return Promise.reject(new Error("Controller queue is closed"));
    this.reapExpired();
    if (signal.aborted) return Promise.reject(new Error("Run cancelled while queued"));
    if (this.#pending.length >= this.#maxQueueLength) return Promise.reject(new Error("Controller queue is full"));
    if (this.#active?.runId === runId || this.#pending.some((entry) => entry.runId === runId)) {
      return Promise.reject(new Error("Run already owns or awaits this machine's controller"));
    }
    return new Promise<ControllerLease>((resolve, reject) => {
      const pending: Pending = { runId, enqueuedAt: this.#now(), resolve, reject, signal, abortListener: null };
      pending.abortListener = () => {
        const index = this.#pending.indexOf(pending);
        if (index >= 0) this.#pending.splice(index, 1);
        reject(new Error("Run cancelled while queued"));
      };
      signal.addEventListener("abort", pending.abortListener, { once: true });
      this.#pending.push(pending);
      this.#dispatch();
    });
  }

  reapExpired(): void {
    if (this.#active !== null && this.#active.expiresAt <= this.#now()) {
      this.#clearExpiry();
      this.#active = null;
      this.#dispatch();
    }
  }

  #dispatch(): void {
    if (this.#active !== null) return;
    while (this.#pending.length > 0) {
      const pending = this.#pending.shift();
      if (pending === undefined) return;
      if (pending.abortListener !== null) pending.signal.removeEventListener("abort", pending.abortListener);
      if (pending.signal.aborted) {
        pending.reject(new Error("Run cancelled while queued"));
        continue;
      }
      const acquiredAt = this.#now();
      const active: ActiveLease = { leaseId: randomUUID(), runId: pending.runId, acquiredAt, expiresAt: acquiredAt + this.#leaseTtlMs };
      this.#active = active;
      this.#scheduleExpiry(active);
      let released = false;
      pending.resolve({
        leaseId: active.leaseId,
        runId: active.runId,
        acquiredAt,
        get expiresAt() {
          return active.expiresAt;
        },
        release: () => {
          if (released) return;
          released = true;
          if (this.#active?.leaseId === active.leaseId) {
            this.#clearExpiry();
            this.#active = null;
            this.#dispatch();
          }
        },
      });
      return;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#clearExpiry();
    this.#active = null;
    for (const pending of this.#pending.splice(0)) {
      if (pending.abortListener !== null) pending.signal.removeEventListener("abort", pending.abortListener);
      pending.reject(new Error("Controller queue closed"));
    }
  }

  #scheduleExpiry(active: ActiveLease): void {
    this.#clearExpiry();
    this.#expiryTimer = setTimeout(() => {
      if (this.#active?.leaseId !== active.leaseId) return;
      this.#active = null;
      this.#expiryTimer = null;
      this.#dispatch();
    }, Math.max(0, active.expiresAt - this.#now()));
    this.#expiryTimer.unref?.();
  }

  #clearExpiry(): void {
    if (this.#expiryTimer !== null) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
  }
}

const QUEUES = new Map<string, SingleControllerQueue>();

export function controllerQueueForHost(hostId: string): SingleControllerQueue {
  let queue = QUEUES.get(hostId);
  if (queue === undefined) {
    queue = new SingleControllerQueue();
    QUEUES.set(hostId, queue);
  }
  return queue;
}

export function disposeControllerQueue(hostId: string): void {
  const queue = QUEUES.get(hostId);
  queue?.close();
  QUEUES.delete(hostId);
}
