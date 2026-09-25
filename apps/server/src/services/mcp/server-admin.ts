import type {
  McpAddServerRequest,
  McpAddServerResponse,
  McpAuthResponse,
  McpAuthStatusValue,
  McpRegistryHit,
  McpServer,
  McpServerSummary,
  McpToolPolicy,
  McpToolSearchResponse,
} from "@bb/server-contract";
import { MCP_GUIDE_MAX_CHARS } from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import { SEARCH_LIMIT, SEARCH_MAX, scoreMatch } from "./catalog.js";
import { validateMcpServer } from "./config.js";
import { effectivePolicy, type PolicyMode } from "./policy.js";
import { fetchRegistryServers, normalizeRegistryServer } from "./registry.js";
import { handleFor, type NewMcpServer } from "./store.js";
import {
  registryHit,
  serverSummary,
  serverView,
  toolRow,
} from "./server-views.js";
import type { McpService } from "./service.js";
import type { McpServerRecord, ToolRisk } from "./types.js";

const STDIO_DEFAULT_CWD = "${PLUGIN_DATA}";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nameFromUrl(value: string): string {
  try {
    return handleFor(new URL(value).hostname.replace(/^(mcp|www)\./, ""));
  } catch {
    return "http";
  }
}

function invalidRequest(message: string): ApiError {
  return new ApiError(400, "invalid_request", message);
}

export class McpServerAdmin {
  constructor(private readonly service: McpService) {}

  private get store() {
    return this.service.store;
  }

  private get gateway() {
    return this.service.gateway;
  }

  requireServer(ref: string): McpServerRecord {
    const server = this.store.resolve(ref);
    if (!server)
      throw new ApiError(404, "not_found", `MCP server not found: ${ref}`);
    return server;
  }

  private async authStatus(
    server: McpServerRecord,
  ): Promise<McpAuthStatusValue> {
    if (server.type === "stdio") return "not-applicable";
    try {
      return await this.gateway.auth.authStatus(server.id);
    } catch {
      return "unknown";
    }
  }

  async view(server: McpServerRecord): Promise<McpServer> {
    return serverView(
      server,
      await this.authStatus(server),
      this.gateway.catalogCounts(server.id),
    );
  }

  async list(): Promise<McpServer[]> {
    return Promise.all(this.store.list().map((server) => this.view(server)));
  }

  summaries(): McpServerSummary[] {
    return this.store
      .list()
      .map((server) =>
        serverSummary(server, this.gateway.catalogCounts(server.id)),
      );
  }

  private async insert({
    config,
    ...input
  }: Omit<NewMcpServer, "configJson"> & {
    config: Record<string, unknown>;
  }): Promise<McpAddServerResponse> {
    const validation = validateMcpServer(config);
    if (!validation.valid || !validation.config)
      throw invalidRequest(validation.errors.join("; "));
    const server = this.store.insert({
      ...input,
      configJson: JSON.stringify(validation.config),
    });
    try {
      await this.service.ensureServerDirs(server.id);
    } catch (error) {
      this.store.delete(server.id);
      throw error;
    }
    this.service.publish(server.id, ["servers-changed"]);
    return { id: server.id, handle: server.handle, name: server.name };
  }

  async add(request: McpAddServerRequest): Promise<McpAddServerResponse> {
    switch (request.kind) {
      case "registry":
        return this.addFromRegistry(
          request.registryName,
          request.headers,
          request.name,
        );
      case "http": {
        const headers =
          request.headers && Object.keys(request.headers).length > 0
            ? request.headers
            : undefined;
        return this.insert({
          name: request.name ?? nameFromUrl(request.url),
          description: null,
          type: request.transport,
          sourceKind: "manual",
          sourceRef: request.url,
          registryName: null,
          registryVersion: null,
          config: {
            type: request.transport,
            url: request.url,
            ...(headers ? { headers } : {}),
          },
        });
      }
      case "stdio":
        return this.insert({
          name: request.name,
          description: null,
          type: "stdio",
          sourceKind: "manual",
          sourceRef: request.command,
          registryName: null,
          registryVersion: null,
          config: {
            type: "stdio",
            command: request.command,
            args: request.args,
            cwd: request.cwd ?? STDIO_DEFAULT_CWD,
            ...(request.env ? { env: request.env } : {}),
          },
        });
    }
  }

  async searchRegistry(
    query: string,
    limit: number,
    remoteOnly: boolean,
  ): Promise<McpRegistryHit[]> {
    const page = await fetchRegistryServers({
      baseUrl: this.service.options.registryUrl,
      search: query,
      limit: remoteOnly ? Math.min(limit * 2, 50) : limit,
      ...(this.service.options.registryFetch
        ? { fetchImpl: this.service.options.registryFetch }
        : {}),
    });
    return page.servers
      .map(registryHit)
      .filter((hit) => !remoteOnly || hit.remote);
  }

  private async addFromRegistry(
    name: string,
    extraHeaders: Record<string, string> | undefined,
    displayName: string | undefined,
  ): Promise<McpAddServerResponse> {
    const page = await fetchRegistryServers({
      baseUrl: this.service.options.registryUrl,
      search: name,
      limit: 20,
      ...(this.service.options.registryFetch
        ? { fetchImpl: this.service.options.registryFetch }
        : {}),
    });
    const summary =
      page.servers.find((item) => item.name === name) ??
      page.servers.find(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      );
    if (!summary)
      throw new ApiError(
        404,
        "not_found",
        `Registry server not found: ${name}`,
      );
    const install = normalizeRegistryServer(summary);
    if (!install)
      throw invalidRequest(
        `No supported install package or remote for ${name}`,
      );
    const installHeaders = install.config.headers;
    const baseHeaders =
      installHeaders !== null && typeof installHeaders === "object"
        ? Object.fromEntries(Object.entries(installHeaders))
        : {};
    const config =
      extraHeaders && Object.keys(extraHeaders).length > 0
        ? { ...install.config, headers: { ...baseHeaders, ...extraHeaders } }
        : install.config;
    return this.insert({
      name: displayName ?? install.name,
      description: install.description,
      type: install.type,
      sourceKind: "registry",
      sourceRef: install.sourceRef,
      registryName: install.registryName,
      registryVersion: install.registryVersion,
      config,
    });
  }

  async remove(ref: string): Promise<McpServerRecord | undefined> {
    const server = this.store.resolve(ref);
    if (!server) return undefined;
    await this.gateway.resetServer(server.id).catch(() => {});
    await this.service.deleteCredentials(server.id).catch((error: unknown) => {
      this.service.options.logger.warn(
        `[mcp] could not delete OAuth credentials for ${server.handle}: ${errorText(error)}`,
      );
    });
    this.store.delete(server.id);
    await this.service.removeServerDirs(server.id).catch(() => {});
    this.service.publish(server.id, ["servers-changed"]);
    return server;
  }

  async setHeaders(
    ref: string,
    headers: Record<string, string>,
  ): Promise<void> {
    const server = this.requireServer(ref);
    if (server.type === "stdio")
      throw invalidRequest("stdio MCP servers do not use HTTP headers");
    let cfg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(server.configJson);
      cfg =
        parsed !== null && typeof parsed === "object"
          ? Object.fromEntries(Object.entries(parsed))
          : {};
    } catch (error) {
      throw new Error(`invalid server config: ${errorText(error)}`);
    }
    if (Object.keys(headers).length > 0) cfg.headers = headers;
    else delete cfg.headers;
    const validation = validateMcpServer(cfg);
    if (!validation.valid || !validation.config)
      throw invalidRequest(validation.errors.join("; "));
    this.store.setConfig(server.id, JSON.stringify(validation.config));
    await this.gateway.resetServer(server.id);
    this.service.publish(server.id, ["servers-changed"]);
  }

  async setEnabled(
    ref: string,
    enabled: boolean,
  ): Promise<{ enabled: boolean; status: McpServerRecord["status"] }> {
    const server = this.requireServer(ref);
    const next = this.store.setEnabled(server.id, enabled);
    if (!next)
      throw new ApiError(404, "not_found", `MCP server not found: ${ref}`);
    if (!enabled) await this.gateway.closeServer(server.id);
    this.service.publish(server.id, ["servers-changed"]);
    return { enabled: next.enabled, status: next.status };
  }

  setGuide(
    ref: string,
    guide: string | null,
  ): { id: string; handle: string; guide: string | null } {
    const server = this.requireServer(ref);
    if (guide !== null && guide.length > MCP_GUIDE_MAX_CHARS)
      throw invalidRequest(
        `Guide is longer than ${MCP_GUIDE_MAX_CHARS} characters`,
      );
    const next = guide?.trim() || null;
    this.store.setGuide(server.id, next);
    this.service.publish(server.id, ["servers-changed"]);
    return { id: server.id, handle: server.handle, guide: next };
  }

  async authenticate(ref: string): Promise<McpAuthResponse> {
    const server = this.requireServer(ref);
    const url = await this.gateway.auth.authUrl(server.id);
    return { url, status: await this.authStatus(server) };
  }

  async reconnect(ref: string): Promise<McpAuthResponse> {
    const server = this.requireServer(ref);
    const url = await this.gateway.reconnectServer(server.id);
    this.service.publish(server.id, ["runtime-changed"]);
    return { url, status: await this.authStatus(server) };
  }

  async cancelAuthentication(ref: string): Promise<void> {
    const server = this.requireServer(ref);
    await this.service.withDeferredOAuthPersistence(() =>
      this.gateway.auth.cancelAuthentication(server.id),
    );
  }

  async finishAuthentication(
    id: string,
    params: URLSearchParams,
  ): Promise<void> {
    await this.service.withDeferredOAuthPersistence(() =>
      this.gateway.auth.finishAuth(id, params),
    );
    this.service.publish(id, ["runtime-changed"]);
  }

  private policyRow(
    tool: string,
    mode: PolicyMode,
    risk: ToolRisk,
  ): McpToolPolicy {
    return { tool, risk, mode, policy: effectivePolicy(mode, risk) };
  }

  async listPolicies(ref: string): Promise<McpToolPolicy[]> {
    const server = this.requireServer(ref);
    const { tools } = await this.gateway.inspectServer(server.id);
    const stored = this.store.listToolPolicies(server.id);
    if (tools.length === 0)
      return stored.map((row) =>
        this.policyRow(row.toolName, row.mode, row.risk),
      );
    const modes = new Map(stored.map((row) => [row.toolName, row.mode]));
    return tools
      .map((tool) =>
        this.policyRow(tool.name, modes.get(tool.name) ?? "inherit", tool.risk),
      )
      .sort((a, b) => a.tool.localeCompare(b.tool));
  }

  async setPolicy(
    ref: string,
    tool: string,
    mode: PolicyMode,
  ): Promise<McpToolPolicy> {
    const server = this.requireServer(ref);
    if (!this.store.getToolPolicy(server.id, tool))
      await this.gateway.inspectServer(server.id);
    const next = this.store.setToolPolicyMode(server.id, tool, mode);
    if (!next)
      throw new ApiError(
        404,
        "not_found",
        `Tool not found on ${server.handle}: ${tool}`,
      );
    this.service.publish(server.id, ["policies-changed"]);
    return this.policyRow(next.toolName, next.mode, next.risk);
  }

  async searchTools(
    query: string,
    limit: number,
    server: string | null,
  ): Promise<McpToolSearchResponse> {
    const result = await this.gateway.searchTools(
      query,
      Math.min(limit, SEARCH_MAX),
      server ?? undefined,
    );
    const tools = result.tools.map((tool) =>
      toolRow(
        tool,
        this.store.getToolPolicy(tool.sourceId, tool.name)?.mode ?? "inherit",
      ),
    );
    return {
      tools,
      ...(result.unavailable.length ? { unavailable: result.unavailable } : {}),
    };
  }

  async searchPrompts(query: string, server: string | null) {
    const prompts = await this.gateway.listPrompts(server ?? undefined);
    const q = query.trim();
    const rows = prompts
      .map((item) => ({
        id: item.id,
        server: item.handle,
        name: item.name,
        description: item.description ?? "",
        score: q
          ? scoreMatch(q, [item.name, item.description ?? "", item.handle])
          : 1,
      }))
      .filter((item) => item.score > 0);
    rows.sort((a, b) => b.score - a.score);
    return rows
      .slice(0, SEARCH_LIMIT)
      .map(({ score: _score, ...item }) => item);
  }

  async searchResources(query: string, server: string | null) {
    const [resources, templates] = await Promise.all([
      this.gateway.listResources(server ?? undefined),
      this.gateway.listResourceTemplates(server ?? undefined),
    ]);
    const q = query.trim();
    const rows = [
      ...resources.map((item) => ({
        id: item.id,
        server: item.handle,
        uri: item.uri,
        name: item.name,
        score: q ? scoreMatch(q, [item.name, item.uri, item.handle]) : 1,
      })),
      ...templates.map((item) => ({
        id: item.id,
        server: item.handle,
        uri: item.uriTemplate,
        name: item.name,
        score: q
          ? scoreMatch(q, [item.name, item.uriTemplate, item.handle])
          : 1,
      })),
    ].filter((item) => item.score > 0);
    rows.sort((a, b) => b.score - a.score);
    return rows
      .slice(0, SEARCH_LIMIT)
      .map(({ score: _score, ...item }) => item);
  }
}
