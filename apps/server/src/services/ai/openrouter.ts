import { jsonValueSchema, type JsonObject, type JsonValue } from "@bb/domain";
import { Agent, type Dispatcher } from "undici";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";

export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";
export const OPENROUTER_WARMUP_THROTTLE_MS = 15_000;
const OPENROUTER_WARMUP_TIMEOUT_MS = 5_000;
const OPENROUTER_KEEP_ALIVE_MS = 60_000;
const OPENROUTER_KEEP_ALIVE_MAX_MS = 10 * 60_000;

type DispatchedRequestInit = RequestInit & { dispatcher: Dispatcher };

const openRouterDispatcher: Dispatcher = new Agent({
  keepAliveTimeout: OPENROUTER_KEEP_ALIVE_MS,
  keepAliveMaxTimeout: OPENROUTER_KEEP_ALIVE_MAX_MS,
});
let lastWarmupStartedAt = 0;

export type OpenRouterErrorCode =
  | "timeout"
  | "rate_limited"
  | "service_unavailable"
  | "auth_required"
  | "request_failed"
  | "invalid_response";

const OPENROUTER_ERROR_BODY_CODES: Record<OpenRouterErrorCode, string> = {
  timeout: "openrouter_timeout",
  rate_limited: "openrouter_rate_limited",
  service_unavailable: "openrouter_unavailable",
  auth_required: "openrouter_auth_required",
  request_failed: "openrouter_request_failed",
  invalid_response: "openrouter_invalid_response",
};

const TRANSIENT_CODES = new Set<OpenRouterErrorCode>([
  "timeout",
  "rate_limited",
  "service_unavailable",
]);

export class OpenRouterRequestError extends ApiError {
  readonly code: OpenRouterErrorCode;

  constructor(code: OpenRouterErrorCode, message: string) {
    super(
      502,
      OPENROUTER_ERROR_BODY_CODES[code],
      message,
      TRANSIENT_CODES.has(code),
    );
    this.name = "OpenRouterRequestError";
    this.code = code;
  }

  get transient(): boolean {
    return TRANSIENT_CODES.has(this.code);
  }
}

export function isTransientOpenRouterError(error: unknown): boolean {
  return error instanceof OpenRouterRequestError && error.transient;
}

interface OpenRouterRequestArgs {
  path: string;
  body: FormData | JsonObject;
  timeoutMs: number;
  signal?: AbortSignal;
  label: string;
}

type OptionalJsonValue = JsonValue | null | undefined;

export function jsonObjectFromValue(
  value: OptionalJsonValue,
): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value;
}

export function jsonStringProperty(
  value: OptionalJsonValue,
  propertyName: string,
): string | null {
  const propertyValue = jsonObjectFromValue(value)?.[propertyName];
  return typeof propertyValue === "string" ? propertyValue : null;
}

export function jsonNumberProperty(
  value: OptionalJsonValue,
  propertyName: string,
): number | null {
  const propertyValue = jsonObjectFromValue(value)?.[propertyName];
  return typeof propertyValue === "number" ? propertyValue : null;
}

function providerErrorMessage(
  payload: OptionalJsonValue,
  fallback: string,
): string {
  const error = jsonObjectFromValue(payload)?.error;
  return (
    jsonStringProperty(error, "message") ??
    jsonStringProperty(payload, "message") ??
    fallback
  );
}

async function readJsonValue(response: Response): Promise<JsonValue | null> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return null;
  }
  try {
    return jsonValueSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
}

export function requireOpenRouterApiKey(deps: LoggedWorkSessionDeps): string {
  const apiKey = deps.config.openRouterApiKey;
  if (apiKey.length === 0) {
    throw new ApiError(
      501,
      "not_configured",
      "OPENROUTER_API_KEY is required for bb's helper inference and voice transcription",
    );
  }
  return apiKey;
}

export async function openRouterRequest(
  deps: LoggedWorkSessionDeps,
  args: OpenRouterRequestArgs,
): Promise<JsonObject> {
  const apiKey = requireOpenRouterApiKey(deps);
  const abortController = new AbortController();
  const abortFromCaller = (): void => abortController.abort();
  args.signal?.addEventListener("abort", abortFromCaller, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, args.timeoutMs);
  timer.unref();

  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    "http-referer": "https://getbb.app",
    "x-title": "bb",
  };
  const body =
    args.body instanceof FormData ? args.body : JSON.stringify(args.body);
  if (!(args.body instanceof FormData)) {
    headers["content-type"] = "application/json";
  }

  const init: DispatchedRequestInit = {
    method: "POST",
    headers,
    body,
    signal: abortController.signal,
    dispatcher: openRouterDispatcher,
  };
  let response: Response;
  try {
    response = await fetch(`${OPENROUTER_API_BASE_URL}${args.path}`, init);
  } catch (error) {
    if (timedOut) {
      throw new OpenRouterRequestError(
        "timeout",
        `${args.label} timed out after ${args.timeoutMs}ms`,
      );
    }
    if (args.signal?.aborted) {
      throw new OpenRouterRequestError(
        "request_failed",
        `${args.label} was cancelled`,
      );
    }
    deps.logger.warn(
      runtimeErrorLogFields(deps.config, error),
      `${args.label} request failed`,
    );
    throw new OpenRouterRequestError(
      "service_unavailable",
      `${args.label} request failed`,
    );
  } finally {
    clearTimeout(timer);
    args.signal?.removeEventListener("abort", abortFromCaller);
  }

  const payload = await readJsonValue(response);
  const fallbackMessage = `${args.label} failed with HTTP ${response.status}`;
  if (response.status === 429) {
    throw new OpenRouterRequestError(
      "rate_limited",
      providerErrorMessage(payload, fallbackMessage),
    );
  }
  if (response.status >= 500) {
    throw new OpenRouterRequestError(
      "service_unavailable",
      providerErrorMessage(payload, fallbackMessage),
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new OpenRouterRequestError(
      "auth_required",
      providerErrorMessage(payload, fallbackMessage),
    );
  }
  if (!response.ok) {
    throw new OpenRouterRequestError(
      "request_failed",
      providerErrorMessage(payload, fallbackMessage),
    );
  }
  const object = jsonObjectFromValue(payload);
  if (object === null) {
    throw new OpenRouterRequestError(
      "invalid_response",
      `${args.label} returned a non-JSON response`,
    );
  }
  return object;
}

export async function warmOpenRouterConnection(
  deps: LoggedWorkSessionDeps,
): Promise<boolean> {
  const apiKey = deps.config.openRouterApiKey;
  if (apiKey.length === 0) {
    return false;
  }
  const now = Date.now();
  if (now - lastWarmupStartedAt < OPENROUTER_WARMUP_THROTTLE_MS) {
    return true;
  }
  lastWarmupStartedAt = now;
  const init: DispatchedRequestInit = {
    method: "GET",
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(OPENROUTER_WARMUP_TIMEOUT_MS),
    dispatcher: openRouterDispatcher,
  };
  try {
    const response = await fetch(`${OPENROUTER_API_BASE_URL}/auth/key`, init);
    await response.arrayBuffer();
    deps.logger.debug(
      { status: response.status, durationMs: Date.now() - now },
      "OpenRouter connection warmed",
    );
  } catch (error) {
    deps.logger.debug(
      runtimeErrorLogFields(deps.config, error),
      "OpenRouter warmup request failed",
    );
  }
  return true;
}

export function resetOpenRouterWarmupForTests(): void {
  lastWarmupStartedAt = 0;
}
