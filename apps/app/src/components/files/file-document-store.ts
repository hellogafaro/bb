import { createContext, useContext } from "react";
import {
  useFilesTransport,
  type FileLocation,
  type FilesTransport,
} from "./files-transport";

export interface DiskFile {
  content: string;
  encoding: "utf8" | "base64";
  mimeType: string | null;
  sha256: string;
}

export type DiskState =
  | { status: "loading" }
  | { status: "ready"; file: DiskFile }
  | { status: "missing" }
  | { status: "error"; message: string };

export interface DiskChange {
  state: DiskState;
  writer: object | null;
}

export interface Draft {
  text: string;
  baseSha256: string;
}

type WriteOutcome =
  | { outcome: "written"; sha256: string }
  | { outcome: "conflict"; currentSha256: string | null };

interface DocumentSubscription {
  setActive(active: boolean): void;
  unsubscribe(): void;
}

interface Subscriber {
  active: boolean;
  listener: (change: DiskChange) => void;
}

interface Entry {
  location: FileLocation;
  state: DiskState;
  subscribers: Set<Subscriber>;
  generation: number;
  loadToken: number;
  loading: boolean;
  polling: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  dueAt: number;
  changedAt: number;
  draft: Draft | null;
  writes: Promise<unknown>;
}

export interface PollTiming {
  fastMs: number;
  slowMs: number;
  recentChangeMs: number;
}

const DEFAULT_POLL_TIMING: PollTiming = {
  fastMs: 1_500,
  slowMs: 5_000,
  recentChangeMs: 30_000,
};

export function fileLocationKey(location: FileLocation): string {
  return `${location.hostId}\u0000${location.absolutePath}`;
}

function sameDiskState(left: DiskState, right: DiskState): boolean {
  switch (left.status) {
    case "loading":
    case "missing":
      return right.status === left.status;
    case "error":
      return right.status === "error" && right.message === left.message;
    case "ready":
      return (
        right.status === "ready" &&
        right.file.sha256 === left.file.sha256 &&
        right.file.encoding === left.file.encoding
      );
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class FileDocumentStore {
  private readonly entries = new Map<string, Entry>();
  private visibilityListener: (() => void) | null = null;

  constructor(
    private readonly transport: FilesTransport,
    private readonly timing: PollTiming = DEFAULT_POLL_TIMING,
  ) {}

  getState(location: FileLocation): DiskState {
    return (
      this.entries.get(fileLocationKey(location))?.state ?? {
        status: "loading",
      }
    );
  }

  subscribe(
    location: FileLocation,
    listener: (change: DiskChange) => void,
  ): DocumentSubscription {
    const entry = this.ensureEntry(location);
    const subscriber: Subscriber = { active: false, listener };
    entry.subscribers.add(subscriber);
    if (entry.state.status === "loading" && !entry.loading) {
      void this.load(entry);
    }
    return {
      setActive: (active) => {
        if (subscriber.active === active) return;
        subscriber.active = active;
        if (active) this.schedulePoll(entry, 0);
        else if (!this.isPolled(entry)) this.clearTimer(entry);
      },
      unsubscribe: () => {
        entry.subscribers.delete(subscriber);
        if (entry.subscribers.size > 0) return;
        this.clearTimer(entry);
        void entry.writes.finally(() => this.release(entry));
      },
    };
  }

  touch(location: FileLocation): void {
    const entry = this.entries.get(fileLocationKey(location));
    if (entry === undefined) return;
    const now = Date.now();
    entry.changedAt = now;
    if (entry.timer !== null && entry.dueAt - now > this.timing.fastMs) {
      this.schedulePoll(entry, this.timing.fastMs);
    }
  }

  reload(location: FileLocation): Promise<void> {
    return this.load(this.ensureEntry(location));
  }

  takeDraft(location: FileLocation): Draft | null {
    const entry = this.entries.get(fileLocationKey(location));
    if (entry === undefined) return null;
    const draft = entry.draft;
    entry.draft = null;
    return draft;
  }

  retainDraft(location: FileLocation, draft: Draft): void {
    const entry = this.ensureEntry(location);
    entry.draft = draft;
  }

  async flushDraft(
    location: FileLocation,
    draft: Draft,
    writer: object,
  ): Promise<WriteOutcome> {
    const entry = this.ensureEntry(location);
    entry.draft = draft;
    try {
      const result = await this.write(
        location,
        draft.text,
        draft.baseSha256,
        writer,
      );
      if (result.outcome === "written" && entry.draft === draft) {
        entry.draft = null;
      }
      return result;
    } finally {
      this.release(entry);
    }
  }

  write(
    location: FileLocation,
    content: string,
    expectedSha256: string | null,
    writer: object,
  ): Promise<WriteOutcome> {
    const entry = this.ensureEntry(location);
    const run = async (): Promise<WriteOutcome> => {
      entry.generation += 1;
      try {
        const result = await this.transport.write(
          entry.location,
          content,
          expectedSha256,
        );
        entry.generation += 1;
        if (result.outcome === "conflict") {
          if (result.currentSha256 === null) {
            this.setState(entry, { status: "missing" }, null);
          } else {
            void this.load(entry);
          }
          return {
            outcome: "conflict",
            currentSha256: result.currentSha256,
          };
        }
        const previous =
          entry.state.status === "ready" ? entry.state.file : null;
        entry.changedAt = Date.now();
        this.setState(
          entry,
          {
            status: "ready",
            file: {
              content,
              encoding: "utf8",
              mimeType: previous?.mimeType ?? null,
              sha256: result.sha256,
            },
          },
          writer,
        );
        return { outcome: "written", sha256: result.sha256 };
      } catch (error) {
        entry.generation += 1;
        throw error;
      }
    };
    const next = entry.writes.then(run, run);
    entry.writes = next.catch(() => undefined);
    return next;
  }

  async remove(location: FileLocation): Promise<void> {
    const entry = this.ensureEntry(location);
    const run = async () => {
      entry.generation += 1;
      try {
        await this.transport.remove(entry.location);
      } finally {
        entry.generation += 1;
      }
      entry.draft = null;
      this.setState(entry, { status: "missing" }, null);
    };
    const next = entry.writes.then(run, run);
    entry.writes = next.catch(() => undefined);
    await next;
  }

  private ensureEntry(location: FileLocation): Entry {
    const key = fileLocationKey(location);
    const existing = this.entries.get(key);
    if (existing !== undefined) return existing;
    const entry: Entry = {
      location,
      state: { status: "loading" },
      subscribers: new Set(),
      generation: 0,
      loadToken: 0,
      loading: false,
      polling: false,
      timer: null,
      dueAt: 0,
      changedAt: 0,
      draft: null,
      writes: Promise.resolve(),
    };
    this.entries.set(key, entry);
    this.retainVisibilityListener();
    return entry;
  }

  private release(entry: Entry): void {
    const key = fileLocationKey(entry.location);
    if (
      entry.subscribers.size > 0 ||
      entry.draft !== null ||
      this.entries.get(key) !== entry
    ) {
      return;
    }
    this.clearTimer(entry);
    this.entries.delete(key);
    this.releaseVisibilityListener();
  }

  private async load(entry: Entry): Promise<void> {
    entry.generation += 1;
    const generation = entry.generation;
    entry.loadToken += 1;
    const loadToken = entry.loadToken;
    entry.loading = true;
    try {
      const file = await this.transport.read(entry.location);
      if (generation !== entry.generation) return;
      this.setState(
        entry,
        {
          status: "ready",
          file: {
            content: file.content,
            encoding: file.contentEncoding,
            mimeType: file.mimeType ?? null,
            sha256: file.sha256,
          },
        },
        null,
      );
    } catch (error) {
      if (generation !== entry.generation) return;
      this.setState(
        entry,
        this.transport.isMissing(error)
          ? { status: "missing" }
          : { status: "error", message: errorMessage(error) },
        null,
      );
    } finally {
      if (loadToken === entry.loadToken) entry.loading = false;
      if (entry.timer === null) this.schedulePoll(entry, this.pollDelay(entry));
    }
  }

  private async poll(entry: Entry): Promise<void> {
    const state = entry.state;
    if (entry.loading) return;
    if (state.status === "missing") {
      await this.load(entry);
      return;
    }
    if (state.status !== "ready") return;
    const generation = entry.generation;
    entry.polling = true;
    try {
      const result = await this.transport.readIfChanged(
        entry.location,
        state.file.sha256,
      );
      if (generation !== entry.generation || "notModified" in result) return;
      this.setState(
        entry,
        {
          status: "ready",
          file: {
            content: result.content,
            encoding: result.contentEncoding,
            mimeType: result.mimeType ?? null,
            sha256: result.sha256,
          },
        },
        null,
      );
    } catch (error) {
      if (generation !== entry.generation) return;
      if (this.transport.isMissing(error)) {
        this.setState(entry, { status: "missing" }, null);
      }
    } finally {
      entry.polling = false;
    }
  }

  private pollDelay(entry: Entry): number {
    return Date.now() - entry.changedAt < this.timing.recentChangeMs
      ? this.timing.fastMs
      : this.timing.slowMs;
  }

  private isPolled(entry: Entry): boolean {
    if (
      typeof document !== "undefined" &&
      document.visibilityState !== "visible"
    ) {
      return false;
    }
    for (const subscriber of entry.subscribers) {
      if (subscriber.active) return true;
    }
    return false;
  }

  private schedulePoll(entry: Entry, delayMs: number): void {
    this.clearTimer(entry);
    if (!this.isPolled(entry)) return;
    entry.dueAt = Date.now() + delayMs;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      if (entry.polling || !this.isPolled(entry)) return;
      void this.poll(entry).finally(() => {
        if (entry.timer === null) {
          this.schedulePoll(entry, this.pollDelay(entry));
        }
      });
    }, delayMs);
  }

  private clearTimer(entry: Entry): void {
    if (entry.timer === null) return;
    clearTimeout(entry.timer);
    entry.timer = null;
  }

  private setState(
    entry: Entry,
    state: DiskState,
    writer: object | null,
  ): void {
    if (writer === null && sameDiskState(entry.state, state)) return;
    if (writer === null && entry.state.status !== "loading") {
      entry.changedAt = Date.now();
    }
    entry.state = state;
    for (const subscriber of [...entry.subscribers]) {
      subscriber.listener({ state, writer });
    }
  }

  private retainVisibilityListener(): void {
    if (this.visibilityListener !== null || typeof document === "undefined") {
      return;
    }
    this.visibilityListener = () => {
      for (const entry of this.entries.values()) {
        this.schedulePoll(entry, 0);
      }
    };
    document.addEventListener("visibilitychange", this.visibilityListener);
  }

  private releaseVisibilityListener(): void {
    if (this.entries.size > 0 || this.visibilityListener === null) return;
    document.removeEventListener("visibilitychange", this.visibilityListener);
    this.visibilityListener = null;
  }
}

const stores = new WeakMap<FilesTransport, FileDocumentStore>();

export const FileDocumentStoreContext = createContext<FileDocumentStore | null>(
  null,
);

export function useFileDocumentStore(): FileDocumentStore {
  const provided = useContext(FileDocumentStoreContext);
  const transport = useFilesTransport();
  if (provided !== null) return provided;
  let store = stores.get(transport);
  if (store === undefined) {
    store = new FileDocumentStore(transport);
    stores.set(transport, store);
  }
  return store;
}
