const DEFAULT_LEASE_MS = 60_000;

export class ControlGate {
  readonly #leaseMs: number;
  #humanClientId: string | null = null;
  #expiresAt = 0;
  #agentActive = false;
  #waiters = new Set<() => void>();
  #expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(leaseMs = DEFAULT_LEASE_MS) {
    this.#leaseMs = leaseMs;
  }

  async runAgent<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    while (this.#activeHuman() !== null) await this.#wait(signal);
    this.#agentActive = true;
    try {
      return await operation();
    } finally {
      this.#agentActive = false;
      this.#notify();
    }
  }

  async acquire(clientId: string, signal: AbortSignal): Promise<"human" | "busy"> {
    const owner = this.#activeHuman();
    if (owner !== null) {
      if (owner !== clientId) return "busy";
      this.#renew();
      return "human";
    }
    while (this.#agentActive) await this.#wait(signal);
    if (this.#activeHuman() !== null) return this.#humanClientId === clientId ? "human" : "busy";
    this.#humanClientId = clientId;
    this.#renew();
    return "human";
  }

  owns(clientId: string): boolean {
    return this.#activeHuman() === clientId;
  }

  statusFor(clientId: string): "you" | "other" | "agent" {
    const owner = this.#activeHuman();
    if (owner === null) return "agent";
    return owner === clientId ? "you" : "other";
  }

  release(clientId: string): boolean {
    if (this.#activeHuman() !== clientId) return false;
    this.#clearHuman();
    return true;
  }

  dispose(): void {
    this.#clearHuman();
  }

  #activeHuman(): string | null {
    if (this.#humanClientId !== null && Date.now() >= this.#expiresAt) this.#clearHuman();
    return this.#humanClientId;
  }

  #renew(): void {
    this.#expiresAt = Date.now() + this.#leaseMs;
    if (this.#expiryTimer !== null) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = setTimeout(() => {
      this.#activeHuman();
    }, this.#leaseMs + 1);
    this.#expiryTimer.unref?.();
  }

  #clearHuman(): void {
    if (this.#expiryTimer !== null) clearTimeout(this.#expiryTimer);
    this.#expiryTimer = null;
    this.#humanClientId = null;
    this.#expiresAt = 0;
    this.#notify();
  }

  #notify(): void {
    for (const resolve of this.#waiters) resolve();
    this.#waiters.clear();
  }

  #wait(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    return new Promise<void>((resolve, reject) => {
      const done = () => {
        signal.removeEventListener("abort", aborted);
        resolve();
      };
      const aborted = () => {
        this.#waiters.delete(done);
        reject(signal.reason ?? new Error("Aborted"));
      };
      this.#waiters.add(done);
      signal.addEventListener("abort", aborted, { once: true });
    });
  }
}

const GATES = new Map<string, ControlGate>();

export function controlGateForHost(hostId: string): ControlGate {
  let gate = GATES.get(hostId);
  if (gate === undefined) {
    gate = new ControlGate();
    GATES.set(hostId, gate);
  }
  return gate;
}

export function disposeControlGate(hostId: string): void {
  const gate = GATES.get(hostId);
  gate?.dispose();
  GATES.delete(hostId);
}
