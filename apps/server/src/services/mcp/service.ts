import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/client";
import type { DbConnection } from "@bb/db";
import type { McpChangeKind } from "@bb/domain";
import type {
  McpCatalogChangedMessage,
  McpConnectionChangedMessage,
} from "@bb/host-daemon-contract";
import type { PendingInteractionLifecycle } from "../interactions/pending-interactions.js";
import { McpApprovals } from "./approvals.js";
import { validateCallArgs } from "./call-card.js";
import { connectedInstructions } from "./context.js";
import { McpGateway, type McpGatewayOptions } from "./gateway.js";
import type { McpStdioHost } from "./gateway-stdio.js";
import { DeferredOAuthCredentialStore, McpOAuthProvider } from "./oauth.js";
import { mcpOAuthCredentialFile } from "./oauth-credentials.js";
import { oauthCallbackUrl } from "./oauth-redirect.js";
import { classifyTool, effectivePolicy } from "./policy.js";
import { McpServerAdmin } from "./server-admin.js";
import { clearMcpService } from "./mcp-service-registry.js";
import { McpStore } from "./store.js";
import type { CallScope, JsonRecord, McpCallResult } from "./types.js";

const WARMUP_ON_START_MS = 1_000;
const WARMUP_AFTER_CHANGE_MS = 250;

export interface McpServiceLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface McpServiceOptions {
  db: DbConnection;
  dataDir: string;
  logger: McpServiceLogger;
  notify(id: string | null, changes: McpChangeKind[]): void;
  pendingInteractions: Pick<
    PendingInteractionLifecycle,
    "requestCoreInteraction"
  >;
  stdioHost: McpStdioHost;
  primaryHostId(): string | null;
  oauthRedirectBase(): Promise<string>;
  registryUrl: string;
  registryFetch?: typeof fetch;
  gateway?: Pick<
    McpGatewayOptions,
    "oauthTimeoutMs" | "requestTimeoutMs" | "searchWaitMs"
  >;
  approvalTimeoutMs?: number;
}

export type McpInvokeResult = McpCallResult | { isError: true; error: string };

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class McpService {
  readonly store: McpStore;
  readonly gateway: McpGateway;
  readonly admin: McpServerAdmin;
  readonly approvals: McpApprovals;
  readonly mcpDir: string;
  private readonly credentials: DeferredOAuthCredentialStore;
  private warmTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(readonly options: McpServiceOptions) {
    this.mcpDir = join(options.dataDir, "mcp");
    this.store = new McpStore(options.db);
    this.credentials = new DeferredOAuthCredentialStore(
      mcpOAuthCredentialFile(this.mcpDir, (message) =>
        options.logger.warn(`[mcp] ${message}`),
      ),
      (error) =>
        options.logger.warn(
          `[mcp] OAuth secret persistence failed: ${errorText(error)}`,
        ),
    );
    this.approvals = new McpApprovals(
      options.pendingInteractions,
      options.logger,
      options.approvalTimeoutMs,
    );
    this.gateway = new McpGateway(this.store, options.logger, {
      ...options.gateway,
      stdioHost: options.stdioHost,
      serverDirs: async (id) => this.serverDirs(id),
      onChanged: () => this.publish(null, ["runtime-changed"]),
      onElicitation: (request, id) => this.elicit(request, id),
      oauth: {
        getProvider: (id, serverUrl) => this.oauthProvider(id, serverUrl),
      },
    });
    this.admin = new McpServerAdmin(this);
  }

  serverDirs(id: string): { root: string; data: string } {
    const dir = join(this.mcpDir, "servers", id);
    return { root: join(dir, "root"), data: join(dir, "data") };
  }

  artifactDir(): string {
    return join(this.mcpDir, "artifacts");
  }

  async ensureServerDirs(id: string): Promise<void> {
    const dirs = this.serverDirs(id);
    await mkdir(dirs.root, { recursive: true });
    await mkdir(dirs.data, { recursive: true });
  }

  async removeServerDirs(id: string): Promise<void> {
    await rm(join(this.mcpDir, "servers", id), {
      recursive: true,
      force: true,
    });
  }

  deleteCredentials(id: string): Promise<void> {
    return this.credentials.delete(id);
  }

  async withDeferredOAuthPersistence<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const release = this.credentials.deferPersistence();
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async oauthProvider(
    id: string,
    serverUrl: URL,
  ): Promise<McpOAuthProvider> {
    const redirect = oauthCallbackUrl(
      await this.options.oauthRedirectBase(),
      id,
    );
    return new McpOAuthProvider(id, serverUrl, redirect, this.credentials);
  }

  private elicit(request: ElicitRequest, id: string): Promise<ElicitResult> {
    const record = this.store.get(id);
    return this.approvals.elicit(
      request,
      id,
      record?.handle ?? id,
      record?.name ?? record?.handle ?? id,
    );
  }

  publish(id: string | null, changes: McpChangeKind[]): void {
    if (!changes.includes("runtime-changed"))
      this.scheduleWarmup(WARMUP_AFTER_CHANGE_MS);
    try {
      this.options.notify(id, changes);
    } catch (error) {
      this.options.logger.warn(
        `[mcp] realtime publish failed: ${errorText(error)}`,
      );
    }
  }

  start(): void {
    this.scheduleWarmup(WARMUP_ON_START_MS);
  }

  scheduleWarmup(delayMs: number): void {
    if (this.disposed) return;
    if (this.warmTimer) clearTimeout(this.warmTimer);
    this.warmTimer = setTimeout(() => {
      this.warmTimer = null;
      if (!this.disposed)
        void this.gateway
          .warm()
          .catch((error: unknown) =>
            this.options.logger.info(
              `[mcp] warmup failed: ${errorText(error)}`,
            ),
          );
    }, delayMs);
    this.warmTimer.unref?.();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    clearMcpService(this);
    if (this.warmTimer) clearTimeout(this.warmTimer);
    this.warmTimer = null;
    await this.gateway.close().catch(() => {});
    this.credentials.dispose();
  }

  handleDaemonMessage(
    hostId: string,
    message: McpCatalogChangedMessage | McpConnectionChangedMessage,
  ): void {
    if (hostId !== this.options.primaryHostId()) return;
    if (message.type === "mcp.catalog-changed") {
      this.gateway.handleStdioCatalogChanged(
        message.id,
        message.kind,
        message.error,
      );
      return;
    }
    void this.gateway.handleStdioConnectionChanged(
      message.id,
      message.status,
      message.error,
    );
  }

  handleHostDisconnected(hostId: string): void {
    if (hostId !== this.options.primaryHostId()) return;
    void this.gateway.handleStdioHostLost();
  }

  hasEnabledServers(): boolean {
    return this.store.hasEnabled();
  }

  instructions(selection: readonly string[] | null): string | undefined {
    return connectedInstructions(this.store.listEnabled(), selection);
  }

  async invokeTool(
    id: string,
    args: JsonRecord,
    scope: CallScope,
  ): Promise<McpInvokeResult> {
    const tool = this.gateway.peekTool(id) ?? (await this.gateway.getTool(id));
    const invalid = validateCallArgs(tool.inputSchema, args);
    if (invalid)
      return {
        isError: true,
        error: `Invalid arguments for ${tool.name}: ${invalid}`,
      };
    const risk = classifyTool(tool.annotations);
    const policy = effectivePolicy(
      this.store.getToolPolicy(tool.sourceId, tool.name)?.mode ?? "inherit",
      risk,
    );
    if (policy === "deny") {
      return {
        isError: true,
        error: `${tool.handle}/${tool.name} is blocked by the user's MCP policy (deny); the tool was not run. Ask the user if it should be allowed.`,
      };
    }
    if (policy === "confirm") {
      const refused = await this.approvals.confirmTool({
        scope,
        server: tool.handle,
        serverName: this.store.get(tool.sourceId)?.name ?? tool.handle,
        tool: tool.name,
        risk,
        args,
      });
      if (refused) return { isError: true, error: refused };
    }
    return this.approvals.runCall(tool.sourceId, scope, () =>
      this.gateway.call(id, args, scope.signal),
    );
  }
}
