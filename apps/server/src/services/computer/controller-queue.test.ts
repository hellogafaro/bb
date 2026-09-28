import { describe, expect, it } from "vitest";
import { SingleControllerQueue } from "./controller-queue.js";

describe("SingleControllerQueue", () => {
  it("grants the first acquire immediately and queues a second run", async () => {
    const queue = new SingleControllerQueue({ leaseTtlMs: 10_000 });
    const first = await queue.acquire("run-1", new AbortController().signal);
    let secondGranted = false;
    const secondPromise = queue.acquire("run-2", new AbortController().signal).then((lease) => {
      secondGranted = true;
      return lease;
    });
    await Promise.resolve();
    expect(secondGranted).toBe(false);
    first.release();
    const second = await secondPromise;
    expect(second.runId).toBe("run-2");
  });

  it("rejects a run that already owns or awaits the controller", async () => {
    const queue = new SingleControllerQueue();
    await queue.acquire("run-1", new AbortController().signal);
    await expect(queue.acquire("run-1", new AbortController().signal)).rejects.toThrow();
  });

  it("drops a queued acquire when its signal aborts", async () => {
    const queue = new SingleControllerQueue();
    await queue.acquire("run-1", new AbortController().signal);
    const abort = new AbortController();
    const pending = queue.acquire("run-2", abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
  });
});
