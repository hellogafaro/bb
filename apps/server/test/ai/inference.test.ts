import { Type } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InferenceTimeoutError,
  inferenceComplete,
  inferenceCompleteWithRetry,
} from "../../src/services/ai/inference.js";
import {
  httpErrorReply,
  hangReply,
  noToolCallReply,
  stubOpenRouterChat,
  toolCallReply,
} from "../helpers/openrouter.js";
import { withTestHarness } from "../helpers/test-app.js";

const titleSchema = Type.Object({
  title: Type.String(),
});

describe("inferenceComplete", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("posts a forced result tool call to OpenRouter and validates the arguments", async () => {
    const stub = stubOpenRouterChat(toolCallReply({ title: "Generated title" }));
    await withTestHarness(
      { inferenceModel: "openai/gpt-5.4-mini" },
      async (harness) => {
        await expect(
          inferenceComplete(harness.deps, {
            prompt: "Generate a title",
            schema: titleSchema,
            timeoutMs: 5000,
          }),
        ).resolves.toEqual({ title: "Generated title" });
        expect(stub.requests).toHaveLength(1);
        const request = stub.requests[0];
        expect(request?.url).toBe(
          "https://openrouter.ai/api/v1/chat/completions",
        );
        expect(request?.init?.headers).toMatchObject({
          authorization: "Bearer test-openrouter-key",
          "content-type": "application/json",
        });
        expect(request?.body).toMatchObject({
          model: "openai/gpt-5.4-mini",
          messages: [{ role: "user", content: "Generate a title" }],
          tool_choice: { type: "function", function: { name: "result" } },
          reasoning: { effort: "low" },
          provider: { sort: "latency" },
        });
      },
    );
  });

  it("reports not_configured without an OpenRouter key", async () => {
    const stub = stubOpenRouterChat(toolCallReply({ title: "unused" }));
    await withTestHarness({ openRouterApiKey: "" }, async (harness) => {
      await expect(
        inferenceComplete(harness.deps, {
          prompt: "Generate a title",
          schema: titleSchema,
        }),
      ).rejects.toMatchObject({ status: 501, body: { code: "not_configured" } });
      expect(stub.requests).toHaveLength(0);
    });
  });

  it("returns null when the model answers without the result tool call", async () => {
    stubOpenRouterChat(noToolCallReply());
    await withTestHarness(async (harness) => {
      await expect(
        inferenceComplete(harness.deps, {
          prompt: "Generate a title",
          schema: titleSchema,
        }),
      ).resolves.toBeNull();
    });
  });

  it("rejects a structured result that does not satisfy the schema", async () => {
    stubOpenRouterChat(toolCallReply({ wrong: "shape" }));
    await withTestHarness(async (harness) => {
      await expect(
        inferenceComplete(harness.deps, {
          prompt: "Generate a title",
          schema: titleSchema,
        }),
      ).rejects.toThrow();
    });
  });

  it("converts a request timeout into an inference timeout", async () => {
    stubOpenRouterChat(hangReply());
    vi.useFakeTimers();
    await withTestHarness(async (harness) => {
      const pending = inferenceComplete(harness.deps, {
        prompt: "Generate a title",
        schema: titleSchema,
        timeoutMs: 1_000,
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(1_000);
      await expect(pending).resolves.toBeInstanceOf(InferenceTimeoutError);
    });
  });

  it("surfaces an auth failure as a non-retryable error", async () => {
    stubOpenRouterChat(httpErrorReply(401, "Invalid API key"));
    await withTestHarness(async (harness) => {
      await expect(
        inferenceComplete(harness.deps, {
          prompt: "Generate a title",
          schema: titleSchema,
        }),
      ).rejects.toMatchObject({
        status: 502,
        body: {
          code: "openrouter_auth_required",
          message: "Invalid API key",
          retryable: false,
        },
      });
    });
  });
});

describe("inferenceCompleteWithRetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries once on a transient provider failure", async () => {
    const stub = stubOpenRouterChat();
    stub.reply
      .mockReturnValueOnce(httpErrorReply(503, "overloaded"))
      .mockReturnValueOnce(toolCallReply({ title: "Second try" }));
    await withTestHarness(async (harness) => {
      await expect(
        inferenceCompleteWithRetry(harness.deps, {
          label: "Test inference",
          maxAttempts: 2,
          prompt: "Generate a title",
          retryDelayMs: 0,
          schema: titleSchema,
          timeoutMs: 5000,
        }),
      ).resolves.toEqual({ title: "Second try" });
      expect(stub.requests).toHaveLength(2);
    });
  });

  it("does not retry a request the provider rejected", async () => {
    const stub = stubOpenRouterChat(httpErrorReply(400, "bad model"));
    await withTestHarness(async (harness) => {
      await expect(
        inferenceCompleteWithRetry(harness.deps, {
          label: "Test inference",
          maxAttempts: 2,
          prompt: "Generate a title",
          retryDelayMs: 0,
          schema: titleSchema,
          timeoutMs: 5000,
        }),
      ).rejects.toMatchObject({
        body: { code: "openrouter_request_failed", message: "bad model" },
      });
      expect(stub.requests).toHaveLength(1);
    });
  });
});
