import { setTimeout as delay } from "node:timers/promises";
import { jsonObjectSchema, type JsonObject, type JsonValue } from "@bb/domain";
import { validateToolCall } from "@earendil-works/pi-ai";
import type { Static, TSchema, Tool, ToolCall } from "@earendil-works/pi-ai";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import {
  OpenRouterRequestError,
  isTransientOpenRouterError,
  jsonObjectFromValue,
  jsonNumberProperty,
  jsonStringProperty,
  openRouterRequest,
} from "./openrouter.js";

const RESULT_TOOL_NAME = "result";
const DEFAULT_INFERENCE_TIMEOUT_MS = 30_000;

export const INFERENCE_POLICY = {
  commitMessage: { maxAttempts: 2, retryDelayMs: 0, timeoutMs: 5_000 },
  threadMetadata: { maxAttempts: 2, retryDelayMs: 250, timeoutMs: 5_000 },
} as const;

interface InferenceCompleteArgs<T extends TSchema> {
  prompt: string;
  schema: T;
  timeoutMs?: number;
}

interface InferenceTimeoutErrorArgs {
  timeoutMs: number;
}

export class InferenceTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(args: InferenceTimeoutErrorArgs) {
    super(`Inference request timed out after ${args.timeoutMs}ms`);
    this.name = "InferenceTimeoutError";
    this.timeoutMs = args.timeoutMs;
  }
}

function toToolCallArguments(value: JsonValue): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Structured inference result must be a JSON object");
  }
  return value;
}

function validateStructuredResult<T extends TSchema>(
  schema: T,
  value: JsonValue,
): Static<T> {
  const tools: Tool<T>[] = [
    {
      name: RESULT_TOOL_NAME,
      description: "Return the result as structured JSON.",
      parameters: schema,
    },
  ];
  const toolCall: ToolCall = {
    type: "toolCall",
    id: "openrouter_result",
    name: RESULT_TOOL_NAME,
    arguments: toToolCallArguments(value),
  };

  return validateToolCall(tools, toolCall) as Static<T>;
}

function isTransientInferenceError(error: Error): boolean {
  return (
    error instanceof InferenceTimeoutError || isTransientOpenRouterError(error)
  );
}

interface InferenceCompleteWithRetryArgs<T extends TSchema> {
  label: string;
  logContext?: JsonObject;
  maxAttempts: number;
  prompt: string;
  retryDelayMs: number;
  schema: T;
  timeoutMs: number;
}

export async function inferenceCompleteWithRetry<T extends TSchema>(
  deps: LoggedWorkSessionDeps,
  args: InferenceCompleteWithRetryArgs<T>,
): Promise<Static<T> | null> {
  const startedAt = Date.now();
  const maxAttempts = Math.max(1, args.maxAttempts);
  const model = deps.config.inferenceModel;
  if (deps.config.openRouterApiKey.length === 0) {
    deps.logger.info(
      { model, reason: "not-configured", ...args.logContext },
      `${args.label} skipped: OPENROUTER_API_KEY is not set`,
    );
    return null;
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const value = await inferenceComplete(deps, {
        prompt: args.prompt,
        schema: args.schema,
        timeoutMs: args.timeoutMs,
      });
      if (attempt > 1) {
        deps.logger.info(
          {
            attempts: attempt,
            durationMs: Date.now() - startedAt,
            maxAttempts,
            model,
            reason: "transient-failure",
            timeoutMs: args.timeoutMs,
            ...args.logContext,
          },
          `${args.label} completed after retry`,
        );
      }
      if (value === null) {
        deps.logger.warn(
          {
            attempts: attempt,
            durationMs: Date.now() - startedAt,
            reason: "no-result",
            ...args.logContext,
          },
          `${args.label} returned no result`,
        );
      }
      return value;
    } catch (error) {
      const err =
        error instanceof Error
          ? error
          : new Error(`Non-Error thrown during ${args.label.toLowerCase()}`);
      const transient = isTransientInferenceError(err);
      if (transient && attempt < maxAttempts) {
        deps.logger.info(
          {
            attempt,
            errorCode:
              err instanceof OpenRouterRequestError ? err.body.code : "timeout",
            maxAttempts,
            model,
            reason: "transient-failure",
            ...(err instanceof InferenceTimeoutError
              ? { timeoutMs: err.timeoutMs }
              : {}),
            ...args.logContext,
          },
          `${args.label} failed transiently; retrying`,
        );
        if (args.retryDelayMs > 0) {
          await delay(args.retryDelayMs);
        }
        continue;
      }
      const fields = {
        attempts: attempt,
        durationMs: Date.now() - startedAt,
        maxAttempts,
        model,
        ...args.logContext,
      };
      if (err instanceof InferenceTimeoutError) {
        deps.logger.info(
          { ...fields, reason: "timeout", timeoutMs: err.timeoutMs },
          `${args.label} timed out`,
        );
      } else {
        deps.logger.warn(
          {
            ...fields,
            ...runtimeErrorLogFields(deps.config, err),
            reason: "failed",
          },
          `${args.label} failed`,
        );
      }
      throw err;
    }
  }

  throw new Error("Inference retry loop completed without an outcome");
}

function toolCallArgumentsFromResponse(response: JsonObject): JsonValue | null {
  const choices = response.choices;
  const choice = Array.isArray(choices) ? choices[0] : null;
  const message = jsonObjectFromValue(choice)?.message;
  const toolCalls = jsonObjectFromValue(message)?.tool_calls;
  const toolCall = Array.isArray(toolCalls)
    ? toolCalls.find(
        (candidate) =>
          jsonStringProperty(
            jsonObjectFromValue(candidate)?.function,
            "name",
          ) === RESULT_TOOL_NAME,
      )
    : undefined;
  const rawArguments = jsonStringProperty(
    jsonObjectFromValue(toolCall)?.function,
    "arguments",
  );
  if (rawArguments === null) {
    return null;
  }
  try {
    return JSON.parse(rawArguments) as JsonValue;
  } catch {
    throw new OpenRouterRequestError(
      "invalid_response",
      "Inference result tool call carried invalid JSON arguments",
    );
  }
}

export async function inferenceComplete<T extends TSchema>(
  deps: LoggedWorkSessionDeps,
  args: InferenceCompleteArgs<T>,
): Promise<Static<T> | null> {
  const model = deps.config.inferenceModel;
  const timeoutMs = args.timeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
  let response: JsonObject;
  try {
    response = await openRouterRequest(deps, {
      label: "Inference",
      path: "/chat/completions",
      timeoutMs,
      body: {
        model,
        messages: [{ role: "user", content: args.prompt }],
        tools: [
          {
            type: "function",
            function: {
              name: RESULT_TOOL_NAME,
              description: "Return the result as structured JSON.",
              parameters: jsonObjectSchema.parse(args.schema),
            },
          },
        ],
        tool_choice: {
          type: "function",
          function: { name: RESULT_TOOL_NAME },
        },
        reasoning: { effort: "low" },
        provider: { sort: "latency" },
        usage: { include: true },
      },
    });
  } catch (error) {
    if (error instanceof OpenRouterRequestError && error.code === "timeout") {
      throw new InferenceTimeoutError({ timeoutMs });
    }
    throw error;
  }

  const usage = jsonObjectFromValue(response.usage);
  deps.logger.debug(
    {
      model: jsonStringProperty(response, "model") ?? model,
      cost: jsonNumberProperty(usage, "cost"),
      totalTokens: jsonNumberProperty(usage, "total_tokens"),
    },
    "Inference completed",
  );

  const value = toolCallArgumentsFromResponse(response);
  if (value === null) {
    return null;
  }
  return validateStructuredResult(args.schema, value);
}
