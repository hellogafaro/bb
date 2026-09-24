import * as crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import {
  Client,
  UnauthorizedError,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type ClientOptions,
  type OAuthClientProvider,
  type Prompt,
  type Resource,
  type ResourceTemplateType,
  type Tool,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { McpsStore } from "./store.js";
import { expandPlaceholders, validateMcpServer } from "./loader.js";
import { isWithinRoot } from "./safe-fs.js";
import { McpOAuthProvider } from "./oauth.js";
import { compactToolFromCatalog, scoreTokens, tokenize, SEARCH_LIMIT, SEARCH_MAX } from "./catalog.js";
import { parameterNames, validateCallArgs } from "./call-card.js";
import { classifyTool } from "./policy.js";
import type {
  CatalogPrompt,
  CatalogResource,
  CatalogResourceTemplate,
  CatalogTool,
  CompactTool,
  JsonRecord,
  McpCallResult,
  McpSource,
  ToolSearchHits,
} from "./types.js";
import { optionalMcpCall } from "./mcp-compat.js";

export interface McpServerDirs {
  root: string;
  data: string;
}

export interface McpGatewayOptions {
  serverDirs(id: string): Promise<McpServerDirs>;
  onChanged?: () => void | Promise<void>;
  oauthTimeoutMs?: number;
  requestTimeoutMs?: number;
  oauth?: {
    getProvider(id: string, serverUrl: URL): Promise<McpOAuthProvider>;
  };
  onElicitation?: (request: unknown, id: string) => Promise<unknown>;
  stdioHost?: McpStdioHost;
  searchWaitMs?: number;
}

export interface McpStdioConfig {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface McpStdioCatalog {
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
}

export interface McpStdioHost {
  start(config: McpStdioConfig, signal?: AbortSignal): Promise<McpStdioCatalog>;
  refresh(id: string, signal?: AbortSignal): Promise<McpStdioCatalog>;
  close(id: string, signal?: AbortSignal): Promise<void>;
  callTool(id: string, name: string, args: JsonRecord, toolDefinition?: Tool, signal?: AbortSignal): Promise<unknown>;
  getPrompt(id: string, name: string, args: JsonRecord, signal?: AbortSignal): Promise<unknown>;
  readResource(id: string, uri: string, signal?: AbortSignal): Promise<unknown>;
  onWorkerExit?(handler: (hostId: string) => void | Promise<void>): () => void;
  onCatalogChanged?(handler: (id: string, kind: "tools" | "prompts" | "resources", error: string | null) => void | Promise<void>): () => void;
  onConnectionChanged?(handler: (id: string, status: "closed" | "error", error: string | null) => void | Promise<void>): () => void;
}

const MCP_CLIENT_INFO = { name: "bb-mcps", version: "0.1.0" };
const CONNECT_TIMEOUT_MS = 15_000;
const OAUTH_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_GRACE_MS = 1_000;
const CLOSE_TIMEOUT_MS = 2_000;
const RETRY_AFTER_MS = 5_000;
const CATALOG_TTL_MS = 5 * 60_000;
const SEARCH_WAIT_MS = 3_000;

function errorText(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function isOAuthStateMismatch(error: unknown): boolean { return errorText(error) === "MCP OAuth state mismatch"; }
function authorizationFailure(params: URLSearchParams): string {
  const code = params.get("error") ?? "unknown_error";
  const description = params.get("error_description");
  return `MCP authorization failed: ${code}${description ? ` — ${description}` : ""}`;
}

type RefKind = "tool" | "prompt" | "resource" | "resource-template";

const ID_PREFIX: Record<RefKind, string> = { tool: "mcpt", prompt: "mcpp", resource: "mcpr", "resource-template": "mcprt" };
const ID_SOURCE: Record<RefKind, string> = { tool: "mcp_search", prompt: "mcp_prompts", resource: "mcp_resources", "resource-template": "mcp_resources" };

function exposedId(kind: RefKind, sourceId: string, name: string): string {
  const hash = crypto.createHash("sha256").update(JSON.stringify([kind, sourceId, name])).digest("hex");
  return `${ID_PREFIX[kind]}_${BigInt("0x" + hash).toString(36).slice(0, 10)}`;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function asRecordArray(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is JsonRecord => asRecord(item) !== undefined);
}

function toolSchema(value: unknown): JsonRecord {
  const record = asRecord(value);
  return record ?? { type: "object", properties: {}, additionalProperties: true };
}

function omitUndefined<T extends object>(value: T): T {
  for (const key of Object.keys(value)) {
    if ((value as Record<string, unknown>)[key] === undefined) delete (value as Record<string, unknown>)[key];
  }
  return value;
}

interface Connected {
  kind: "local" | "host";
  client?: Client;
  transport?: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
  host?: McpStdioHost;
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
  expectedClose: boolean;
  provider?: McpOAuthProvider;
}

interface PendingAuth {
  client: Client;
  transport: StreamableHTTPClientTransport | SSEClientTransport;
  provider: McpOAuthProvider;
}

interface Failure { message: string; at: number; }

interface CatalogCache {
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
  toolSearchText: Map<string, string>;
  updatedAt: number;
  error: string | null;
}

interface CatalogRef {
  kind: RefKind;
  sourceId: string;
  name: string;
}

interface ServerConfig {
  type: "stdio" | "streamable-http" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
}

class SessionExpiredError extends Error {}

class AuthenticationRequiredError extends Error {
  constructor(readonly authorizationUrl: string) {
    super("MCP authorization is required");
    this.name = "AuthenticationRequiredError";
  }
}

function parseServerConfig(rawJson: string): ServerConfig | null {
  try { return JSON.parse(rawJson) as ServerConfig; } catch { return null; }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    p.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function isJsonRpcBody(body: BodyInit | null | undefined): boolean {
  if (typeof body !== "string") return false;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return parsed.some((item) => asRecord(item)?.jsonrpc === "2.0");
    return asRecord(parsed)?.jsonrpc === "2.0";
  } catch {
    return false;
  }
}

export function isMcpRequest(url: URL, configuredUrl: URL, input: RequestInfo | URL, init: RequestInit | undefined): boolean {
  if (url.origin !== configuredUrl.origin) return false;
  const requestHeaders = new Headers(init?.headers ?? (typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined));
  const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  const exactConfiguredEndpoint = url.pathname === configuredUrl.pathname && url.search === configuredUrl.search;
  if (method === "GET" && requestHeaders.get("accept")?.toLowerCase().includes("text/event-stream")) return true;
  if (method === "POST" && isJsonRpcBody(init?.body ?? null)) return true;
  return exactConfiguredEndpoint && method === "DELETE";
}

export function redirectGuardFetch(url: URL, baseHeaders: Record<string, string> | undefined, timeoutMs = OAUTH_TIMEOUT_MS): typeof fetch {
  return async (input, init) => {
    const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const useMcpHeaders = isMcpRequest(requestUrl, url, input, init);
    const headers = new Headers(typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined);
    if (useMcpHeaders) {
      new Headers(baseHeaders).forEach((value, name) => headers.set(name, value));
    }
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    const controller = new AbortController();
    const sourceSignals = [
      init?.signal,
      typeof Request !== "undefined" && input instanceof Request ? input.signal : undefined,
    ].filter((signal): signal is AbortSignal => signal !== undefined);
    const forwardAbort = (signal: AbortSignal) => () => controller.abort(signal.reason);
    const abortListeners = sourceSignals.map((signal) => {
      const listener = forwardAbort(signal);
      if (signal.aborted) listener();
      else signal.addEventListener("abort", listener, { once: true });
      return { signal, listener };
    });
    const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(new Error(`MCP HTTP request timed out after ${timeoutMs}ms`)), timeoutMs) : undefined;
    try {
      const response = await fetch(input as URL | RequestInfo, {
        ...(init as RequestInit),
        headers,
        signal: controller.signal,
        redirect: "manual",
      });
      if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
        throw new Error(`redirect blocked for ${url}: ${response.headers.get("location")}`);
      }
      return response;
    } finally {
      if (timer) clearTimeout(timer);
      for (const { signal, listener } of abortListeners) signal.removeEventListener("abort", listener);
    }
  };
}

function contentResult(result: unknown): McpCallResult {
  const record = asRecord(result) ?? {};
  return omitUndefined({
    content: (asRecordArray(record.content) ?? []) as JsonRecord[],
    isError: typeof record.isError === "boolean" ? record.isError : undefined,
    structuredContent: record.structuredContent,
    _meta: asRecord(record._meta),
  });
}

function responseRecord(result: unknown): JsonRecord {
  return asRecord(result) ?? {};
}

export class McpGateway {
  private readonly conns = new Map<string, Connected>();
  private readonly reconnects = new Map<string, Promise<string | null>>();
  private readonly pending = new Map<string, Promise<Connected>>();
  private readonly connectControllers = new Map<string, AbortController>();
  private readonly oauthPending = new Map<string, PendingAuth>();
  private readonly providerLoads = new Map<string, Promise<McpOAuthProvider>>();
  private readonly providers = new Map<string, McpOAuthProvider>();
  private readonly failures = new Map<string, Failure>();
  private readonly catalogCache = new Map<string, CatalogCache>();
  private readonly catalogControllers = new Map<string, AbortController>();
  private readonly catalogLoads = new Map<string, Promise<CatalogCache>>();
  private readonly catalogGenerations = new Map<string, object>();
  private readonly catalogIndex = new Map<string, CatalogRef>();
  private readonly serverIndex = new Map<string, Set<string>>();
  private readonly serverEpochs = new Map<string, object>();
  private readonly hostExitUnsubscribe?: () => void;
  private readonly hostCatalogUnsubscribe?: () => void;
  private readonly hostConnectionUnsubscribe?: () => void;
  private closed = false;

  constructor(
    private readonly store: McpsStore,
    private readonly log: { info(m: string): void; warn(m: string): void; error(m: string): void },
    private readonly options: McpGatewayOptions,
  ) {
    this.hostExitUnsubscribe = options.stdioHost?.onWorkerExit?.(() => {
      void this.handleHostWorkerExit();
    });
    this.hostCatalogUnsubscribe = options.stdioHost?.onCatalogChanged?.((id, kind, error) => {
      this.onCatalogChanged(id, kind, error ? new Error(error) : null, undefined);
    });
    this.hostConnectionUnsubscribe = options.stdioHost?.onConnectionChanged?.((id, status, error) => {
      void this.handleHostConnectionChanged(id, status, error);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.catalogControllers.values()) controller.abort();
    for (const controller of this.connectControllers.values()) controller.abort(new Error("MCP gateway closing"));
    await Promise.allSettled([...this.pending.entries()].map(async ([id, pending]) => {
      try { await withTimeout(pending, CLOSE_TIMEOUT_MS, `wait for MCP connection ${id}`); }
      catch (error) { this.log.warn(`wait for MCP connection ${id}: ${errorText(error)}`); }
    }));
    const all = new Map<string, Connected | PendingAuth>();
    for (const [id, conn] of this.conns) all.set(id, conn);
    for (const [id, pending] of this.oauthPending) all.set(id, pending);
    this.conns.clear();
    this.oauthPending.clear();
    this.failures.clear();
    await Promise.all([...all.entries()].map(async ([id, value]) => {
      try {
        if ("expectedClose" in value) await this.closeConnected(id, value);
        else await this.closePendingAuthValue(id, value);
      } catch (e) { this.log.warn(`close ${id}: ${errorText(e)}`); }
    }));
    this.catalogCache.clear();
    this.catalogIndex.clear();
    this.serverIndex.clear();
    this.catalogGenerations.clear();
    this.catalogLoads.clear();
    this.catalogControllers.clear();
    this.providers.clear();
    this.providerLoads.clear();
    this.serverEpochs.clear();
    this.hostExitUnsubscribe?.();
    this.hostCatalogUnsubscribe?.();
    this.hostConnectionUnsubscribe?.();
  }

  async closeServer(id: string): Promise<void> {
    this.serverEpochs.delete(id);
    this.connectControllers.get(id)?.abort(new Error(`MCP connection cancelled for ${id}`));
    const pendingConnect = this.pending.get(id);
    if (pendingConnect) {
      try { await withTimeout(pendingConnect, CLOSE_TIMEOUT_MS, `wait for MCP connection ${id}`); }
      catch (error) { this.log.warn(`wait for MCP connection ${id}: ${errorText(error)}`); }
      if (this.pending.get(id) === pendingConnect) this.pending.delete(id);
    }
    const conn = this.conns.get(id);
    const auth = this.oauthPending.get(id);
    this.conns.delete(id);
    this.oauthPending.delete(id);
    this.failures.delete(id);
    this.invalidateCatalog(id);
    const value = conn ?? auth;
    if (!value) return;
    try {
      if ("expectedClose" in value) await this.closeConnected(id, value);
      else await this.closePendingAuthValue(id, value);
    } catch (e) { this.log.warn(`close ${id}: ${errorText(e)}`); }
  }

  private async closeConnected(id: string, connection: Connected): Promise<void> {
    connection.expectedClose = true;
    if (connection.kind === "host") {
      if (connection.host) {
        const controller = new AbortController();
        await withTimeout(
          connection.host.close(id, controller.signal),
          CLOSE_TIMEOUT_MS,
          `close isolated MCP ${id}`,
          () => controller.abort(new Error(`close isolated MCP ${id} timed out`)),
        );
      }
      return;
    }
    if (connection.client) await withTimeout(connection.client.close(), CLOSE_TIMEOUT_MS, `close ${id}`);
  }

  private async closePendingAuthValue(id: string, pending: PendingAuth): Promise<void> {
    await Promise.all([
      withTimeout(pending.transport.close(), CLOSE_TIMEOUT_MS, `close pending MCP OAuth transport ${id}`)
        .catch((error) => this.log.warn(`close pending MCP OAuth transport ${id}: ${errorText(error)}`)),
      withTimeout(pending.client.close(), CLOSE_TIMEOUT_MS, `close ${id}`)
        .catch((error) => this.log.warn(`close pending MCP OAuth client ${id}: ${errorText(error)}`)),
    ]);
  }

  private async handleHostWorkerExit(): Promise<void> {
    if (this.closed) return;
    const isolated = [...this.conns.entries()].filter(([, connection]) => connection.kind === "host");
    for (const [id, connection] of isolated) {
      if (this.conns.get(id) !== connection) continue;
      this.conns.delete(id);
      const message = "Isolated MCP worker exited; the server will reconnect on the next request";
      this.failures.set(id, { message, at: Date.now() });
      this.invalidateCatalog(id);
      this.store.setStatus(id, "error", message);
    }
    if (isolated.length > 0) await this.notifyChanged();
  }

  private async handleHostConnectionChanged(id: string, status: "closed" | "error", error: string | null): Promise<void> {
    const connection = this.conns.get(id);
    if (!connection || connection.kind !== "host") return;
    this.conns.delete(id);
    this.invalidateCatalog(id);
    const message = error ?? `Isolated MCP transport ${status}`;
    this.store.setStatus(id, "error", message);
    this.failures.set(id, { message, at: Date.now() });
    await this.notifyChanged();
  }

  async resetServer(id: string): Promise<void> {
    const provider = this.providers.get(id);
    await this.closeServer(id);
    if (provider) await provider.clearPending().catch((error) => this.log.warn(`clear MCP OAuth state ${id}: ${errorText(error)}`));
    this.providers.delete(id);
    this.providerLoads.delete(id);
  }

  async startServer(id: string): Promise<void> { await this.ensureServer(id); }

  async authUrl(id: string): Promise<string | null> {
    const cfg = this.validatedConfig(this.serverRecord(id));
    if (cfg.type === "stdio") return null;
    const provider = await this.providerFor(id, new URL(cfg.url!));
    const existing = await provider.authorizationUrlValue();
    if (existing) return existing;
    try {
      await this.startServer(id);
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
    }
    return await provider.authorizationUrlValue() ?? null;
  }

  async authStatus(id: string): Promise<"unauthenticated" | "authorizing" | "authenticated"> {
    const cfg = this.validatedConfig(this.serverRecord(id));
    if (cfg.type === "stdio") return "authenticated";
    const provider = await this.providerFor(id, new URL(cfg.url!));
    return provider.status();
  }

  async reconnectServer(id: string): Promise<string | null> {
    const existing = this.reconnects.get(id);
    if (existing) return existing;
    const work = this.reconnectOnce(id);
    this.reconnects.set(id, work);
    try { return await work; }
    finally { if (this.reconnects.get(id) === work) this.reconnects.delete(id); }
  }

  private async reconnectOnce(id: string): Promise<string | null> {
    const record = this.serverRecord(id);
    if (!record.enabled) throw new Error(`MCP server ${record.handle} is disabled`);
    await this.closeServer(id);
    this.store.setStatus(id, "idle", null);
    try {
      await this.startServer(id);
      return null;
    } catch (error) {
      if (error instanceof AuthenticationRequiredError) return error.authorizationUrl;
      throw error;
    }
  }

  async finishAuth(id: string, params: URLSearchParams): Promise<void> {
    const pending = this.oauthPending.get(id);
    if (!pending) {
      const cfg = this.validatedConfig(this.serverRecord(id));
      if (cfg.type === "stdio") throw new Error("MCP OAuth is only available for HTTP transports");
      const provider = await this.providerFor(id, new URL(cfg.url!));
      try {
        await provider.validateState(params.get("state"));
      } catch (error) {
        if (!isOAuthStateMismatch(error)) this.log.warn(`MCP OAuth callback validation failed for ${id}: ${errorText(error)}`);
        throw error;
      }
      if (params.get("error")) {
        const message = authorizationFailure(params);
        await this.cancelPendingAuthentication(id, provider, undefined, message);
        throw new Error(message);
      }
      const transport = this.createHttpTransport(cfg, provider);
      try {
        await withTimeout(
          transport.finishAuth(params),
          this.options.oauthTimeoutMs ?? OAUTH_TIMEOUT_MS,
          `OAuth token exchange ${id}`,
          () => { void transport.close().catch(() => {}); },
        );
      } catch (error) {
        await this.cancelPendingAuthentication(id, provider, undefined, errorText(error));
        throw error;
      } finally {
        try { await withTimeout(transport.close(), CLOSE_TIMEOUT_MS, `close OAuth transport ${id}`); } catch {}
      }
      try {
        await provider.clearPending();
        await withTimeout(this.ensureServer(id), CONNECT_TIMEOUT_MS, `reconnect ${id}`);
        this.store.setStatus(id, "ready", null);
        this.failures.delete(id);
        await this.notifyChanged();
      } catch (error) {
        const message = errorText(error);
        this.store.setStatus(id, "error", message);
        await this.notifyChanged();
        throw new Error(message);
      }
      return;
    }
    try {
      await pending.provider.validateState(params.get("state"));
    } catch (error) {
      if (!isOAuthStateMismatch(error)) this.log.warn(`MCP OAuth callback validation failed for ${id}: ${errorText(error)}`);
      throw error;
    }
    if (params.get("error")) {
      const message = authorizationFailure(params);
      await this.cancelPendingAuthentication(id, pending.provider, pending, message);
      throw new Error(message);
    }
    try {
      await withTimeout(
        pending.transport.finishAuth(params),
        this.options.oauthTimeoutMs ?? OAUTH_TIMEOUT_MS,
        `OAuth token exchange ${id}`,
        () => { void pending.transport.close().catch(() => {}); },
      );
    } catch (error) {
      await this.cancelPendingAuthentication(id, pending.provider, pending, errorText(error));
      throw error;
    }
    try {
      await pending.provider.clearPending();
    } catch (error) {
      await this.closePendingAuth(id, pending);
      this.store.setStatus(id, "error", errorText(error));
      await this.notifyChanged();
      throw error;
    }
    await this.closePendingAuth(id, pending);
    try {
      await withTimeout(this.ensureServer(id), CONNECT_TIMEOUT_MS, `reconnect ${id}`);
      this.failures.delete(id);
      await this.notifyChanged();
    } catch (error) {
      const message = errorText(error);
      this.store.setStatus(id, "error", message);
      await this.notifyChanged();
      throw new Error(message);
    }
  }

  async cancelAuthentication(id: string): Promise<void> {
    const record = this.serverRecord(id);
    const cfg = this.validatedConfig(record);
    if (cfg.type === "stdio") return;
    const provider = await this.providerFor(id, new URL(cfg.url!));
    await this.closeServer(id);
    try {
      await provider.clearPending();
      this.store.setStatus(id, record.enabled ? "needs-auth" : "disabled", null);
      await this.notifyChanged();
    } catch (error) {
      this.store.setStatus(id, "error", errorText(error));
      await this.notifyChanged();
      throw error;
    }
  }

  private cacheCatalog(id: string, connection: Connected, error: string | null = null): CatalogCache {
    const toolSearchText = new Map<string, string>();
    for (const tool of connection.tools) {
      toolSearchText.set(
        tool.name,
        [tool.name, tool.description ?? "", ...parameterNames(toolSchema(tool.inputSchema))].join("\n").toLowerCase(),
      );
    }
    const cached: CatalogCache = {
      tools: connection.tools,
      prompts: connection.prompts,
      resources: connection.resources,
      resourceTemplates: connection.resourceTemplates,
      toolSearchText,
      updatedAt: Date.now(),
      error,
    };
    this.catalogCache.set(id, cached);
    this.indexCatalog(id, cached);
    return cached;
  }

  private invalidateCatalog(id: string): void {
    this.catalogGenerations.delete(id);
    this.catalogControllers.get(id)?.abort();
    this.catalogControllers.delete(id);
    this.catalogCache.delete(id);
    this.catalogLoads.delete(id);
    this.dropIndex(id);
  }

  private dropIndex(id: string): void {
    for (const refId of this.serverIndex.get(id) ?? []) this.catalogIndex.delete(refId);
    this.serverIndex.delete(id);
  }

  private indexCatalog(sourceId: string, catalog: CatalogCache): void {
    this.dropIndex(sourceId);
    const refIds = new Set<string>();
    this.serverIndex.set(sourceId, refIds);
    const index = (kind: RefKind, name: string) => {
      const refId = exposedId(kind, sourceId, name);
      refIds.add(refId);
      this.catalogIndex.set(refId, { kind, sourceId, name });
    };
    if (!catalog.error) {
      this.store.seedToolPolicies(sourceId, catalog.tools.map((tool) => ({ name: tool.name, risk: classifyTool(asRecord(tool.annotations)) })));
    }
    for (const tool of catalog.tools) index("tool", tool.name);
    for (const prompt of catalog.prompts) index("prompt", prompt.name);
    for (const resource of catalog.resources) index("resource", resource.uri);
    for (const template of catalog.resourceTemplates) index("resource-template", template.uriTemplate);
  }

  private async resolveRef(kind: RefKind, id: string): Promise<CatalogRef> {
    const cached = this.catalogIndex.get(id);
    if (cached?.kind === kind) return cached;
    if (!new RegExp(`^${ID_PREFIX[kind]}_[a-z0-9]{10}$`).test(id)) {
      throw new Error(`Invalid MCP ${kind} id: ${id}. Use an id returned by ${ID_SOURCE[kind]}.`);
    }
    try {
      return await Promise.any(this.store.listEnabled().map(async (record) => {
        const catalog = await this.getCatalog(record);
        const names = kind === "tool" ? catalog.tools.map((item) => item.name)
          : kind === "prompt" ? catalog.prompts.map((item) => item.name)
          : kind === "resource" ? catalog.resources.map((item) => item.uri)
          : catalog.resourceTemplates.map((item) => item.uriTemplate);
        const name = names.find((candidate) => exposedId(kind, record.id, candidate) === id);
        if (name === undefined) throw new Error("No match");
        return { kind, sourceId: record.id, name };
      }));
    } catch { throw new Error(`MCP ${kind} not found: ${id}`); }
  }

  private async getCatalog(record: McpSource): Promise<CatalogCache> {
    if (this.closed) throw new Error("MCP gateway closed");
    if (!record.enabled) throw new Error("MCP server is not enabled");
    const id = record.id;
    const cached = this.catalogCache.get(id);
    const age = cached ? Date.now() - cached.updatedAt : Number.POSITIVE_INFINITY;
    if (cached?.error && age < RETRY_AFTER_MS) throw new Error(cached.error);
    if (cached && !cached.error && age < CATALOG_TTL_MS) return cached;
    const existingLoad = this.catalogLoads.get(id);
    if (existingLoad) return existingLoad;
    const generation = {};
    this.catalogGenerations.set(id, generation);
    const controller = new AbortController();
    this.catalogControllers.set(id, controller);

    const load = (async () => {
      try {
        const hadConnection = this.conns.has(id);
        const connection = await this.ensureServer(id);
        if (cached || hadConnection) {
          await withTimeout(
            this.refreshCatalog(id, connection, controller.signal),
            CONNECT_TIMEOUT_MS,
            `refresh MCP catalog ${record.handle}`,
            () => controller.abort(new Error(`MCP catalog refresh timed out for ${record.handle}`)),
          );
        }
        controller.signal.throwIfAborted();
        if (this.catalogGenerations.get(id) !== generation) throw new Error(`MCP catalog invalidated for ${record.handle}`);
        const connectedCache = this.catalogCache.get(id);
        if (!cached && connectedCache && connectedCache.tools === connection.tools) return connectedCache;
        this.store.setStatus(id, "ready", null);
        const catalog = this.cacheCatalog(id, connection);
        void this.notifyChanged();
        return catalog;
      } catch (error) {
        if (!this.closed && this.catalogGenerations.get(id) === generation) {
          const message = errorText(error);
          if (error instanceof SessionExpiredError) {
            const connection = this.conns.get(id);
            this.conns.delete(id);
            if (connection) await this.closeConnected(id, connection);
          }
          const provider = this.providers.get(id);
          const needsAuth = provider && await provider.authorizationUrlValue();
          if (this.closed || this.catalogGenerations.get(id) !== generation) throw error;
          this.store.setStatus(id, needsAuth ? "needs-auth" : "error", needsAuth ? "Authentication required" : message);
          this.cacheCatalog(id, { kind: "local", tools: [], prompts: [], resources: [], resourceTemplates: [], expectedClose: false }, message);
          void this.notifyChanged();
        }
        throw error;
      }
    })();
    this.catalogLoads.set(id, load);
    try { return await load; }
    finally {
      if (this.catalogLoads.get(id) === load) this.catalogLoads.delete(id);
      if (this.catalogControllers.get(id) === controller) this.catalogControllers.delete(id);
    }
  }

  async warm(): Promise<void> {
    await Promise.all(this.store.listEnabled().map(async (record) => {
      const cached = this.catalogCache.get(record.id);
      if (cached && !cached.error) return;
      try {
        const catalog = await this.getCatalog(record);
        this.log.info(`MCP warmed ${record.handle} (${catalog.tools.length} tools)`);
      } catch (error) {
        if (!this.closed) this.log.info(`MCP warmup skipped ${record.handle}: ${errorText(error)}`);
      }
    }));
  }

  async inspectServer(id: string): Promise<{ tools: CompactTool[]; error: string | null }> {
    const record = this.serverRecord(id);
    if (!record.enabled) return { tools: [], error: null };
    try {
      const catalog = await this.getCatalog(record);
      return { tools: catalog.tools.map((tool) => compactToolFromCatalog(this.catalogTool(record, tool))), error: catalog.error };
    } catch (error) {
      return { tools: [], error: errorText(error) };
    }
  }

  catalogCounts(id: string): { tools: number; prompts: number; resources: number } | null {
    const cached = this.catalogCache.get(id);
    if (!cached || cached.error) return null;
    return { tools: cached.tools.length, prompts: cached.prompts.length, resources: cached.resources.length };
  }

  async getTool(id: string): Promise<CatalogTool> {
    const ref = await this.resolveRef("tool", id);
    const record = this.serverRecord(ref.sourceId);
    if (!record.enabled) throw new Error(`MCP server is not enabled: ${record.handle}`);
    const catalog = await this.getCatalog(record);
    const tool = catalog.tools.find((item) => item.name === ref.name);
    if (!tool) throw new Error(`MCP tool not found: ${id}`);
    return this.catalogTool(record, tool);
  }

  peekTool(id: string): CatalogTool | null {
    const ref = this.catalogIndex.get(id);
    if (ref?.kind !== "tool") return null;
    const record = this.store.get(ref.sourceId);
    const cached = this.catalogCache.get(ref.sourceId);
    if (!record?.enabled || !cached || cached.error) return null;
    const tool = cached.tools.find((item) => item.name === ref.name);
    return tool ? this.catalogTool(record, tool) : null;
  }

  async searchTools(query: string, limit = SEARCH_LIMIT, server?: string): Promise<ToolSearchHits> {
    const q = query.trim();
    if (!q) return { tools: [], unavailable: [] };
    const servers = this.selectedServers(server);
    const waitMs = this.options.searchWaitMs ?? SEARCH_WAIT_MS;
    const loaded = new Map<string, { catalog: CatalogCache; generation: object | undefined }>();
    const loads = servers.map((record) => this.getCatalog(record).then(
      (catalog) => { loaded.set(record.id, { catalog, generation: this.catalogGenerations.get(record.id) }); },
      () => {},
    ));
    if (loads.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([Promise.all(loads), new Promise<void>((resolve) => { timer = setTimeout(resolve, waitMs); })]);
      } finally { if (timer) clearTimeout(timer); }
    }
    const unavailable: string[] = [];
    const tokens = tokenize(q);
    const normalizedQuery = q.toLowerCase();
    const exactRef = this.catalogIndex.get(q);
    const ranked: Array<{ score: number; tool: Tool; record: McpSource }> = [];
    for (const record of servers) {
      const result = loaded.get(record.id);
      if (!this.store.get(record.id)?.enabled) continue;
      if (result && result.generation !== this.catalogGenerations.get(record.id)) continue;
      const cached = result?.catalog ?? this.catalogCache.get(record.id);
      if (!cached) {
        unavailable.push(record.name);
        continue;
      }
      if (cached.error) {
        unavailable.push(`${record.name}: ${cached.error}`);
        continue;
      }
      const serverText = `${record.name.toLowerCase()}\n${record.handle}`;
      for (const tool of cached.tools) {
        const exact = tool.name.toLowerCase() === normalizedQuery || (exactRef?.kind === "tool" && exactRef.sourceId === record.id && exactRef.name === tool.name);
        let score = scoreTokens(tokens, tool.name.toLowerCase(), `${serverText}\n${cached.toolSearchText.get(tool.name) ?? tool.name}`);
        if (exact) score += 50;
        if (score <= 0) continue;
        ranked.push({ score, tool, record });
      }
    }
    ranked.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
    const cap = Math.min(Math.max(1, limit), SEARCH_MAX);
    return {
      tools: ranked.slice(0, cap).map((hit) => compactToolFromCatalog(this.catalogTool(hit.record, hit.tool), { card: true })),
      unavailable,
    };
  }

  async call(id: string, args: JsonRecord, signal?: AbortSignal): Promise<McpCallResult> {
    const definition = await this.getTool(id);
    const invalid = validateCallArgs(definition.inputSchema, args);
    if (invalid) throw new Error(`Invalid arguments for ${definition.name}: ${invalid}`);
    const conn = await this.ensureServer(definition.sourceId);
    const tool = conn.tools.find((item) => item.name === definition.name);
    const result = await this.withAuthState(definition.sourceId, () => this.callTool(definition.sourceId, conn, definition.name, args, tool, signal));
    return contentResult(result);
  }

  async listPrompts(server?: string): Promise<CatalogPrompt[]> {
    const result: CatalogPrompt[] = [];
    for (const record of this.selectedServers(server)) {
      try {
        const catalog = await this.getCatalog(record);
        for (const prompt of catalog.prompts) {
          result.push({ ...this.ref("prompt", record, prompt.name), name: prompt.name, ...(prompt.description ? { description: prompt.description } : {}) });
        }
      } catch (error) { this.log.warn(`listPrompts skip ${record.handle}: ${errorText(error)}`); }
    }
    return result;
  }

  async getPrompt(id: string, args: JsonRecord = {}, signal?: AbortSignal): Promise<JsonRecord> {
    const ref = await this.resolveRef("prompt", id);
    const conn = await this.ensureServer(ref.sourceId);
    const argumentsMap: Record<string, string> = {};
    for (const [name, value] of Object.entries(args)) {
      if (typeof value !== "string") throw new Error(`Prompt argument ${name} must be a string`);
      argumentsMap[name] = value;
    }
    return responseRecord(await this.withAuthState(ref.sourceId, () => {
      if (conn.kind === "host") return conn.host!.getPrompt(ref.sourceId, ref.name, argumentsMap, signal);
      return conn.client!.getPrompt({ name: ref.name, arguments: argumentsMap }, signal ? { signal } : undefined);
    }));
  }

  async listResources(server?: string): Promise<CatalogResource[]> {
    const result: CatalogResource[] = [];
    for (const record of this.selectedServers(server)) {
      try {
        const catalog = await this.getCatalog(record);
        for (const resource of catalog.resources) result.push({ ...this.ref("resource", record, resource.uri), uri: resource.uri, name: resource.name });
      } catch (error) { this.log.warn(`listResources skip ${record.handle}: ${errorText(error)}`); }
    }
    return result;
  }

  async listResourceTemplates(server?: string): Promise<CatalogResourceTemplate[]> {
    const result: CatalogResourceTemplate[] = [];
    for (const record of this.selectedServers(server)) {
      try {
        const catalog = await this.getCatalog(record);
        for (const template of catalog.resourceTemplates) {
          result.push({ ...this.ref("resource-template", record, template.uriTemplate), uriTemplate: template.uriTemplate, name: template.name });
        }
      } catch (error) { this.log.warn(`listResourceTemplates skip ${record.handle}: ${errorText(error)}`); }
    }
    return result;
  }

  async readResource(id: string, signal?: AbortSignal): Promise<JsonRecord> {
    const ref = await this.resolveRef("resource", id);
    const conn = await this.ensureServer(ref.sourceId);
    return responseRecord(await this.withAuthState(ref.sourceId, () => {
      if (conn.kind === "host") return conn.host!.readResource(ref.sourceId, ref.name, signal);
      return conn.client!.readResource({ uri: ref.name }, signal ? { signal } : undefined);
    }));
  }

  private async callTool(id: string, conn: Connected, name: string, args: JsonRecord, tool?: Tool, signal?: AbortSignal): Promise<unknown> {
    if (conn.kind === "host") return conn.host!.callTool(id, name, args, tool, signal);
    return conn.client!.callTool(
      { name, arguments: args as Record<string, unknown> },
      { ...(signal ? { signal } : {}), ...(tool ? { toolDefinition: tool } : {}) },
    );
  }

  private async ensureServer(id: string): Promise<Connected> {
    if (this.closed) throw new Error("MCP gateway closed");
    const record = this.serverRecord(id);
    if (!record.enabled) throw new Error(`MCP server ${record.handle} is disabled`);
    const existing = this.conns.get(id);
    if (existing) return existing;
    const pendingAuth = this.oauthPending.get(id);
    if (pendingAuth) throw new AuthenticationRequiredError(pendingAuth.provider.getAuthorizationUrl() ?? "");
    const inFlight = this.pending.get(id);
    if (inFlight) return inFlight;
    const failure = this.failures.get(id);
    if (failure && Date.now() - failure.at < RETRY_AFTER_MS) throw new Error(failure.message);
    const cfg = this.validatedConfig(record);
    const controller = new AbortController();
    this.connectControllers.set(id, controller);
    const connectPromise = this.connectServer(record, cfg, controller.signal);
    this.pending.set(id, connectPromise);
    try { return await connectPromise; }
    finally {
      if (this.pending.get(id) === connectPromise) this.pending.delete(id);
      if (this.connectControllers.get(id) === controller) this.connectControllers.delete(id);
    }
  }

  private async connectServer(record: McpSource, cfg: ServerConfig, signal: AbortSignal): Promise<Connected> {
    const { id, handle } = record;
    const epoch = {};
    this.serverEpochs.set(id, epoch);
    let client: Client | undefined;
    let transport: Connected["transport"] | undefined;
    let provider: McpOAuthProvider | undefined;
    let connection: Connected | undefined;
    try {
      if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("MCP connection cancelled");
      if (cfg.type === "stdio" && this.options.stdioHost) {
        const stdio = await this.expandedStdioConfig(id, cfg);
        const catalog = await withTimeout(
          this.options.stdioHost.start(stdio, signal),
          CONNECT_TIMEOUT_MS,
          `start isolated MCP ${handle}`,
          () => this.connectControllers.get(id)?.abort(new Error(`start isolated MCP ${handle} timed out`)),
        );
        connection = {
          kind: "host",
          host: this.options.stdioHost,
          tools: catalog.tools,
          prompts: catalog.prompts,
          resources: catalog.resources,
          resourceTemplates: catalog.resourceTemplates,
          expectedClose: false,
        };
      } else {
        const clientOptions: ClientOptions = {
          capabilities: this.options.onElicitation ? { elicitation: { form: {} } } : {},
          versionNegotiation: { mode: "auto" },
          listChanged: {
            tools: { autoRefresh: true, onChanged: (error, items) => this.onCatalogChanged(id, "tools", error, items) },
            prompts: { autoRefresh: true, onChanged: (error, items) => this.onCatalogChanged(id, "prompts", error, items) },
            resources: { autoRefresh: true, onChanged: (error, items) => this.onCatalogChanged(id, "resources", error, items) },
          },
        };
        client = new Client(MCP_CLIENT_INFO, clientOptions);
        const onElicitation = this.options.onElicitation;
        if (onElicitation) {
          (client as unknown as { setRequestHandler(method: string, handler: (request: unknown) => Promise<unknown>): void })
            .setRequestHandler("elicitation/create", (request) => onElicitation(request, id));
        }

        if (cfg.type === "streamable-http" || cfg.type === "sse") {
          provider = await this.providerFor(id, new URL(cfg.url!));
          transport = this.createHttpTransport(cfg, provider);
        } else {
          const stdio = await this.expandedStdioConfig(id, cfg);
          transport = new StdioClientTransport({ command: stdio.command, args: stdio.args, cwd: stdio.cwd, env: stdio.env, stderr: "pipe" });
          transport.stderr?.on("data", (chunk: Buffer) => {
            const message = chunk.toString("utf8").trim();
            if (message) this.log.warn(`MCP ${handle} stderr: ${message.slice(0, 2000)}`);
          });
        }

        connection = { kind: "local", client, transport, tools: [], prompts: [], resources: [], resourceTemplates: [], expectedClose: false, provider };
        this.installTransportHandlers(record, connection);
        await withTimeout(
          client.connect(transport, { signal, timeout: CONNECT_TIMEOUT_MS }),
          CONNECT_TIMEOUT_MS,
          `connect ${handle}`,
          () => { void client?.close().catch(() => {}); },
        );
        await withTimeout(
          this.refreshCatalog(id, connection, signal),
          CONNECT_TIMEOUT_MS,
          `list MCP capabilities ${handle}`,
          () => this.connectControllers.get(id)?.abort(new Error(`list MCP capabilities ${handle} timed out`)),
        );
      }
      if (provider) await provider.clearPending();
      if (this.closed) throw new Error("MCP gateway closed");
      if (this.serverEpochs.get(id) !== epoch) throw new Error(`MCP connection cancelled for ${handle}`);
      this.conns.set(id, connection);
      this.cacheCatalog(id, connection);
      this.oauthPending.delete(id);
      this.failures.delete(id);
      this.store.setStatus(id, "ready", null);
      this.log.info(`MCP connected ${handle} (${connection.tools.length} tools, ${connection.prompts.length} prompts, ${connection.resources.length} resources)`);
      await this.notifyChanged();
      return connection;
    } catch (error) {
      const message = errorText(error);
      const cancelled = this.closed || signal.aborted || this.serverEpochs.get(id) !== epoch;
      if (cancelled) {
        if (connection) try { await this.closeConnected(id, connection); } catch {}
        else if (client) try { await withTimeout(client.close(), CLOSE_TIMEOUT_MS, `close cancelled ${handle}`); } catch {}
        if (this.conns.get(id) === connection) this.conns.delete(id);
        throw new Error(this.closed ? "MCP gateway closed" : `MCP connection cancelled for ${handle}`);
      }
      const authorizationUrl = provider ? await provider.authorizationUrlValue() : undefined;
      if (provider && client && transport && authorizationUrl) {
        this.oauthPending.set(id, { client, transport: transport as StreamableHTTPClientTransport | SSEClientTransport, provider });
        this.failures.delete(id);
        this.store.setStatus(id, "needs-auth", "Authentication required");
        await this.notifyChanged();
        throw new AuthenticationRequiredError(authorizationUrl);
      }
      this.failures.set(id, { message, at: Date.now() });
      this.store.setStatus(id, "error", message);
      if (connection) try { await this.closeConnected(id, connection); } catch {}
      else if (client) try { await withTimeout(client.close(), CLOSE_TIMEOUT_MS, `close ${handle}`); } catch {}
      this.conns.delete(id);
      throw new Error(message);
    }
  }

  private async expandedStdioConfig(id: string, cfg: ServerConfig): Promise<McpStdioConfig> {
    if (!cfg.command) throw new Error("stdio MCP server is missing command");
    const { root, data } = await this.options.serverDirs(id);
    const args = (cfg.args ?? []).map((item) => expandPlaceholders(item, root, data));
    const envOverlay: Record<string, string> = {};
    for (const [name, value] of Object.entries(cfg.env ?? {})) envOverlay[name] = expandPlaceholders(value, root, data);
    const baseEnv: Record<string, string> = {};
    for (const name of ["PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TMPDIR"]) if (process.env[name]) baseEnv[name] = process.env[name]!;
    const env = { ...baseEnv, ...envOverlay, PLUGIN_ROOT: root, PLUGIN_DATA: data };
    let cwd = root;
    if (cfg.cwd) {
      const original = cfg.cwd;
      const expanded = expandPlaceholders(original, root, data);
      let anchor = root;
      let resolved: string;
      const absoluteUserPath = path.isAbsolute(original) && !original.includes("${");
      if (original.startsWith("./")) resolved = path.resolve(root, expanded.slice(2));
      else if (original === "${PLUGIN_DATA}" || original.startsWith("${PLUGIN_DATA}/")) { anchor = data; resolved = path.resolve(expanded); }
      else resolved = path.resolve(expanded);
      if (!absoluteUserPath) {
        if (!isWithinRoot(resolved, anchor)) throw new Error(`cwd escapes ${anchor === root ? "PLUGIN_ROOT" : "PLUGIN_DATA"}: ${original} -> ${resolved}`);
        const real = await fsp.realpath(resolved).catch(() => resolved);
        if (!isWithinRoot(real, anchor)) throw new Error(`cwd realpath escapes: ${real}`);
      }
      cwd = resolved;
    }
    const executable = cfg.command.startsWith("./") ? path.resolve(root, cfg.command.slice(2)) : cfg.command;
    if (cfg.command.startsWith("./") && !isWithinRoot(executable, root)) throw new Error(`command escapes plugin root: ${cfg.command} -> ${executable}`);
    return { id, command: executable, args, cwd, env };
  }

  private installTransportHandlers(record: McpSource, conn: Connected): void {
    if (!conn.transport) return;
    conn.transport.onerror = (error) => this.log.warn(`MCP ${record.handle} error: ${errorText(error)}`);
    conn.transport.onclose = () => {
      if (conn.expectedClose || this.closed) return;
      if (this.conns.get(record.id)?.transport !== conn.transport) return;
      this.conns.delete(record.id);
      this.invalidateCatalog(record.id);
      const message = `MCP transport closed unexpectedly for ${record.handle}`;
      this.failures.set(record.id, { message, at: Date.now() });
      this.store.setStatus(record.id, "error", message);
      void this.notifyChanged();
    };
  }

  private async refreshCatalog(id: string, conn: Connected, signal?: AbortSignal): Promise<void> {
    if (conn.kind === "host") {
      if (!conn.host) throw new Error("isolated MCP connection is missing its host");
      const catalog = await conn.host.refresh(id, signal);
      conn.tools = catalog.tools;
      conn.prompts = catalog.prompts;
      conn.resources = catalog.resources;
      conn.resourceTemplates = catalog.resourceTemplates;
      return;
    }
    const options = signal ? { signal, cacheMode: "refresh" as const } : { cacheMode: "refresh" as const };
    const [tools, prompts, resources, resourceTemplates] = await Promise.all([
      optionalMcpCall(() => conn.client!.listTools(undefined, options), { tools: [] }),
      optionalMcpCall(() => conn.client!.listPrompts(undefined, options), { prompts: [] }),
      optionalMcpCall(() => conn.client!.listResources(undefined, options), { resources: [] }),
      optionalMcpCall(() => conn.client!.listResourceTemplates(undefined, options), { resourceTemplates: [] }),
    ]);
    conn.tools = tools.tools;
    conn.prompts = prompts.prompts;
    conn.resources = resources.resources;
    conn.resourceTemplates = resourceTemplates.resourceTemplates;
  }

  private onCatalogChanged(id: string, kind: "tools" | "prompts" | "resources", error: Error | null, items: unknown): void {
    if (error) this.log.warn(`MCP ${id} ${kind} refresh failed: ${errorText(error)}`);
    const conn = this.conns.get(id);
    if (conn && !error) {
      if (conn.kind === "host") {
        void this.refreshCatalog(id, conn).then(() => {
          if (this.conns.get(id) !== conn) return;
          this.cacheCatalog(id, conn);
          void this.notifyChanged();
        }).catch((refreshError) => this.log.warn(`MCP ${id} isolated catalog refresh failed: ${errorText(refreshError)}`));
        void this.notifyChanged();
        return;
      }
      if (kind === "tools" && Array.isArray(items)) conn.tools = items as Tool[];
      if (kind === "prompts" && Array.isArray(items)) conn.prompts = items as Prompt[];
      if (kind === "resources" && Array.isArray(items)) {
        conn.resources = items as Resource[];
        void optionalMcpCall(
          () => conn.client!.listResourceTemplates(undefined, { cacheMode: "refresh" }),
          { resourceTemplates: [] },
        ).then((result) => {
          if (this.conns.get(id) !== conn) return;
          conn.resourceTemplates = result.resourceTemplates;
          this.cacheCatalog(id, conn);
        }).catch((templateError) => this.log.warn(`MCP ${id} resource template refresh failed: ${errorText(templateError)}`));
      }
      this.cacheCatalog(id, conn);
    }
    void this.notifyChanged();
  }

  private serverRecord(id: string): McpSource {
    const record = this.store.get(id);
    if (!record) throw new Error(`MCP server not found: ${id}`);
    return record;
  }

  private validatedConfig(record: McpSource): ServerConfig {
    const cfg = parseServerConfig(record.configJson);
    if (!cfg) throw new Error(`invalid server config for ${record.handle}`);
    const result = validateMcpServer(cfg);
    if (!result.valid) throw new Error(`invalid server config for ${record.handle}: ${result.errors.join("; ")}`);
    return cfg;
  }

  private selectedServers(server?: string): McpSource[] {
    if (!server) return this.store.listEnabled();
    const source = this.store.resolve(server);
    if (!source) throw new Error(`MCP server not found: ${server}`);
    return source.enabled ? [source] : [];
  }

  private async providerFor(id: string, serverUrl: URL): Promise<McpOAuthProvider> {
    const existing = this.providers.get(id);
    if (existing) return existing;
    if (!this.options.oauth) throw new Error("OAuth storage is not configured");
    const loading = this.providerLoads.get(id);
    if (loading) return loading;
    const work = Promise.resolve().then(async () => {
      const provider = await this.options.oauth!.getProvider(id, serverUrl);
      await provider.alignWithRedirect();
      if (this.closed || this.providerLoads.get(id) !== work) throw new Error("MCP OAuth provider invalidated");
      this.providers.set(id, provider);
      return provider;
    });
    this.providerLoads.set(id, work);
    try { return await work; }
    finally { if (this.providerLoads.get(id) === work) this.providerLoads.delete(id); }
  }

  private createHttpTransport(cfg: ServerConfig, provider: McpOAuthProvider): StreamableHTTPClientTransport | SSEClientTransport {
    const serverUrl = new URL(cfg.url!);
    const requestTimeout = this.options.requestTimeoutMs
      ?? (this.options.oauthTimeoutMs === undefined ? OAUTH_TIMEOUT_MS + FETCH_TIMEOUT_GRACE_MS : this.options.oauthTimeoutMs + FETCH_TIMEOUT_GRACE_MS);
    const guardedFetch = redirectGuardFetch(serverUrl, cfg.headers, requestTimeout);
    const fetchWithGuard: typeof fetch = async (input, init) => {
      const response = await guardedFetch(input, init);
      const sentHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      if (response.status === 404 && sentHeaders.has("mcp-session-id")) {
        await response.body?.cancel();
        throw new SessionExpiredError("MCP session expired; the next request will reconnect");
      }
      const requestUrl = new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);
      if (response.status !== 401 || !isMcpRequest(requestUrl, serverUrl, input, init)) return response;
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const rejectedToken = headers.get("authorization");
      const currentToken = (await provider.tokens())?.access_token;
      try {
        if (!currentToken || rejectedToken === `Bearer ${currentToken}`) {
          await provider.reauthorize(response, guardedFetch);
        }
      } finally { await response.body?.cancel(); }
      const token = (await provider.tokens())?.access_token;
      if (token) headers.set("authorization", `Bearer ${token}`);
      const retry = await guardedFetch(input, { ...init, headers });
      if (retry.status === 401) {
        await retry.body?.cancel();
        throw new UnauthorizedError("Server rejected refreshed MCP credentials");
      }
      return retry;
    };
    if (cfg.type === "streamable-http") {
      return new StreamableHTTPClientTransport(serverUrl, {
        authProvider: provider as OAuthClientProvider,
        requestInit: { redirect: "manual" },
        fetch: fetchWithGuard,
      });
    }
    return new SSEClientTransport(serverUrl, {
      authProvider: provider as OAuthClientProvider,
      requestInit: { redirect: "manual" },
      fetch: fetchWithGuard,
    });
  }

  private async notifyChanged(): Promise<void> {
    try { await this.options.onChanged?.(); } catch (error) { this.log.warn(`MCP change notification failed: ${errorText(error)}`); }
  }

  private async withAuthState<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const connection = this.conns.get(id);
    try {
      return await operation();
    } catch (error) {
      if (error instanceof SessionExpiredError && this.conns.get(id) === connection) {
        await this.closeServer(id);
        this.store.setStatus(id, "idle", error.message);
        await this.notifyChanged();
      }
      const provider = this.providers.get(id);
      if (provider && await provider.authorizationUrlValue()) {
        this.store.setStatus(id, "needs-auth", "Authentication required");
        await this.notifyChanged();
      }
      throw error;
    }
  }

  private async cancelPendingAuthentication(
    id: string,
    provider: McpOAuthProvider,
    pending: PendingAuth | undefined,
    message = "Authentication was not completed",
  ): Promise<void> {
    await provider.clearPending().catch((error) => this.log.warn(`clear MCP OAuth state ${id}: ${errorText(error)}`));
    if (pending) await this.closePendingAuth(id, pending);
    this.store.setStatus(id, this.serverRecord(id).enabled ? "needs-auth" : "disabled", message);
    await this.notifyChanged();
  }

  private async closePendingAuth(id: string, pending: PendingAuth): Promise<void> {
    if (this.oauthPending.get(id) === pending) this.oauthPending.delete(id);
    await this.closePendingAuthValue(id, pending);
  }

  private ref(kind: RefKind, record: McpSource, name: string) {
    return { id: exposedId(kind, record.id, name), sourceId: record.id, handle: record.handle };
  }

  private catalogTool(record: McpSource, tool: Tool): CatalogTool {
    const annotations = asRecord(tool.annotations);
    return {
      ...this.ref("tool", record, tool.name),
      name: tool.name,
      description: tool.description?.trim() || `Call ${tool.name} on ${record.handle}`,
      inputSchema: toolSchema(tool.inputSchema),
      ...(annotations ? { annotations } : {}),
    };
  }
}
