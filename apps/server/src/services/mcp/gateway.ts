import type {
  ElicitRequest,
  ElicitResult,
  Tool,
} from "@modelcontextprotocol/client";
import type { McpStore } from "./store.js";
import type { McpOAuthProvider } from "./oauth.js";
import { compactToolFromCatalog, SEARCH_LIMIT } from "./catalog.js";
import { validateCallArgs } from "./call-card.js";
import { classifyTool } from "./policy.js";
import {
  asRecord,
  buildCatalogCache,
  CatalogIndex,
  catalogNames,
  catalogTool,
  exposedId,
  ID_PREFIX,
  ID_SOURCE,
  rankTools,
  type CatalogCache,
  type CatalogLists,
  type CatalogRef,
  type RefKind,
  type SearchCandidate,
} from "./gateway-catalog.js";
import { errorText, SessionExpiredError, withTimeout } from "./gateway-http.js";
import {
  type CatalogChangeKind,
  type McpServerDirs,
  type McpStdioHost,
} from "./gateway-stdio.js";
import { McpGatewayAuth } from "./gateway-auth.js";
import {
  CONNECT_TIMEOUT_MS,
  emptyConnection,
  McpConnections,
  type Connected,
  RETRY_AFTER_MS,
} from "./gateway-connections.js";
import type {
  CatalogPrompt,
  CatalogResource,
  CatalogResourceTemplate,
  CatalogTool,
  CompactTool,
  JsonRecord,
  McpCallResult,
  McpServerRecord,
  ToolSearchHits,
} from "./types.js";

export interface McpGatewayLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface McpGatewayOptions {
  serverDirs(id: string): Promise<McpServerDirs>;
  stdioHost: McpStdioHost;
  onChanged?: () => void | Promise<void>;
  oauthTimeoutMs?: number;
  requestTimeoutMs?: number;
  oauth?: {
    getProvider(id: string, serverUrl: URL): Promise<McpOAuthProvider>;
  };
  onElicitation?: (request: ElicitRequest, id: string) => Promise<ElicitResult>;
  searchWaitMs?: number;
}

const CATALOG_TTL_MS = 5 * 60_000;
const SEARCH_WAIT_MS = 3_000;

function contentResult(result: unknown): McpCallResult {
  const record = asRecord(result) ?? {};
  const content: JsonRecord[] = [];
  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      const block = asRecord(item);
      if (block) content.push(block);
    }
  }
  const meta = asRecord(record._meta);
  return {
    content,
    ...(typeof record.isError === "boolean" ? { isError: record.isError } : {}),
    ...(record.structuredContent !== undefined
      ? { structuredContent: record.structuredContent }
      : {}),
    ...(meta ? { _meta: meta } : {}),
  };
}

export class McpGateway {
  readonly auth: McpGatewayAuth;
  readonly connections: McpConnections;
  private readonly catalogCache = new Map<string, CatalogCache>();
  private readonly catalogControllers = new Map<string, AbortController>();
  private readonly catalogLoads = new Map<string, Promise<CatalogCache>>();
  private readonly catalogGenerations = new Map<string, object>();
  private readonly catalogIndex = new CatalogIndex();

  constructor(
    readonly store: McpStore,
    readonly log: McpGatewayLogger,
    readonly options: McpGatewayOptions,
  ) {
    this.auth = new McpGatewayAuth(this);
    this.connections = new McpConnections(store, log, options, {
      cacheCatalog: (id, lists) => {
        this.cacheCatalog(id, lists);
      },
      invalidateCatalog: (id) => this.invalidateCatalog(id),
      notifyChanged: () => this.notifyChanged(),
      providerFor: (id, serverUrl) => this.auth.providerFor(id, serverUrl),
    });
  }

  get isClosed(): boolean {
    return this.connections.isClosed;
  }

  async close(): Promise<void> {
    for (const controller of this.catalogControllers.values()) {
      controller.abort();
    }
    await this.connections.close();
    this.catalogCache.clear();
    this.catalogIndex.clear();
    this.catalogGenerations.clear();
    this.catalogLoads.clear();
    this.catalogControllers.clear();
    this.auth.clear();
  }

  closeServer(id: string): Promise<void> {
    return this.connections.closeServer(id);
  }

  startServer(id: string): Promise<void> {
    return this.connections.startServer(id);
  }

  reconnectServer(id: string): Promise<string | null> {
    return this.connections.reconnectServer(id);
  }

  handleStdioHostLost(): Promise<void> {
    return this.connections.handleStdioHostLost();
  }

  handleStdioConnectionChanged(
    id: string,
    status: "closed" | "error",
    error: string | null,
  ): Promise<void> {
    return this.connections.handleStdioConnectionChanged(id, status, error);
  }

  handleStdioCatalogChanged(
    id: string,
    kind: CatalogChangeKind,
    error: string | null,
  ): void {
    this.connections.handleStdioCatalogChanged(id, kind, error);
  }

  async resetServer(id: string): Promise<void> {
    await this.closeServer(id);
    await this.auth.forgetProvider(id);
  }

  private cacheCatalog(
    id: string,
    lists: CatalogLists,
    error: string | null = null,
  ): CatalogCache {
    const cached = buildCatalogCache(lists, error);
    this.catalogCache.set(id, cached);
    if (!error) {
      this.store.seedToolPolicies(
        id,
        lists.tools.map((tool) => ({
          name: tool.name,
          risk: classifyTool(asRecord(tool.annotations)),
        })),
      );
    }
    this.catalogIndex.index(id, lists);
    return cached;
  }

  invalidateCatalog(id: string): void {
    this.catalogGenerations.delete(id);
    this.catalogControllers.get(id)?.abort();
    this.catalogControllers.delete(id);
    this.catalogCache.delete(id);
    this.catalogLoads.delete(id);
    this.catalogIndex.drop(id);
  }

  private async resolveRef(kind: RefKind, id: string): Promise<CatalogRef> {
    const cached = this.catalogIndex.get(id);
    if (cached?.kind === kind) return cached;
    if (!new RegExp(`^${ID_PREFIX[kind]}_[a-z0-9]{10}$`).test(id)) {
      throw new Error(
        `Invalid MCP ${kind} id: ${id}. Use an id returned by ${ID_SOURCE[kind]}.`,
      );
    }
    try {
      return await Promise.any(
        this.store.listEnabled().map(async (record) => {
          const catalog = await this.getCatalog(record);
          const name = catalogNames(kind, catalog).find(
            (candidate) => exposedId(kind, record.id, candidate) === id,
          );
          if (name === undefined) throw new Error("No match");
          return { kind, sourceId: record.id, name };
        }),
      );
    } catch {
      throw new Error(`MCP ${kind} not found: ${id}`);
    }
  }

  private async getCatalog(record: McpServerRecord): Promise<CatalogCache> {
    if (this.isClosed) throw new Error("MCP gateway closed");
    if (!record.enabled) throw new Error("MCP server is not enabled");
    const id = record.id;
    const cached = this.catalogCache.get(id);
    const age = cached
      ? Date.now() - cached.updatedAt
      : Number.POSITIVE_INFINITY;
    if (cached?.error && age < RETRY_AFTER_MS) throw new Error(cached.error);
    if (cached && !cached.error && age < CATALOG_TTL_MS) return cached;
    const existingLoad = this.catalogLoads.get(id);
    if (existingLoad) return existingLoad;
    const generation = {};
    this.catalogGenerations.set(id, generation);
    const controller = new AbortController();
    this.catalogControllers.set(id, controller);
    const load = this.loadCatalog(record, cached, generation, controller);
    this.catalogLoads.set(id, load);
    try {
      return await load;
    } finally {
      if (this.catalogLoads.get(id) === load) this.catalogLoads.delete(id);
      if (this.catalogControllers.get(id) === controller)
        this.catalogControllers.delete(id);
    }
  }

  private async loadCatalog(
    record: McpServerRecord,
    cached: CatalogCache | undefined,
    generation: object,
    controller: AbortController,
  ): Promise<CatalogCache> {
    const id = record.id;
    try {
      const hadConnection = this.connections.conns.has(id);
      const connection = await this.connections.ensureServer(id);
      if (cached || hadConnection) {
        await withTimeout(
          this.connections.refreshCatalog(id, connection, controller.signal),
          CONNECT_TIMEOUT_MS,
          `refresh MCP catalog ${record.handle}`,
          () =>
            controller.abort(
              new Error(`MCP catalog refresh timed out for ${record.handle}`),
            ),
        );
      }
      controller.signal.throwIfAborted();
      if (this.catalogGenerations.get(id) !== generation)
        throw new Error(`MCP catalog invalidated for ${record.handle}`);
      const connectedCache = this.catalogCache.get(id);
      if (
        !cached &&
        connectedCache &&
        connectedCache.tools === connection.tools
      )
        return connectedCache;
      this.store.setStatus(id, "ready", null);
      const catalog = this.cacheCatalog(id, connection);
      void this.notifyChanged();
      return catalog;
    } catch (error) {
      if (!this.isClosed && this.catalogGenerations.get(id) === generation) {
        const message = errorText(error);
        if (error instanceof SessionExpiredError) {
          const connection = this.connections.conns.get(id);
          this.connections.conns.delete(id);
          if (connection) await this.connections.closeConnected(id, connection);
        }
        const needsAuth = await this.auth.hasPendingAuthorization(id);
        if (this.isClosed || this.catalogGenerations.get(id) !== generation)
          throw error;
        this.store.setStatus(
          id,
          needsAuth ? "needs-auth" : "error",
          needsAuth ? "Authentication required" : message,
        );
        this.cacheCatalog(id, emptyConnection("local"), message);
        void this.notifyChanged();
      }
      throw error;
    }
  }

  async warm(): Promise<void> {
    await Promise.all(
      this.store.listEnabled().map(async (record) => {
        const cached = this.catalogCache.get(record.id);
        if (cached && !cached.error) return;
        try {
          const catalog = await this.getCatalog(record);
          this.log.info(
            `MCP warmed ${record.handle} (${catalog.tools.length} tools)`,
          );
        } catch (error) {
          if (!this.isClosed)
            this.log.info(
              `MCP warmup skipped ${record.handle}: ${errorText(error)}`,
            );
        }
      }),
    );
  }

  async inspectServer(
    id: string,
  ): Promise<{ tools: CompactTool[]; error: string | null }> {
    const record = this.serverRecord(id);
    if (!record.enabled) return { tools: [], error: null };
    try {
      const catalog = await this.getCatalog(record);
      return {
        tools: catalog.tools.map((tool) =>
          compactToolFromCatalog(catalogTool(record, tool)),
        ),
        error: catalog.error,
      };
    } catch (error) {
      return { tools: [], error: errorText(error) };
    }
  }

  catalogCounts(
    id: string,
  ): { tools: number; prompts: number; resources: number } | null {
    const cached = this.catalogCache.get(id);
    if (!cached || cached.error) return null;
    return {
      tools: cached.tools.length,
      prompts: cached.prompts.length,
      resources: cached.resources.length,
    };
  }

  async getTool(id: string): Promise<CatalogTool> {
    const ref = await this.resolveRef("tool", id);
    const record = this.serverRecord(ref.sourceId);
    if (!record.enabled)
      throw new Error(`MCP server is not enabled: ${record.handle}`);
    const catalog = await this.getCatalog(record);
    const tool = catalog.tools.find((item) => item.name === ref.name);
    if (!tool) throw new Error(`MCP tool not found: ${id}`);
    return catalogTool(record, tool);
  }

  peekTool(id: string): CatalogTool | null {
    const ref = this.catalogIndex.get(id);
    if (ref?.kind !== "tool") return null;
    const record = this.store.get(ref.sourceId);
    const cached = this.catalogCache.get(ref.sourceId);
    if (!record?.enabled || !cached || cached.error) return null;
    const tool = cached.tools.find((item) => item.name === ref.name);
    return tool ? catalogTool(record, tool) : null;
  }

  async searchTools(
    query: string,
    limit = SEARCH_LIMIT,
    server?: string,
  ): Promise<ToolSearchHits> {
    const q = query.trim();
    if (!q) return { tools: [], unavailable: [] };
    const servers = this.selectedServers(server);
    const waitMs = this.options.searchWaitMs ?? SEARCH_WAIT_MS;
    const loaded = new Map<
      string,
      { catalog: CatalogCache; generation: object | undefined }
    >();
    const loads = servers.map((record) =>
      this.getCatalog(record).then(
        (catalog) => {
          loaded.set(record.id, {
            catalog,
            generation: this.catalogGenerations.get(record.id),
          });
        },
        () => {},
      ),
    );
    if (loads.length > 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all(loads),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, waitMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    const unavailable: string[] = [];
    const candidates: SearchCandidate[] = [];
    for (const record of servers) {
      const result = loaded.get(record.id);
      if (!this.store.get(record.id)?.enabled) continue;
      if (
        result &&
        result.generation !== this.catalogGenerations.get(record.id)
      )
        continue;
      const cached = result?.catalog ?? this.catalogCache.get(record.id);
      if (!cached) unavailable.push(record.name);
      else if (cached.error)
        unavailable.push(`${record.name}: ${cached.error}`);
      else candidates.push({ record, catalog: cached });
    }
    return {
      tools: rankTools(q, candidates, this.catalogIndex.get(q), limit),
      unavailable,
    };
  }

  async call(
    id: string,
    args: JsonRecord,
    signal?: AbortSignal,
  ): Promise<McpCallResult> {
    const definition = await this.getTool(id);
    const invalid = validateCallArgs(definition.inputSchema, args);
    if (invalid)
      throw new Error(`Invalid arguments for ${definition.name}: ${invalid}`);
    const conn = await this.connections.ensureServer(definition.sourceId);
    const tool = conn.tools.find((item) => item.name === definition.name);
    const result = await this.withAuthState(definition.sourceId, () =>
      this.callTool(
        definition.sourceId,
        conn,
        definition.name,
        args,
        tool,
        signal,
      ),
    );
    return contentResult(result);
  }

  async listPrompts(server?: string): Promise<CatalogPrompt[]> {
    const result: CatalogPrompt[] = [];
    for (const record of this.selectedServers(server)) {
      try {
        const catalog = await this.getCatalog(record);
        for (const prompt of catalog.prompts) {
          result.push({
            ...this.ref("prompt", record, prompt.name),
            name: prompt.name,
            ...(prompt.description ? { description: prompt.description } : {}),
          });
        }
      } catch (error) {
        this.log.warn(`listPrompts skip ${record.handle}: ${errorText(error)}`);
      }
    }
    return result;
  }

  async getPrompt(
    id: string,
    args: JsonRecord = {},
    signal?: AbortSignal,
  ): Promise<JsonRecord> {
    const ref = await this.resolveRef("prompt", id);
    const conn = await this.connections.ensureServer(ref.sourceId);
    const argumentsMap: Record<string, string> = {};
    for (const [name, value] of Object.entries(args)) {
      if (typeof value !== "string")
        throw new Error(`Prompt argument ${name} must be a string`);
      argumentsMap[name] = value;
    }
    const result = await this.withAuthState(
      ref.sourceId,
      async (): Promise<unknown> => {
        if (conn.kind === "host")
          return this.options.stdioHost.getPrompt(
            ref.sourceId,
            ref.name,
            argumentsMap,
          );
        return this.connections
          .requireClient(conn)
          .getPrompt(
            { name: ref.name, arguments: argumentsMap },
            signal ? { signal } : undefined,
          );
      },
    );
    return asRecord(result) ?? {};
  }

  async listResources(server?: string): Promise<CatalogResource[]> {
    const result: CatalogResource[] = [];
    for (const record of this.selectedServers(server)) {
      try {
        const catalog = await this.getCatalog(record);
        for (const resource of catalog.resources)
          result.push({
            ...this.ref("resource", record, resource.uri),
            uri: resource.uri,
            name: resource.name,
          });
      } catch (error) {
        this.log.warn(
          `listResources skip ${record.handle}: ${errorText(error)}`,
        );
      }
    }
    return result;
  }

  async listResourceTemplates(
    server?: string,
  ): Promise<CatalogResourceTemplate[]> {
    const result: CatalogResourceTemplate[] = [];
    for (const record of this.selectedServers(server)) {
      try {
        const catalog = await this.getCatalog(record);
        for (const template of catalog.resourceTemplates) {
          result.push({
            ...this.ref("resource-template", record, template.uriTemplate),
            uriTemplate: template.uriTemplate,
            name: template.name,
          });
        }
      } catch (error) {
        this.log.warn(
          `listResourceTemplates skip ${record.handle}: ${errorText(error)}`,
        );
      }
    }
    return result;
  }

  async readResource(id: string, signal?: AbortSignal): Promise<JsonRecord> {
    const ref = await this.resolveRef("resource", id);
    const conn = await this.connections.ensureServer(ref.sourceId);
    const result = await this.withAuthState(
      ref.sourceId,
      async (): Promise<unknown> => {
        if (conn.kind === "host")
          return this.options.stdioHost.readResource(ref.sourceId, ref.name);
        return this.connections
          .requireClient(conn)
          .readResource({ uri: ref.name }, signal ? { signal } : undefined);
      },
    );
    return asRecord(result) ?? {};
  }

  private async callTool(
    id: string,
    conn: Connected,
    name: string,
    args: JsonRecord,
    tool: Tool | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (conn.kind === "host")
      return this.options.stdioHost.callTool(id, name, args, tool);
    return this.connections.requireClient(conn).callTool(
      { name, arguments: args },
      {
        ...(signal ? { signal } : {}),
        ...(tool ? { toolDefinition: tool } : {}),
      },
    );
  }

  serverRecord(id: string): McpServerRecord {
    const record = this.store.get(id);
    if (!record) throw new Error(`MCP server not found: ${id}`);
    return record;
  }

  private selectedServers(server?: string): McpServerRecord[] {
    if (!server) return this.store.listEnabled();
    const source = this.store.resolve(server);
    if (!source) throw new Error(`MCP server not found: ${server}`);
    return source.enabled ? [source] : [];
  }

  async notifyChanged(): Promise<void> {
    try {
      await this.options.onChanged?.();
    } catch (error) {
      this.log.warn(`MCP change notification failed: ${errorText(error)}`);
    }
  }

  private async withAuthState<T>(
    id: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const connection = this.connections.conns.get(id);
    try {
      return await operation();
    } catch (error) {
      if (
        connection?.kind === "host" &&
        this.connections.conns.get(id) === connection &&
        /MCP stdio connection not found/.test(errorText(error))
      ) {
        await this.handleStdioConnectionChanged(id, "closed", errorText(error));
      }
      if (
        error instanceof SessionExpiredError &&
        this.connections.conns.get(id) === connection
      ) {
        await this.closeServer(id);
        this.store.setStatus(id, "idle", error.message);
        await this.notifyChanged();
      }
      if (await this.auth.hasPendingAuthorization(id)) {
        this.store.setStatus(id, "needs-auth", "Authentication required");
        await this.notifyChanged();
      }
      throw error;
    }
  }

  private ref(kind: RefKind, record: McpServerRecord, name: string) {
    return {
      id: exposedId(kind, record.id, name),
      sourceId: record.id,
      handle: record.handle,
    };
  }
}
