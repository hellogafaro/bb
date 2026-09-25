import {
  Client,
  type ClientOptions,
  type SSEClientTransport,
  type StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type { McpStore } from "./store.js";
import {
  parseStoredServerConfig,
  type HttpServerConfig,
  type StoredServerConfig,
} from "./config.js";
import type { McpOAuthProvider } from "./oauth.js";
import type { CatalogLists } from "./gateway-catalog.js";
import {
  abortable,
  AuthenticationRequiredError,
  createHttpTransport,
  errorText,
  FETCH_TIMEOUT_GRACE_MS,
  OAUTH_TIMEOUT_MS,
  withTimeout,
} from "./gateway-http.js";
import {
  expandedStdioConfig,
  type CatalogChangeKind,
} from "./gateway-stdio.js";
import type { McpGatewayLogger, McpGatewayOptions } from "./gateway.js";
import { optionalMcpCall } from "./mcp-compat.js";
import type { McpServerRecord } from "./types.js";

const MCP_CLIENT_INFO = { name: "bb-mcp", version: "0.1.0" };
export const CONNECT_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 2_000;
export const RETRY_AFTER_MS = 5_000;

type HttpTransport = StreamableHTTPClientTransport | SSEClientTransport;

export interface Connected extends CatalogLists {
  kind: "local" | "host";
  client?: Client;
  transport?: HttpTransport;
  expectedClose: boolean;
  provider?: McpOAuthProvider;
}

export interface PendingAuth {
  client: Client;
  transport: HttpTransport;
  provider: McpOAuthProvider;
}

interface Failure {
  message: string;
  at: number;
}

export function emptyConnection(kind: Connected["kind"]): Connected {
  return {
    kind,
    tools: [],
    prompts: [],
    resources: [],
    resourceTemplates: [],
    expectedClose: false,
  };
}

export interface McpConnectionHooks {
  cacheCatalog(id: string, lists: CatalogLists): void;
  invalidateCatalog(id: string): void;
  notifyChanged(): Promise<void>;
  providerFor(id: string, serverUrl: URL): Promise<McpOAuthProvider>;
}

export class McpConnections {
  readonly conns = new Map<string, Connected>();
  readonly oauthPending = new Map<string, PendingAuth>();
  readonly failures = new Map<string, Failure>();
  private readonly reconnects = new Map<string, Promise<string | null>>();
  private readonly pending = new Map<string, Promise<Connected>>();
  private readonly connectControllers = new Map<string, AbortController>();
  private readonly serverEpochs = new Map<string, object>();
  private closed = false;

  constructor(
    private readonly store: McpStore,
    private readonly log: McpGatewayLogger,
    private readonly options: McpGatewayOptions,
    private readonly hooks: McpConnectionHooks,
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.connectControllers.values()) {
      controller.abort(new Error("MCP gateway closing"));
    }
    await Promise.allSettled(
      [...this.pending.entries()].map(async ([id, pending]) => {
        try {
          await withTimeout(
            pending,
            CLOSE_TIMEOUT_MS,
            `wait for MCP connection ${id}`,
          );
        } catch (error) {
          this.log.warn(`wait for MCP connection ${id}: ${errorText(error)}`);
        }
      }),
    );
    const connections = [...this.conns.entries()];
    const pendingAuth = [...this.oauthPending.entries()];
    this.conns.clear();
    this.oauthPending.clear();
    this.failures.clear();
    await Promise.all([
      ...connections.map(([id, value]) =>
        this.closeConnected(id, value).catch((error: unknown) =>
          this.log.warn(`close ${id}: ${errorText(error)}`),
        ),
      ),
      ...pendingAuth.map(([id, value]) =>
        this.closePendingAuthValue(id, value),
      ),
    ]);
    this.serverEpochs.clear();
  }

  serverRecord(id: string): McpServerRecord {
    const record = this.store.get(id);
    if (!record) throw new Error(`MCP server not found: ${id}`);
    return record;
  }

  async closeServer(id: string): Promise<void> {
    this.serverEpochs.delete(id);
    this.connectControllers
      .get(id)
      ?.abort(new Error(`MCP connection cancelled for ${id}`));
    const pendingConnect = this.pending.get(id);
    if (pendingConnect) {
      try {
        await withTimeout(
          pendingConnect,
          CLOSE_TIMEOUT_MS,
          `wait for MCP connection ${id}`,
        );
      } catch (error) {
        this.log.warn(`wait for MCP connection ${id}: ${errorText(error)}`);
      }
      if (this.pending.get(id) === pendingConnect) this.pending.delete(id);
    }
    const conn = this.conns.get(id);
    const auth = this.oauthPending.get(id);
    this.conns.delete(id);
    this.oauthPending.delete(id);
    this.failures.delete(id);
    this.hooks.invalidateCatalog(id);
    try {
      if (conn) await this.closeConnected(id, conn);
      else if (auth) await this.closePendingAuthValue(id, auth);
    } catch (error) {
      this.log.warn(`close ${id}: ${errorText(error)}`);
    }
  }

  async closeConnected(id: string, connection: Connected): Promise<void> {
    connection.expectedClose = true;
    if (connection.kind === "host") {
      await withTimeout(
        this.options.stdioHost.close(id),
        CLOSE_TIMEOUT_MS,
        `close isolated MCP ${id}`,
      );
      return;
    }
    if (connection.client)
      await withTimeout(
        connection.client.close(),
        CLOSE_TIMEOUT_MS,
        `close ${id}`,
      );
  }

  async closePendingAuthValue(id: string, pending: PendingAuth): Promise<void> {
    await Promise.all([
      withTimeout(
        pending.transport.close(),
        CLOSE_TIMEOUT_MS,
        `close pending MCP OAuth transport ${id}`,
      ).catch((error: unknown) =>
        this.log.warn(
          `close pending MCP OAuth transport ${id}: ${errorText(error)}`,
        ),
      ),
      withTimeout(
        pending.client.close(),
        CLOSE_TIMEOUT_MS,
        `close ${id}`,
      ).catch((error: unknown) =>
        this.log.warn(
          `close pending MCP OAuth client ${id}: ${errorText(error)}`,
        ),
      ),
    ]);
  }

  async handleStdioHostLost(): Promise<void> {
    if (this.closed) return;
    const isolated = [...this.conns.entries()].filter(
      ([, connection]) => connection.kind === "host",
    );
    for (const [id, connection] of isolated) {
      if (this.conns.get(id) !== connection) continue;
      this.conns.delete(id);
      const message =
        "Isolated MCP host disconnected; the server will reconnect on the next request";
      this.failures.set(id, { message, at: Date.now() });
      this.hooks.invalidateCatalog(id);
      this.store.setStatus(id, "error", message);
    }
    if (isolated.length > 0) await this.hooks.notifyChanged();
  }

  async handleStdioConnectionChanged(
    id: string,
    status: "closed" | "error",
    error: string | null,
  ): Promise<void> {
    const connection = this.conns.get(id);
    if (!connection || connection.kind !== "host") return;
    this.conns.delete(id);
    this.hooks.invalidateCatalog(id);
    const message = error ?? `Isolated MCP transport ${status}`;
    this.store.setStatus(id, "error", message);
    this.failures.set(id, { message, at: Date.now() });
    await this.hooks.notifyChanged();
  }

  handleStdioCatalogChanged(
    id: string,
    kind: CatalogChangeKind,
    error: string | null,
  ): void {
    this.onCatalogChanged(id, kind, error ? new Error(error) : null, undefined);
  }

  async startServer(id: string): Promise<void> {
    await this.ensureServer(id);
  }

  async reconnectServer(id: string): Promise<string | null> {
    const existing = this.reconnects.get(id);
    if (existing) return existing;
    const work = this.reconnectOnce(id);
    this.reconnects.set(id, work);
    try {
      return await work;
    } finally {
      if (this.reconnects.get(id) === work) this.reconnects.delete(id);
    }
  }

  private async reconnectOnce(id: string): Promise<string | null> {
    const record = this.serverRecord(id);
    if (!record.enabled)
      throw new Error(`MCP server ${record.handle} is disabled`);
    await this.closeServer(id);
    this.store.setStatus(id, "idle", null);
    try {
      await this.startServer(id);
      return null;
    } catch (error) {
      if (error instanceof AuthenticationRequiredError)
        return error.authorizationUrl;
      throw error;
    }
  }

  requireClient(conn: Connected): Client {
    if (!conn.client) throw new Error("MCP connection is missing its client");
    return conn.client;
  }

  async ensureServer(id: string): Promise<Connected> {
    if (this.closed) throw new Error("MCP gateway closed");
    const record = this.serverRecord(id);
    if (!record.enabled)
      throw new Error(`MCP server ${record.handle} is disabled`);
    const existing = this.conns.get(id);
    if (existing) return existing;
    const pendingAuth = this.oauthPending.get(id);
    if (pendingAuth)
      throw new AuthenticationRequiredError(
        pendingAuth.provider.getAuthorizationUrl() ?? "",
      );
    const inFlight = this.pending.get(id);
    if (inFlight) return inFlight;
    const failure = this.failures.get(id);
    if (failure && Date.now() - failure.at < RETRY_AFTER_MS)
      throw new Error(failure.message);
    const cfg = parseStoredServerConfig(record.handle, record.configJson);
    const controller = new AbortController();
    this.connectControllers.set(id, controller);
    const connectPromise = this.connectServer(record, cfg, controller.signal);
    this.pending.set(id, connectPromise);
    try {
      return await connectPromise;
    } finally {
      if (this.pending.get(id) === connectPromise) this.pending.delete(id);
      if (this.connectControllers.get(id) === controller)
        this.connectControllers.delete(id);
    }
  }

  private async connectHost(
    record: McpServerRecord,
    cfg: Extract<StoredServerConfig, { type: "stdio" }>,
    signal: AbortSignal,
  ): Promise<Connected> {
    const stdio = await expandedStdioConfig(
      record.id,
      cfg,
      await this.options.serverDirs(record.id),
    );
    const catalog = await withTimeout(
      abortable(this.options.stdioHost.start(stdio), signal),
      CONNECT_TIMEOUT_MS,
      `start isolated MCP ${record.handle}`,
      () =>
        this.connectControllers
          .get(record.id)
          ?.abort(new Error(`start isolated MCP ${record.handle} timed out`)),
    );
    return { ...emptyConnection("host"), ...catalog };
  }

  private createClient(id: string): Client {
    const clientOptions: ClientOptions = {
      capabilities: this.options.onElicitation
        ? { elicitation: { form: {} } }
        : {},
      versionNegotiation: { mode: "auto" },
      listChanged: {
        tools: {
          autoRefresh: true,
          onChanged: (error, items) =>
            this.onCatalogChanged(id, "tools", error, items),
        },
        prompts: {
          autoRefresh: true,
          onChanged: (error, items) =>
            this.onCatalogChanged(id, "prompts", error, items),
        },
        resources: {
          autoRefresh: true,
          onChanged: (error, items) =>
            this.onCatalogChanged(id, "resources", error, items),
        },
      },
    };
    const client = new Client(MCP_CLIENT_INFO, clientOptions);
    const onElicitation = this.options.onElicitation;
    if (onElicitation)
      client.setRequestHandler("elicitation/create", (request) =>
        onElicitation(request, id),
      );
    return client;
  }

  requestTimeoutMs(): number {
    return (
      this.options.requestTimeoutMs ??
      (this.options.oauthTimeoutMs ?? OAUTH_TIMEOUT_MS) + FETCH_TIMEOUT_GRACE_MS
    );
  }

  httpTransport(
    cfg: HttpServerConfig,
    provider: McpOAuthProvider,
  ): HttpTransport {
    return createHttpTransport(cfg, provider, this.requestTimeoutMs());
  }

  private async connectServer(
    record: McpServerRecord,
    cfg: StoredServerConfig,
    signal: AbortSignal,
  ): Promise<Connected> {
    const { id, handle } = record;
    const epoch = {};
    this.serverEpochs.set(id, epoch);
    let client: Client | undefined;
    let transport: HttpTransport | undefined;
    let provider: McpOAuthProvider | undefined;
    let connection: Connected | undefined;
    try {
      if (signal.aborted)
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("MCP connection cancelled");
      if (cfg.type === "stdio") {
        connection = await this.connectHost(record, cfg, signal);
      } else {
        client = this.createClient(id);
        provider = await this.hooks.providerFor(id, new URL(cfg.url));
        transport = this.httpTransport(cfg, provider);
        connection = {
          ...emptyConnection("local"),
          client,
          transport,
          provider,
        };
        this.installTransportHandlers(record, connection, transport);
        const connectingClient = client;
        await withTimeout(
          connectingClient.connect(transport, {
            signal,
            timeout: CONNECT_TIMEOUT_MS,
          }),
          CONNECT_TIMEOUT_MS,
          `connect ${handle}`,
          () => {
            void connectingClient.close().catch(() => {});
          },
        );
        await withTimeout(
          this.refreshCatalog(id, connection, signal),
          CONNECT_TIMEOUT_MS,
          `list MCP capabilities ${handle}`,
          () =>
            this.connectControllers
              .get(id)
              ?.abort(new Error(`list MCP capabilities ${handle} timed out`)),
        );
      }
      if (provider) await provider.clearPending();
      if (this.closed) throw new Error("MCP gateway closed");
      if (this.serverEpochs.get(id) !== epoch)
        throw new Error(`MCP connection cancelled for ${handle}`);
      this.conns.set(id, connection);
      this.hooks.cacheCatalog(id, connection);
      this.oauthPending.delete(id);
      this.failures.delete(id);
      this.store.setStatus(id, "ready", null);
      this.log.info(
        `MCP connected ${handle} (${connection.tools.length} tools, ${connection.prompts.length} prompts, ${connection.resources.length} resources)`,
      );
      await this.hooks.notifyChanged();
      return connection;
    } catch (error) {
      const message = errorText(error);
      const cancelled =
        this.closed || signal.aborted || this.serverEpochs.get(id) !== epoch;
      if (cancelled) {
        await this.discardConnection(id, handle, connection, client);
        throw new Error(
          this.closed
            ? "MCP gateway closed"
            : `MCP connection cancelled for ${handle}`,
        );
      }
      const authorizationUrl = provider
        ? await provider.authorizationUrlValue()
        : undefined;
      if (provider && client && transport && authorizationUrl) {
        this.oauthPending.set(id, { client, transport, provider });
        this.failures.delete(id);
        this.store.setStatus(id, "needs-auth", "Authentication required");
        await this.hooks.notifyChanged();
        throw new AuthenticationRequiredError(authorizationUrl);
      }
      this.failures.set(id, { message, at: Date.now() });
      this.store.setStatus(id, "error", message);
      await this.discardConnection(id, handle, connection, client);
      throw new Error(message);
    }
  }

  private async discardConnection(
    id: string,
    handle: string,
    connection: Connected | undefined,
    client: Client | undefined,
  ): Promise<void> {
    if (connection) await this.closeConnected(id, connection).catch(() => {});
    else if (client)
      await withTimeout(
        client.close(),
        CLOSE_TIMEOUT_MS,
        `close ${handle}`,
      ).catch(() => {});
    if (this.conns.get(id) === connection) this.conns.delete(id);
  }

  private installTransportHandlers(
    record: McpServerRecord,
    conn: Connected,
    transport: HttpTransport,
  ): void {
    transport.onerror = (error) =>
      this.log.warn(`MCP ${record.handle} error: ${errorText(error)}`);
    transport.onclose = () => {
      if (conn.expectedClose || this.closed) return;
      if (this.conns.get(record.id)?.transport !== transport) return;
      this.conns.delete(record.id);
      this.hooks.invalidateCatalog(record.id);
      const message = `MCP transport closed unexpectedly for ${record.handle}`;
      this.failures.set(record.id, { message, at: Date.now() });
      this.store.setStatus(record.id, "error", message);
      void this.hooks.notifyChanged();
    };
  }

  async refreshCatalog(
    id: string,
    conn: Connected,
    signal?: AbortSignal,
  ): Promise<void> {
    if (conn.kind === "host") {
      Object.assign(
        conn,
        await abortable(this.options.stdioHost.refresh(id), signal),
      );
      return;
    }
    const client = this.requireClient(conn);
    const options = signal
      ? { signal, cacheMode: "refresh" as const }
      : { cacheMode: "refresh" as const };
    const [tools, prompts, resources, resourceTemplates] = await Promise.all([
      optionalMcpCall(() => client.listTools(undefined, options), {
        tools: [],
      }),
      optionalMcpCall(() => client.listPrompts(undefined, options), {
        prompts: [],
      }),
      optionalMcpCall(() => client.listResources(undefined, options), {
        resources: [],
      }),
      optionalMcpCall(() => client.listResourceTemplates(undefined, options), {
        resourceTemplates: [],
      }),
    ]);
    conn.tools = tools.tools;
    conn.prompts = prompts.prompts;
    conn.resources = resources.resources;
    conn.resourceTemplates = resourceTemplates.resourceTemplates;
  }

  onCatalogChanged(
    id: string,
    kind: CatalogChangeKind,
    error: Error | null,
    items: unknown,
  ): void {
    if (error)
      this.log.warn(`MCP ${id} ${kind} refresh failed: ${errorText(error)}`);
    const conn = this.conns.get(id);
    if (conn && !error) {
      if (conn.kind === "host") {
        void this.refreshCatalog(id, conn)
          .then(() => {
            if (this.conns.get(id) !== conn) return;
            this.hooks.cacheCatalog(id, conn);
            void this.hooks.notifyChanged();
          })
          .catch((refreshError: unknown) =>
            this.log.warn(
              `MCP ${id} isolated catalog refresh failed: ${errorText(refreshError)}`,
            ),
          );
        void this.hooks.notifyChanged();
        return;
      }
      this.applyListChanged(id, conn, kind, items);
      this.hooks.cacheCatalog(id, conn);
    }
    void this.hooks.notifyChanged();
  }

  private applyListChanged(
    id: string,
    conn: Connected,
    kind: CatalogChangeKind,
    items: unknown,
  ): void {
    if (!Array.isArray(items)) return;
    if (kind === "tools") conn.tools = items;
    if (kind === "prompts") conn.prompts = items;
    if (kind !== "resources") return;
    conn.resources = items;
    const client = this.requireClient(conn);
    void optionalMcpCall(
      () => client.listResourceTemplates(undefined, { cacheMode: "refresh" }),
      { resourceTemplates: [] },
    )
      .then((result) => {
        if (this.conns.get(id) !== conn) return;
        conn.resourceTemplates = result.resourceTemplates;
        this.hooks.cacheCatalog(id, conn);
      })
      .catch((templateError: unknown) =>
        this.log.warn(
          `MCP ${id} resource template refresh failed: ${errorText(templateError)}`,
        ),
      );
  }
}
