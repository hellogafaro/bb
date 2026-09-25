import { describe, expect, it, vi } from "vitest";
import { createBbSdk } from "../src/core.js";
import type { FetchImplementation } from "../src/response.js";
import { createHttpTransport } from "../src/transport-http.js";

describe("thread title generation transport", () => {
  it("posts without a body, forwards cancellation, and returns the updated thread", async () => {
    const thread = { id: "thread-title", title: "Generated title" };
    const fetch = vi.fn<FetchImplementation>(async () => Response.json(thread));
    const sdk = createBbSdk({
      transport: createHttpTransport({
        baseUrl: "http://bb.test",
        fetch,
        runtime: "node",
      }),
    });
    const controller = new AbortController();

    await expect(
      sdk.threads.generateTitle({
        threadId: "thread-title",
        signal: controller.signal,
      }),
    ).resolves.toEqual(thread);

    expect(fetch).toHaveBeenCalledWith(
      "http://bb.test/api/v1/threads/thread-title/generate-title",
      expect.objectContaining({ method: "POST", signal: controller.signal }),
    );
    expect(fetch.mock.calls[0]?.[1]?.body).toBeUndefined();
  });
});
