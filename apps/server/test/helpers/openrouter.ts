import { vi } from "vitest";
import type { JsonObject } from "@bb/domain";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

export interface OpenRouterChatRequest {
  url: string;
  body: JsonObject;
  init: FetchInit;
}

export type OpenRouterChatReply =
  | { kind: "tool-call"; arguments: JsonObject }
  | { kind: "no-tool-call" }
  | { kind: "http-error"; status: number; message: string }
  | { kind: "network-error" }
  | { kind: "hang" };

export interface OpenRouterChatStub {
  requests: OpenRouterChatRequest[];
  reply: ReturnType<typeof vi.fn<(request: OpenRouterChatRequest) => OpenRouterChatReply>>;
  prompt(index?: number): string | undefined;
  restore(): void;
}

export function toolCallReply(argumentsValue: JsonObject): OpenRouterChatReply {
  return { kind: "tool-call", arguments: argumentsValue };
}

export function noToolCallReply(): OpenRouterChatReply {
  return { kind: "no-tool-call" };
}

export function httpErrorReply(
  status: number,
  message: string,
): OpenRouterChatReply {
  return { kind: "http-error", status, message };
}

export function hangReply(): OpenRouterChatReply {
  return { kind: "hang" };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function chatCompletionResponse(reply: OpenRouterChatReply): Response {
  switch (reply.kind) {
    case "tool-call":
      return jsonResponse({
        model: "stub/model",
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "result",
                    arguments: JSON.stringify(reply.arguments),
                  },
                },
              ],
            },
          },
        ],
        usage: { total_tokens: 12, cost: 0.00001 },
      });
    case "no-tool-call":
      return jsonResponse({
        model: "stub/model",
        choices: [{ message: { role: "assistant", content: "plain text" } }],
        usage: { total_tokens: 12, cost: 0.00001 },
      });
    case "http-error":
      return jsonResponse({ error: { message: reply.message } }, reply.status);
    case "network-error":
    case "hang":
      throw new Error("unreachable");
  }
}

export function stubOpenRouterChat(
  defaultReply: OpenRouterChatReply = noToolCallReply(),
): OpenRouterChatStub {
  const requests: OpenRouterChatRequest[] = [];
  const reply = vi.fn<(request: OpenRouterChatRequest) => OpenRouterChatReply>(
    () => defaultReply,
  );
  const fetchStub = vi.fn(
    async (input: FetchInput, init?: FetchInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const rawBody = init?.body;
      const body =
        typeof rawBody === "string" ? (JSON.parse(rawBody) as JsonObject) : {};
      const request: OpenRouterChatRequest = { url, body, init };
      requests.push(request);
      const outcome = reply(request);
      if (outcome.kind === "network-error") {
        throw new TypeError("fetch failed");
      }
      if (outcome.kind === "hang") {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      }
      return chatCompletionResponse(outcome);
    },
  );
  vi.stubGlobal("fetch", fetchStub);
  return {
    requests,
    reply,
    prompt(index = 0) {
      const messages = requests[index]?.body.messages;
      const first = Array.isArray(messages) ? messages[0] : null;
      const content =
        first && typeof first === "object" && !Array.isArray(first)
          ? first.content
          : null;
      return typeof content === "string" ? content : undefined;
    },
    restore() {
      vi.unstubAllGlobals();
    },
  };
}

interface LegacyToolCallCompletion {
  content: { type: string; name?: string; arguments?: unknown }[];
}

export interface OpenRouterChatCompat {
  complete: ReturnType<
    typeof vi.fn<(body: JsonObject) => Promise<LegacyToolCallCompletion>>
  >;
  requests: OpenRouterChatRequest[];
  prompt(index?: number): string | undefined;
}

function legacyCompletionReply(
  completion: LegacyToolCallCompletion,
): OpenRouterChatReply {
  const toolCall = completion.content.find(
    (part) => part.type === "toolCall" && part.name === "result",
  );
  return toolCall?.arguments === undefined
    ? noToolCallReply()
    : toolCallReply(toolCall.arguments as JsonObject);
}

function errorReply(error: unknown): OpenRouterChatReply {
  if (
    error instanceof Error &&
    error.name === "OpenRouterRequestError" &&
    "code" in error
  ) {
    const status =
      error.code === "rate_limited"
        ? 429
        : error.code === "service_unavailable"
          ? 503
          : error.code === "auth_required"
            ? 401
            : 400;
    return httpErrorReply(status, error.message);
  }
  return httpErrorReply(
    400,
    error instanceof Error ? error.message : String(error),
  );
}

export function installOpenRouterChatCompat(): OpenRouterChatCompat {
  const complete = vi.fn<(body: JsonObject) => Promise<LegacyToolCallCompletion>>();
  const requests: OpenRouterChatRequest[] = [];
  vi.stubGlobal(
    "fetch",
    async (input: FetchInput, init?: FetchInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const rawBody = init?.body;
      const body =
        typeof rawBody === "string" ? (JSON.parse(rawBody) as JsonObject) : {};
      requests.push({ url, body, init });
      const aborted = new Promise<never>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
      let reply: OpenRouterChatReply;
      try {
        reply = legacyCompletionReply(
          await Promise.race([
            Promise.resolve().then(() => complete(body)),
            aborted,
          ]),
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw error;
        }
        if (error instanceof Error && error.name === "InferenceTimeoutError") {
          await aborted;
        }
        reply = errorReply(error);
      }
      return chatCompletionResponse(reply);
    },
  );
  return {
    complete,
    requests,
    prompt(index = 0) {
      const messages = requests[index]?.body.messages;
      const first = Array.isArray(messages) ? messages[0] : null;
      const content =
        first && typeof first === "object" && !Array.isArray(first)
          ? first.content
          : null;
      return typeof content === "string" ? content : undefined;
    },
  };
}
