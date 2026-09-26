import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileReadResult } from "@bb/sdk/browser";
import {
  FileDocumentStore,
  type DiskChange,
  type PollTiming,
} from "./file-document-store";
import type { FileLocation, FilesTransport } from "./files-transport";

const LOCATION: FileLocation = {
  hostId: "host-1",
  absolutePath: "/repo/a.ts",
  rootPath: "/repo",
};

class MissingError extends Error {}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function readResult(content: string, sha256: string): FileReadResult {
  return {
    path: LOCATION.absolutePath,
    content,
    contentEncoding: "utf8",
    sizeBytes: content.length,
    sha256,
  };
}

function fakeTransport(disk: { content: string; sha256: string } | null) {
  const state = { disk };
  const transport: FilesTransport = {
    read: vi.fn(async () => {
      if (state.disk === null) throw new MissingError("gone");
      return readResult(state.disk.content, state.disk.sha256);
    }),
    readIfChanged: vi.fn(async (_location, sha256) => {
      if (state.disk === null) throw new MissingError("gone");
      if (state.disk.sha256 === sha256) {
        const { content: _content, ...metadata } = readResult(
          state.disk.content,
          sha256,
        );
        return { ...metadata, notModified: true as const };
      }
      return readResult(state.disk.content, state.disk.sha256);
    }),
    write: vi.fn(async (_location, content, expectedSha256) => {
      const current = state.disk?.sha256 ?? null;
      if (expectedSha256 !== current) {
        return { outcome: "conflict" as const, currentSha256: current };
      }
      const sha256 = `sha-${content}`;
      state.disk = { content, sha256 };
      return { outcome: "written" as const, sha256, sizeBytes: content.length };
    }),
    remove: vi.fn(async () => {
      state.disk = null;
    }),
    listDirectory: vi.fn(async () => []),
    search: vi.fn(async () => []),
    isMissing: (error) => error instanceof MissingError,
    isTooLarge: () => false,
  };
  return { transport, state };
}

function timing(ms: number): PollTiming {
  return { fastMs: ms, slowMs: ms, recentChangeMs: 0 };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

describe("FileDocumentStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads once and polls once per interval for every tab on a file", async () => {
    const { transport } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, timing(100));
    const first = store.subscribe(LOCATION, () => undefined);
    const second = store.subscribe(LOCATION, () => undefined);
    first.setActive(true);
    second.setActive(true);
    await flush();
    expect(transport.read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    const afterActivation = vi.mocked(transport.readIfChanged).mock.calls.length;
    await vi.advanceTimersByTimeAsync(100);
    expect(transport.readIfChanged).toHaveBeenCalledTimes(afterActivation + 1);
    first.unsubscribe();
    second.unsubscribe();
  });

  it("tags its own writes and reports outside changes without a writer", async () => {
    const { transport, state } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, timing(100));
    const changes: DiskChange[] = [];
    const subscription = store.subscribe(LOCATION, (change) =>
      changes.push(change),
    );
    subscription.setActive(true);
    await flush();
    const writer = {};
    await expect(store.write(LOCATION, "b", "s1", writer)).resolves.toEqual({
      outcome: "written",
      sha256: "sha-b",
    });
    expect(changes.at(-1)?.writer).toBe(writer);
    state.disk = { content: "c", sha256: "s3" };
    await vi.advanceTimersByTimeAsync(100);
    expect(changes.at(-1)).toMatchObject({
      writer: null,
      state: { status: "ready", file: { content: "c", sha256: "s3" } },
    });
    subscription.unsubscribe();
  });

  it("drops a poll result that started before a write finished", async () => {
    const { transport, state } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, timing(100));
    const changes: DiskChange[] = [];
    const subscription = store.subscribe(LOCATION, (change) =>
      changes.push(change),
    );
    subscription.setActive(true);
    await flush();
    const pending = deferred<FileReadResult>();
    vi.mocked(transport.readIfChanged).mockImplementationOnce(
      () => pending.promise,
    );
    await vi.advanceTimersByTimeAsync(100);
    await store.write(LOCATION, "mine", "s1", {});
    pending.resolve(readResult("stale", "s-stale"));
    await flush();
    expect(state.disk?.content).toBe("mine");
    expect(store.getState(LOCATION)).toMatchObject({
      status: "ready",
      file: { content: "mine" },
    });
    subscription.unsubscribe();
  });

  it("serializes writes and reloads the disk after a conflict", async () => {
    const { transport } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, timing(100));
    const subscription = store.subscribe(LOCATION, () => undefined);
    await flush();
    const [first, second] = await Promise.all([
      store.write(LOCATION, "one", "s1", {}),
      store.write(LOCATION, "two", "s1", {}),
    ]);
    expect(first).toEqual({ outcome: "written", sha256: "sha-one" });
    expect(second).toEqual({ outcome: "conflict", currentSha256: "sha-one" });
    await flush();
    expect(transport.read).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it("reports a deleted file and recovers when it comes back", async () => {
    const { transport, state } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, timing(100));
    const subscription = store.subscribe(LOCATION, () => undefined);
    subscription.setActive(true);
    await flush();
    state.disk = null;
    await vi.advanceTimersByTimeAsync(100);
    expect(store.getState(LOCATION)).toEqual({ status: "missing" });
    state.disk = { content: "back", sha256: "s9" };
    await vi.advanceTimersByTimeAsync(100);
    expect(store.getState(LOCATION)).toMatchObject({
      status: "ready",
      file: { content: "back" },
    });
    subscription.unsubscribe();
  });

  it("stops polling when no tab is active", async () => {
    const { transport } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, timing(100));
    const subscription = store.subscribe(LOCATION, () => undefined);
    await flush();
    await vi.advanceTimersByTimeAsync(500);
    expect(transport.readIfChanged).not.toHaveBeenCalled();
    subscription.unsubscribe();
  });

  it("polls fast after a recent change, slow otherwise, and never while inactive", async () => {
    const { transport, state } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, {
      fastMs: 100,
      slowMs: 500,
      recentChangeMs: 1_000,
    });
    const subscription = store.subscribe(LOCATION, () => undefined);
    await flush();
    subscription.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.readIfChanged).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(transport.readIfChanged).toHaveBeenCalledTimes(1);
    state.disk = { content: "b", sha256: "s2" };
    await vi.advanceTimersByTimeAsync(1);
    expect(transport.readIfChanged).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(transport.readIfChanged).toHaveBeenCalledTimes(3);
    subscription.setActive(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(transport.readIfChanged).toHaveBeenCalledTimes(3);
    subscription.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(transport.readIfChanged).toHaveBeenCalledTimes(4);
    subscription.unsubscribe();
  });

  it("speeds up the next poll when the user edits", async () => {
    const { transport } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, {
      fastMs: 100,
      slowMs: 500,
      recentChangeMs: 1_000,
    });
    const subscription = store.subscribe(LOCATION, () => undefined);
    await flush();
    subscription.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    store.touch(LOCATION);
    await vi.advanceTimersByTimeAsync(100);
    expect(transport.readIfChanged).toHaveBeenCalledTimes(2);
    subscription.unsubscribe();
  });

  it("keeps a draft whose flush conflicted until a tab takes it back", async () => {
    const { transport, state } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, timing(100));
    const subscription = store.subscribe(LOCATION, () => undefined);
    await flush();
    subscription.unsubscribe();
    state.disk = { content: "theirs", sha256: "s2" };
    const draft = { text: "mine", baseSha256: "s1" };
    await expect(store.flushDraft(LOCATION, draft, {})).resolves.toEqual({
      outcome: "conflict",
      currentSha256: "s2",
    });
    await flush();
    expect(store.takeDraft(LOCATION)).toEqual(draft);
    expect(store.takeDraft(LOCATION)).toBeNull();
  });

  it("drops a flushed draft once the write lands", async () => {
    const { transport, state } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, timing(100));
    const subscription = store.subscribe(LOCATION, () => undefined);
    await flush();
    subscription.unsubscribe();
    await store.flushDraft(LOCATION, { text: "mine", baseSha256: "s1" }, {});
    expect(state.disk?.content).toBe("mine");
    expect(store.takeDraft(LOCATION)).toBeNull();
  });

  it("marks the file missing as soon as a write finds it gone", async () => {
    const { transport, state } = fakeTransport({ content: "a", sha256: "s1" });
    const store = new FileDocumentStore(transport, timing(100));
    const subscription = store.subscribe(LOCATION, () => undefined);
    await flush();
    state.disk = null;
    await expect(store.write(LOCATION, "b", "s1", {})).resolves.toEqual({
      outcome: "conflict",
      currentSha256: null,
    });
    expect(store.getState(LOCATION)).toEqual({ status: "missing" });
    subscription.unsubscribe();
  });
});
