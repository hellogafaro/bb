import type { JsonObject } from "@bb/domain";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  OpenRouterRequestError,
  isTransientOpenRouterError,
  jsonNumberProperty,
  jsonObjectFromValue,
  jsonStringProperty,
  openRouterRequest,
} from "./openrouter.js";

interface TranscribeVoiceInputArgs {
  file: File;
}

interface TranscriptionAttemptArgs {
  file: File;
  model: string;
  signal: AbortSignal;
}

type AttemptOutcome =
  | { ok: true; text: string }
  | { ok: false; error: Error };

export const VOICE_TRANSCRIPTION_POLICY = {
  timeoutMs: 20_000,
  hedgeAfterMs: 1_500,
} as const;
const VOICE_TRANSCRIPTION_MAX_BYTES = 25 * 1024 * 1024;

export function resolveVoiceTranscriptionEnabled(
  deps: LoggedWorkSessionDeps,
): boolean {
  return deps.config.openRouterApiKey.length > 0;
}

function buildTranscriptionTimeoutError(): ApiError {
  return new ApiError(
    504,
    "transcription_timeout",
    "Voice transcription timed out",
    true,
  );
}

function buildTranscriptionUnavailableError(): ApiError {
  return new ApiError(
    503,
    "transcription_unavailable",
    "Voice transcription is temporarily unavailable. Please try again in a moment.",
    true,
  );
}

async function requestTranscription(
  deps: LoggedWorkSessionDeps,
  args: TranscriptionAttemptArgs,
): Promise<string> {
  const formData = new FormData();
  formData.set("model", args.model);
  formData.set("file", args.file, args.file.name || "voice-input");
  const response = await openRouterRequest(deps, {
    label: "Voice transcription",
    path: "/audio/transcriptions",
    body: formData,
    timeoutMs: VOICE_TRANSCRIPTION_POLICY.timeoutMs,
    signal: args.signal,
  });
  const text = jsonStringProperty(response, "text");
  if (text === null) {
    throw new OpenRouterRequestError(
      "invalid_response",
      "Voice transcription response did not include text",
    );
  }
  logTranscriptionUsage(deps, args, response);
  return text;
}

function logTranscriptionUsage(
  deps: LoggedWorkSessionDeps,
  args: TranscriptionAttemptArgs,
  response: JsonObject,
): void {
  const usage = jsonObjectFromValue(response.usage);
  deps.logger.debug(
    {
      model: args.model,
      audioBytes: args.file.size,
      audioSeconds: jsonNumberProperty(usage, "seconds"),
      cost: jsonNumberProperty(usage, "cost"),
    },
    "Voice transcription completed",
  );
}

async function settleAttempt(promise: Promise<string>): Promise<AttemptOutcome> {
  try {
    return { ok: true, text: await promise };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function transcribeWithHedge(
  deps: LoggedWorkSessionDeps,
  file: File,
): Promise<string> {
  const model = deps.config.transcriptionModel;
  const startedAt = Date.now();
  const controllers = [new AbortController(), new AbortController()];
  const attempt = (index: 0 | 1): Promise<AttemptOutcome> =>
    settleAttempt(
      requestTranscription(deps, {
        file,
        model,
        signal: controllers[index].signal,
      }),
    );

  const first = attempt(0);
  let second: Promise<AttemptOutcome> | null = null;
  const hedgeTimer = setTimeout(() => {
    second = attempt(1);
    deps.logger.info(
      { model, hedgeAfterMs: VOICE_TRANSCRIPTION_POLICY.hedgeAfterMs },
      "Voice transcription hedged with a second request",
    );
  }, VOICE_TRANSCRIPTION_POLICY.hedgeAfterMs);
  hedgeTimer.unref();

  const firstOutcome = await Promise.race([
    first,
    new Promise<null>((resolve) => {
      setTimeout(
        () => resolve(null),
        VOICE_TRANSCRIPTION_POLICY.hedgeAfterMs,
      ).unref();
    }),
  ]);

  let outcome: AttemptOutcome;
  if (firstOutcome !== null) {
    clearTimeout(hedgeTimer);
    if (firstOutcome.ok || !isTransientOpenRouterError(firstOutcome.error)) {
      outcome = firstOutcome;
    } else {
      deps.logger.info(
        {
          errorCode: firstOutcome.error instanceof OpenRouterRequestError
            ? firstOutcome.error.body.code
            : "unknown",
          model,
        },
        "Voice transcription failed transiently; retrying",
      );
      outcome = await attempt(1);
    }
  } else {
    second ??= attempt(1);
    const raced = await Promise.race([
      first.then((result) => ({ index: 0 as const, result })),
      second.then((result) => ({ index: 1 as const, result })),
    ]);
    if (raced.result.ok) {
      controllers[raced.index === 0 ? 1 : 0].abort();
      outcome = raced.result;
    } else {
      outcome = await (raced.index === 0 ? second : first);
    }
  }

  if (outcome.ok) {
    return outcome.text;
  }
  deps.logger.warn(
    {
      durationMs: Date.now() - startedAt,
      errorCode:
        outcome.error instanceof OpenRouterRequestError
          ? outcome.error.body.code
          : "unknown",
      errorMessage: outcome.error.message,
      model,
    },
    "Voice transcription failed",
  );
  throw outcome.error;
}

export async function transcribeVoiceInput(
  deps: LoggedWorkSessionDeps,
  args: TranscribeVoiceInputArgs,
): Promise<string> {
  if (args.file.size === 0) {
    throw new ApiError(400, "invalid_request", "Audio file must not be empty");
  }
  if (args.file.size > VOICE_TRANSCRIPTION_MAX_BYTES) {
    throw new ApiError(400, "invalid_request", "Audio file exceeds 25MB limit");
  }
  if (!resolveVoiceTranscriptionEnabled(deps)) {
    throw new ApiError(
      501,
      "not_configured",
      "Voice transcription requires OPENROUTER_API_KEY",
    );
  }

  try {
    return await transcribeWithHedge(deps, args.file);
  } catch (error) {
    if (error instanceof OpenRouterRequestError) {
      if (error.code === "timeout") {
        throw buildTranscriptionTimeoutError();
      }
      if (error.code === "rate_limited" || error.code === "service_unavailable") {
        throw buildTranscriptionUnavailableError();
      }
    }
    throw error;
  }
}
