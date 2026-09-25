import { describe, expect, it, vi } from "vitest";
import { createBbSdk } from "../src/core.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

function sdkWithFetch(fetch: FetchImplementation) {
  return createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      fetch,
      runtime: "node",
    }),
  });
}

describe("thread snooze transport", () => {
  it("puts the wake time and returns the updated thread", async () => {
    const thread = { id: "thr_snooze", snoozedUntil: 5_000 };
    const fetch = vi.fn<FetchImplementation>(async () => Response.json(thread));

    await expect(
      sdkWithFetch(fetch).threads.snooze({
        threadId: "thr_snooze",
        until: 5_000,
      }),
    ).resolves.toEqual(thread);

    expect(fetch).toHaveBeenCalledWith(
      "http://bb.test/api/v1/threads/thr_snooze/snooze",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      until: 5_000,
    });
  });

  it("unsnoozes by putting a null wake time", async () => {
    const fetch = vi.fn<FetchImplementation>(async () =>
      Response.json({ id: "thr_snooze", snoozedUntil: null }),
    );

    await sdkWithFetch(fetch).threads.unsnooze({ threadId: "thr_snooze" });

    expect(fetch).toHaveBeenCalledWith(
      "http://bb.test/api/v1/threads/thr_snooze/snooze",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
      until: null,
    });
  });

  it("filters thread lists to snoozed threads", async () => {
    const fetch = vi.fn<FetchImplementation>(async () => Response.json([]));

    await sdkWithFetch(fetch).threads.list({ snoozed: true });

    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      "http://bb.test/api/v1/threads?snoozed=true",
    );
  });
});
