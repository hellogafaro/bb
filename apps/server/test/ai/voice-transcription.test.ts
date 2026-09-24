import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  VOICE_TRANSCRIPTION_POLICY,
  resolveVoiceTranscriptionEnabled,
  transcribeVoiceInput,
} from "../../src/services/ai/voice-transcription.js";
import {
  OPENROUTER_WARMUP_THROTTLE_MS,
  resetOpenRouterWarmupForTests,
} from "../../src/services/ai/openrouter.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];
type FetchResult = ReturnType<typeof fetch>;

function voiceFile(): File {
  return new File([Buffer.from("audio")], "prompt.webm", {
    type: "audio/webm",
  });
}

function emptyVoiceFile(): File {
  return new File([], "prompt.webm", { type: "audio/webm" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function hangUntilAborted(init?: FetchInit): FetchResult {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () =>
      reject(new DOMException("aborted", "AbortError")),
    );
  });
}

async function createHarness(
  overrides: Parameters<typeof createTestAppHarness>[0] = {},
): Promise<TestAppHarness> {
  return createTestAppHarness({
    openRouterApiKey: "test-openrouter-key",
    transcriptionModel: "mistralai/voxtral-mini-transcribe",
    ...overrides,
  });
}

function expectRetryableApiError(
  error: unknown,
  expected: { code: string; status: number },
): void {
  expect(error).toBeInstanceOf(ApiError);
  if (!(error instanceof ApiError)) {
    throw new Error("Expected ApiError.");
  }
  expect(error.status).toBe(expected.status);
  expect(error.body).toMatchObject({
    code: expected.code,
    retryable: true,
  });
}

describe("voice transcription", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    resetOpenRouterWarmupForTests();
  });

  it("warms the OpenRouter connection once per throttle window", async () => {
    const harness = await createHarness();
    const requests: { url: FetchInput; init: FetchInit }[] = [];
    const fetchStub = vi.fn(
      async (url: FetchInput, init?: FetchInit): FetchResult => {
        requests.push({ url, init });
        return jsonResponse({ data: { label: "key" } });
      },
    );
    vi.stubGlobal("fetch", fetchStub);
    vi.useFakeTimers();
    try {
      const first = await harness.app.request(
        "/api/v1/system/voice-transcription/warmup",
        { method: "POST" },
      );
      expect(first.status).toBe(200);
      await expect(first.json()).resolves.toEqual({ warmed: true });
      const second = await harness.app.request(
        "/api/v1/system/voice-transcription/warmup",
        { method: "POST" },
      );
      await expect(second.json()).resolves.toEqual({ warmed: true });
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://openrouter.ai/api/v1/auth/key");
      expect(requests[0]?.init?.method).toBe("GET");
      expect(requests[0]?.init?.headers).toMatchObject({
        authorization: "Bearer test-openrouter-key",
      });

      await vi.advanceTimersByTimeAsync(OPENROUTER_WARMUP_THROTTLE_MS);
      await harness.app.request("/api/v1/system/voice-transcription/warmup", {
        method: "POST",
      });
      expect(requests).toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("reports an unwarmed connection without an OpenRouter key", async () => {
    const harness = await createHarness({ openRouterApiKey: "" });
    const fetchStub = vi.fn(async (): FetchResult => jsonResponse({}));
    vi.stubGlobal("fetch", fetchStub);
    try {
      const response = await harness.app.request(
        "/api/v1/system/voice-transcription/warmup",
        { method: "POST" },
      );
      await expect(response.json()).resolves.toEqual({ warmed: false });
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it("is enabled only while an OpenRouter key is configured", async () => {
    const harness = await createHarness();
    try {
      expect(resolveVoiceTranscriptionEnabled(harness.deps)).toBe(true);
      harness.deps.config.openRouterApiKey = "";
      expect(resolveVoiceTranscriptionEnabled(harness.deps)).toBe(false);
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects empty audio before calling OpenRouter", async () => {
    const harness = await createHarness();
    const fetchStub = vi.fn(async (): FetchResult => jsonResponse({ text: "" }));
    vi.stubGlobal("fetch", fetchStub);
    try {
      const form = new FormData();
      form.set("file", emptyVoiceFile());
      const response = await harness.app.request(
        "/api/v1/system/voice-transcription",
        { body: form, method: "POST" },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: "invalid_request",
        message: "Audio file must not be empty",
      });
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects audio above 25MB before calling OpenRouter", async () => {
    const harness = await createHarness();
    const fetchStub = vi.fn(async (): FetchResult => jsonResponse({ text: "" }));
    vi.stubGlobal("fetch", fetchStub);
    try {
      const file = new File([Buffer.alloc(25 * 1024 * 1024 + 1)], "long.webm", {
        type: "audio/webm",
      });
      await expect(
        transcribeVoiceInput(harness.deps, { file }),
      ).rejects.toMatchObject({
        status: 400,
        body: { code: "invalid_request", message: "Audio file exceeds 25MB limit" },
      });
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it("reports not_configured without an OpenRouter key", async () => {
    const harness = await createHarness({ openRouterApiKey: "" });
    const fetchStub = vi.fn(async (): FetchResult => jsonResponse({ text: "" }));
    vi.stubGlobal("fetch", fetchStub);
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).rejects.toMatchObject({
        status: 501,
        body: { code: "not_configured" },
      });
      expect(fetchStub).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });

  it("posts the audio and model to OpenRouter and returns the text", async () => {
    const harness = await createHarness();
    const requests: { url: FetchInput; init: FetchInit }[] = [];
    const fetchStub = vi.fn(
      async (url: FetchInput, init?: FetchInit): FetchResult => {
        requests.push({ url, init });
        return jsonResponse({
          text: "hello openrouter",
          usage: { seconds: 1.2, cost: 0.00001 },
        });
      },
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).resolves.toBe("hello openrouter");
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request?.url).toBe(
        "https://openrouter.ai/api/v1/audio/transcriptions",
      );
      expect(request?.init?.method).toBe("POST");
      expect(request?.init?.signal).toBeInstanceOf(AbortSignal);
      expect(request?.init?.headers).toMatchObject({
        authorization: "Bearer test-openrouter-key",
        "x-title": "bb",
      });
      const body = request?.init?.body;
      expect(body).toBeInstanceOf(FormData);
      if (!(body instanceof FormData)) {
        throw new Error("Expected multipart body.");
      }
      expect(body.get("model")).toBe("mistralai/voxtral-mini-transcribe");
      expect(body.has("prompt")).toBe(false);
      const file = body.get("file");
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe("prompt.webm");
    } finally {
      await harness.cleanup();
    }
  });

  it("retries immediately after a fast 5xx response", async () => {
    const harness = await createHarness();
    const fetchStub = vi
      .fn<(url: FetchInput, init?: FetchInit) => FetchResult>()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Provider returned 502" } }, 502),
      )
      .mockResolvedValueOnce(jsonResponse({ text: "second try" }));
    vi.stubGlobal("fetch", fetchStub);
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).resolves.toBe("second try");
      expect(fetchStub).toHaveBeenCalledTimes(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("hedges a slow first request and returns whichever answers first", async () => {
    const harness = await createHarness();
    const signals: AbortSignal[] = [];
    const fetchStub = vi.fn(
      (_url: FetchInput, init?: FetchInit): FetchResult => {
        if (init?.signal) signals.push(init.signal);
        return fetchStub.mock.calls.length === 1
          ? hangUntilAborted(init)
          : Promise.resolve(jsonResponse({ text: "from the hedge" }));
      },
    );
    vi.stubGlobal("fetch", fetchStub);
    vi.useFakeTimers();
    try {
      const pending = transcribeVoiceInput(harness.deps, { file: voiceFile() });
      await vi.advanceTimersByTimeAsync(VOICE_TRANSCRIPTION_POLICY.hedgeAfterMs);
      await expect(pending).resolves.toBe("from the hedge");
      expect(fetchStub).toHaveBeenCalledTimes(2);
      expect(signals[0]?.aborted).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it("returns retryable unavailable after both attempts are rate limited", async () => {
    const harness = await createHarness();
    const fetchStub = vi.fn(
      async (): FetchResult =>
        jsonResponse({ error: { message: "Rate limit exceeded" } }, 429),
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      const thrown = await transcribeVoiceInput(harness.deps, {
        file: voiceFile(),
      }).catch((error: unknown) => error);
      expectRetryableApiError(thrown, {
        code: "transcription_unavailable",
        status: 503,
      });
      expect(fetchStub).toHaveBeenCalledTimes(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("returns retryable timeout when both attempts time out", async () => {
    const harness = await createHarness();
    const fetchStub = vi.fn(
      (_url: FetchInput, init?: FetchInit): FetchResult => hangUntilAborted(init),
    );
    vi.stubGlobal("fetch", fetchStub);
    vi.useFakeTimers();
    try {
      const pending = transcribeVoiceInput(harness.deps, {
        file: voiceFile(),
      }).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(
        VOICE_TRANSCRIPTION_POLICY.timeoutMs +
          VOICE_TRANSCRIPTION_POLICY.hedgeAfterMs,
      );
      expectRetryableApiError(await pending, {
        code: "transcription_timeout",
        status: 504,
      });
      expect(fetchStub).toHaveBeenCalledTimes(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("does not retry auth failures", async () => {
    const harness = await createHarness();
    const fetchStub = vi.fn(
      async (): FetchResult =>
        jsonResponse({ error: { message: "Invalid API key" } }, 401),
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).rejects.toMatchObject({
        status: 502,
        body: {
          code: "openrouter_auth_required",
          message: "Invalid API key",
          retryable: false,
        },
      });
      expect(fetchStub).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("surfaces provider request errors with their message", async () => {
    const harness = await createHarness();
    const fetchStub = vi.fn(
      async (): FetchResult =>
        jsonResponse({ error: { message: "Unsupported audio format" } }, 400),
    );
    vi.stubGlobal("fetch", fetchStub);
    try {
      await expect(
        transcribeVoiceInput(harness.deps, { file: voiceFile() }),
      ).rejects.toMatchObject({
        status: 502,
        body: {
          code: "openrouter_request_failed",
          message: "Unsupported audio format",
        },
      });
      expect(fetchStub).toHaveBeenCalledTimes(1);
    } finally {
      await harness.cleanup();
    }
  });
});
