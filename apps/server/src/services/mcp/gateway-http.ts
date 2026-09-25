import {
  SSEClientTransport,
  StreamableHTTPClientTransport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import type { HttpServerConfig } from "./config.js";
import type { McpOAuthProvider } from "./oauth.js";

export const OAUTH_TIMEOUT_MS = 15_000;
export const FETCH_TIMEOUT_GRACE_MS = 1_000;

export class SessionExpiredError extends Error {}

export class AuthenticationRequiredError extends Error {
  constructor(readonly authorizationUrl: string) {
    super("MCP authorization is required");
    this.name = "AuthenticationRequiredError";
  }
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return promise;
  promise.catch(() => {});
  if (signal.aborted) {
    return Promise.reject(
      signal.reason instanceof Error
        ? signal.reason
        : new Error("MCP request cancelled"),
    );
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () =>
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("MCP request cancelled"),
      );
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isJsonRpcBody(body: RequestInit["body"]): boolean {
  if (typeof body !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(body);
    if (Array.isArray(parsed))
      return parsed.some((item) => isRecord(item) && item.jsonrpc === "2.0");
    return isRecord(parsed) && parsed.jsonrpc === "2.0";
  } catch {
    return false;
  }
}

function requestFrom(input: RequestInfo | URL): Request | undefined {
  return typeof Request !== "undefined" && input instanceof Request
    ? input
    : undefined;
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url,
  );
}

export function isMcpRequest(
  url: URL,
  configuredUrl: URL,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): boolean {
  if (url.origin !== configuredUrl.origin) return false;
  const request = requestFrom(input);
  const requestHeaders = new Headers(init?.headers ?? request?.headers);
  const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
  const exactConfiguredEndpoint =
    url.pathname === configuredUrl.pathname &&
    url.search === configuredUrl.search;
  if (
    method === "GET" &&
    requestHeaders.get("accept")?.toLowerCase().includes("text/event-stream")
  )
    return true;
  if (method === "POST" && isJsonRpcBody(init?.body ?? null)) return true;
  return exactConfiguredEndpoint && method === "DELETE";
}

export function redirectGuardFetch(
  url: URL,
  baseHeaders: Record<string, string> | undefined,
  timeoutMs = OAUTH_TIMEOUT_MS,
): typeof fetch {
  return async (input, init) => {
    const request = requestFrom(input);
    const useMcpHeaders = isMcpRequest(requestUrl(input), url, input, init);
    const headers = new Headers(request?.headers);
    if (useMcpHeaders)
      new Headers(baseHeaders).forEach((value, name) =>
        headers.set(name, value),
      );
    new Headers(init?.headers).forEach((value, name) =>
      headers.set(name, value),
    );
    const controller = new AbortController();
    const sourceSignals = [init?.signal, request?.signal].filter(
      (signal): signal is AbortSignal =>
        signal !== undefined && signal !== null,
    );
    const abortListeners = sourceSignals.map((signal) => {
      const listener = () => controller.abort(signal.reason);
      if (signal.aborted) listener();
      else signal.addEventListener("abort", listener, { once: true });
      return { signal, listener };
    });
    const timer =
      timeoutMs > 0
        ? setTimeout(
            () =>
              controller.abort(
                new Error(`MCP HTTP request timed out after ${timeoutMs}ms`),
              ),
            timeoutMs,
          )
        : undefined;
    try {
      const response = await fetch(input, {
        ...init,
        headers,
        signal: controller.signal,
        redirect: "manual",
      });
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.headers.get("location")
      ) {
        throw new Error(
          `redirect blocked for ${url}: ${response.headers.get("location")}`,
        );
      }
      return response;
    } finally {
      if (timer) clearTimeout(timer);
      for (const { signal, listener } of abortListeners)
        signal.removeEventListener("abort", listener);
    }
  };
}

export function createHttpTransport(
  cfg: HttpServerConfig,
  provider: McpOAuthProvider,
  requestTimeoutMs: number,
): StreamableHTTPClientTransport | SSEClientTransport {
  const serverUrl = new URL(cfg.url);
  const guardedFetch = redirectGuardFetch(
    serverUrl,
    cfg.headers,
    requestTimeoutMs,
  );
  const fetchWithGuard: typeof fetch = async (input, init) => {
    const response = await guardedFetch(input, init);
    const request = requestFrom(input);
    const sentHeaders = new Headers(init?.headers ?? request?.headers);
    if (response.status === 404 && sentHeaders.has("mcp-session-id")) {
      await response.body?.cancel();
      throw new SessionExpiredError(
        "MCP session expired; the next request will reconnect",
      );
    }
    if (
      response.status !== 401 ||
      !isMcpRequest(requestUrl(input), serverUrl, input, init)
    )
      return response;
    const headers = new Headers(init?.headers ?? request?.headers);
    const rejectedToken = headers.get("authorization");
    const currentToken = (await provider.tokens())?.access_token;
    try {
      if (!currentToken || rejectedToken === `Bearer ${currentToken}`) {
        await provider.reauthorize(response, guardedFetch);
      }
    } finally {
      await response.body?.cancel();
    }
    const token = (await provider.tokens())?.access_token;
    if (token) headers.set("authorization", `Bearer ${token}`);
    const retry = await guardedFetch(input, { ...init, headers });
    if (retry.status === 401) {
      await retry.body?.cancel();
      throw new UnauthorizedError("Server rejected refreshed MCP credentials");
    }
    return retry;
  };
  const options = {
    authProvider: provider,
    requestInit: { redirect: "manual" as const },
    fetch: fetchWithGuard,
  };
  if (cfg.type === "streamable-http")
    return new StreamableHTTPClientTransport(serverUrl, options);
  return new SSEClientTransport(serverUrl, options);
}
