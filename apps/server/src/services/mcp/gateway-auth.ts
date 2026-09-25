import type { McpOAuthProvider } from "./oauth.js";
import { parseStoredServerConfig, type HttpServerConfig } from "./config.js";
import {
  AuthenticationRequiredError,
  errorText,
  OAUTH_TIMEOUT_MS,
  withTimeout,
} from "./gateway-http.js";
import type { PendingAuth } from "./gateway-connections.js";
import type { McpGateway } from "./gateway.js";

const CONNECT_TIMEOUT_MS = 15_000;
const CLOSE_TIMEOUT_MS = 2_000;

export type McpAuthStatus = "unauthenticated" | "authorizing" | "authenticated";

function isOAuthStateMismatch(error: unknown): boolean {
  return errorText(error) === "MCP OAuth state mismatch";
}

function authorizationFailure(params: URLSearchParams): string {
  const code = params.get("error") ?? "unknown_error";
  const description = params.get("error_description");
  return `MCP authorization failed: ${code}${description ? ` — ${description}` : ""}`;
}

export class McpGatewayAuth {
  private readonly providers = new Map<string, McpOAuthProvider>();
  private readonly providerLoads = new Map<string, Promise<McpOAuthProvider>>();

  constructor(private readonly gateway: McpGateway) {}

  clear(): void {
    this.providers.clear();
    this.providerLoads.clear();
  }

  async forgetProvider(id: string): Promise<void> {
    const provider = this.providers.get(id);
    if (provider)
      await provider
        .clearPending()
        .catch((error: unknown) =>
          this.gateway.log.warn(
            `clear MCP OAuth state ${id}: ${errorText(error)}`,
          ),
        );
    this.providers.delete(id);
    this.providerLoads.delete(id);
  }

  async hasPendingAuthorization(id: string): Promise<boolean> {
    const provider = this.providers.get(id);
    return Boolean(provider && (await provider.authorizationUrlValue()));
  }

  private httpConfig(id: string): HttpServerConfig | null {
    const record = this.gateway.connections.serverRecord(id);
    const cfg = parseStoredServerConfig(record.handle, record.configJson);
    return cfg.type === "stdio" ? null : cfg;
  }

  async providerFor(id: string, serverUrl: URL): Promise<McpOAuthProvider> {
    const existing = this.providers.get(id);
    if (existing) return existing;
    const oauth = this.gateway.options.oauth;
    if (!oauth) throw new Error("OAuth storage is not configured");
    const loading = this.providerLoads.get(id);
    if (loading) return loading;
    const work: Promise<McpOAuthProvider> = Promise.resolve().then(async () => {
      const provider = await oauth.getProvider(id, serverUrl);
      await provider.alignWithRedirect();
      if (this.gateway.isClosed || this.providerLoads.get(id) !== work)
        throw new Error("MCP OAuth provider invalidated");
      this.providers.set(id, provider);
      return provider;
    });
    this.providerLoads.set(id, work);
    try {
      return await work;
    } finally {
      if (this.providerLoads.get(id) === work) this.providerLoads.delete(id);
    }
  }

  async authUrl(id: string): Promise<string | null> {
    const cfg = this.httpConfig(id);
    if (!cfg) return null;
    const provider = await this.providerFor(id, new URL(cfg.url));
    const existing = await provider.authorizationUrlValue();
    if (existing) return existing;
    try {
      await this.gateway.startServer(id);
    } catch (error) {
      if (!(error instanceof AuthenticationRequiredError)) throw error;
    }
    return (await provider.authorizationUrlValue()) ?? null;
  }

  async authStatus(id: string): Promise<McpAuthStatus> {
    const cfg = this.httpConfig(id);
    if (!cfg) return "authenticated";
    return (await this.providerFor(id, new URL(cfg.url))).status();
  }

  private oauthTimeoutMs(): number {
    return this.gateway.options.oauthTimeoutMs ?? OAUTH_TIMEOUT_MS;
  }

  private async validateCallbackState(
    id: string,
    provider: McpOAuthProvider,
    params: URLSearchParams,
  ): Promise<void> {
    try {
      await provider.validateState(params.get("state"));
    } catch (error) {
      if (!isOAuthStateMismatch(error))
        this.gateway.log.warn(
          `MCP OAuth callback validation failed for ${id}: ${errorText(error)}`,
        );
      throw error;
    }
  }

  private async reconnectAfterAuth(
    id: string,
    markReady: boolean,
  ): Promise<void> {
    try {
      await withTimeout(
        this.gateway.connections.ensureServer(id),
        CONNECT_TIMEOUT_MS,
        `reconnect ${id}`,
      );
      if (markReady) this.gateway.store.setStatus(id, "ready", null);
      this.gateway.connections.failures.delete(id);
      await this.gateway.notifyChanged();
    } catch (error) {
      const message = errorText(error);
      this.gateway.store.setStatus(id, "error", message);
      await this.gateway.notifyChanged();
      throw new Error(message);
    }
  }

  async finishAuth(id: string, params: URLSearchParams): Promise<void> {
    const pending = this.gateway.connections.oauthPending.get(id);
    if (!pending) {
      await this.finishDetachedAuth(id, params);
      return;
    }
    await this.validateCallbackState(id, pending.provider, params);
    if (params.get("error")) {
      const message = authorizationFailure(params);
      await this.cancelPendingAuthentication(
        id,
        pending.provider,
        pending,
        message,
      );
      throw new Error(message);
    }
    try {
      await withTimeout(
        pending.transport.finishAuth(params),
        this.oauthTimeoutMs(),
        `OAuth token exchange ${id}`,
        () => {
          void pending.transport.close().catch(() => {});
        },
      );
    } catch (error) {
      await this.cancelPendingAuthentication(
        id,
        pending.provider,
        pending,
        errorText(error),
      );
      throw error;
    }
    try {
      await pending.provider.clearPending();
    } catch (error) {
      await this.closePendingAuth(id, pending);
      this.gateway.store.setStatus(id, "error", errorText(error));
      await this.gateway.notifyChanged();
      throw error;
    }
    await this.closePendingAuth(id, pending);
    await this.reconnectAfterAuth(id, false);
  }

  private async finishDetachedAuth(
    id: string,
    params: URLSearchParams,
  ): Promise<void> {
    const cfg = this.httpConfig(id);
    if (!cfg)
      throw new Error("MCP OAuth is only available for HTTP transports");
    const provider = await this.providerFor(id, new URL(cfg.url));
    await this.validateCallbackState(id, provider, params);
    if (params.get("error")) {
      const message = authorizationFailure(params);
      await this.cancelPendingAuthentication(id, provider, undefined, message);
      throw new Error(message);
    }
    const transport = this.gateway.connections.httpTransport(cfg, provider);
    try {
      await withTimeout(
        transport.finishAuth(params),
        this.oauthTimeoutMs(),
        `OAuth token exchange ${id}`,
        () => {
          void transport.close().catch(() => {});
        },
      );
    } catch (error) {
      await this.cancelPendingAuthentication(
        id,
        provider,
        undefined,
        errorText(error),
      );
      throw error;
    } finally {
      await withTimeout(
        transport.close(),
        CLOSE_TIMEOUT_MS,
        `close OAuth transport ${id}`,
      ).catch(() => {});
    }
    try {
      await provider.clearPending();
    } catch (error) {
      const message = errorText(error);
      this.gateway.store.setStatus(id, "error", message);
      await this.gateway.notifyChanged();
      throw new Error(message);
    }
    await this.reconnectAfterAuth(id, true);
  }

  async cancelAuthentication(id: string): Promise<void> {
    const record = this.gateway.connections.serverRecord(id);
    const cfg = this.httpConfig(id);
    if (!cfg) return;
    const provider = await this.providerFor(id, new URL(cfg.url));
    await this.gateway.closeServer(id);
    try {
      await provider.clearPending();
      this.gateway.store.setStatus(
        id,
        record.enabled ? "needs-auth" : "disabled",
        null,
      );
      await this.gateway.notifyChanged();
    } catch (error) {
      this.gateway.store.setStatus(id, "error", errorText(error));
      await this.gateway.notifyChanged();
      throw error;
    }
  }

  private async cancelPendingAuthentication(
    id: string,
    provider: McpOAuthProvider,
    pending: PendingAuth | undefined,
    message: string,
  ): Promise<void> {
    await provider
      .clearPending()
      .catch((error: unknown) =>
        this.gateway.log.warn(
          `clear MCP OAuth state ${id}: ${errorText(error)}`,
        ),
      );
    if (pending) await this.closePendingAuth(id, pending);
    this.gateway.store.setStatus(
      id,
      this.gateway.connections.serverRecord(id).enabled
        ? "needs-auth"
        : "disabled",
      message,
    );
    await this.gateway.notifyChanged();
  }

  private async closePendingAuth(
    id: string,
    pending: PendingAuth,
  ): Promise<void> {
    if (this.gateway.connections.oauthPending.get(id) === pending)
      this.gateway.connections.oauthPending.delete(id);
    await this.gateway.connections.closePendingAuthValue(id, pending);
  }
}
