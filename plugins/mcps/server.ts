import * as path from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { handleFor, McpsStore, type NewMcpSource } from "./src/store.js";
import { McpGateway, type McpStdioCatalog, type McpStdioHost } from "./src/gateway.js";
import { mcpHostContract, mcpHostSignals, providerMcpStatusSchema } from "./src/host-contract.js";
import { DeferredOAuthCredentialStore, McpOAuthProvider, type OAuthCredentialRecord } from "./src/oauth.js";
import { oauthRedirectBase, serverAccessPublicUrl, serverAppUrl } from "./src/oauth-redirect.js";
import { parseHeaderLines, validateMcpServer } from "./src/loader.js";
import { ensureDir, rimraf } from "./src/safe-fs.js";
import { boundText, boundJson, formatMcpResult, SCHEMA_INLINE_CHARS, scoreMatch, SEARCH_LIMIT, SEARCH_MAX, writeArtifact } from "./src/catalog.js";
import { validateCallArgs } from "./src/call-card.js";
import { classifyTool, effectivePolicy, formatPolicyRows, isPolicyMode, POLICY_MODES, type PolicyMode } from "./src/policy.js";
import { McpApprovals, type CallScope } from "./src/approvals.js";
import { formatProviderStatus, providerGuardIssues } from "./src/provider-guard.js";
import { connectedInstructions, threadServerSelection } from "./src/context.js";
import { fetchRegistryServers, normalizeRegistryServer, OFFICIAL_REGISTRY, type RegistryServerSummary } from "./src/registry.js";
import type { CompactTool, JsonRecord, McpSource, ToolRisk } from "./src/types.js";

const jsonRecordSchema = z.record(z.string(), z.unknown());
const sourceIdSchema = z.string().min(1).max(128);
const GUIDE_INPUT_MAX_CHARS = 4000;
const WARMUP_ON_START_MS = 1_000;
const WARMUP_AFTER_CHANGE_MS = 250;

const compactServerSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: z.string(),
  status: z.string(),
  sourceKind: z.string(),
  enabled: z.boolean(),
  authStatus: z.string(),
  lastError: z.string().nullable(),
  sourceRef: z.string().nullable(),
  registryName: z.string().nullable(),
  registryVersion: z.string().nullable(),
  configJson: z.string(),
  toolCount: z.number().int().nullable(),
  promptCount: z.number().int().nullable(),
  resourceCount: z.number().int().nullable(),
  guide: z.string().nullable(),
}).strict();

const compactToolSchema = z.object({
  schemaRequired: z.boolean().optional(),
  id: z.string(),
  sourceId: z.string(),
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  risk: z.enum(["read", "write", "destructive"]),
  card: z.object({
    truncated: z.boolean().optional(),
    shape: z.string(),
    fields: z.array(z.object({
      name: z.string(),
      type: z.string(),
      required: z.boolean(),
      enum: z.array(z.string()).optional(),
    })),
    example: jsonRecordSchema,
  }).optional(),
}).strict();

const policyModeSchema = z.enum(["inherit", "allow", "confirm", "deny"]);

const toolPolicySchema = z.object({
  tool: z.string(),
  risk: z.enum(["read", "write", "destructive"]),
  mode: policyModeSchema,
  policy: z.enum(["allow", "confirm", "deny"]),
}).strict();

const providerStatusSchema = z.object({
  hostId: z.string(),
  status: providerMcpStatusSchema,
  issues: z.array(z.object({ provider: z.enum(["claude", "codex"]), message: z.string() }).strict()),
}).strict();

export const rpcContract = defineRpcContract({
  snapshot: { input: z.null(), output: z.object({ servers: z.array(compactServerSchema) }).strict() },
  remove: { input: z.object({ id: sourceIdSchema }).strict(), output: z.object({ deleted: z.boolean() }).strict() },
  setEnabled: { input: z.object({ id: sourceIdSchema, enabled: z.boolean() }).strict(), output: z.object({ enabled: z.boolean(), status: z.string() }).strict() },
  setHeaders: {
    input: z.object({
      id: sourceIdSchema,
      headers: z.record(z.string(), z.string()).optional(),
      headerLines: z.array(z.string().max(4096)).max(32).optional(),
    }).strict(),
    output: z.object({ updated: z.boolean() }).strict(),
  },
  authenticate: { input: z.object({ id: sourceIdSchema }).strict(), output: z.object({ url: z.string().nullable(), status: z.string() }).strict() },
  reconnect: { input: z.object({ id: sourceIdSchema }).strict(), output: z.object({ url: z.string().nullable(), status: z.string() }).strict() },
  finishAuthentication: { input: z.object({ id: sourceIdSchema, callbackUrl: z.string().url() }).strict(), output: z.object({ authenticated: z.boolean() }).strict() },
  cancelAuthentication: { input: z.object({ id: sourceIdSchema }).strict(), output: z.object({ canceled: z.boolean() }).strict() },
  searchTools: {
    input: z.object({ query: z.string().trim().min(1).max(200), limit: z.number().int().min(1).max(12).optional() }).strict(),
    output: z.object({ tools: z.array(compactToolSchema), unavailable: z.array(z.string()) }).strict(),
  },
  inspectServer: {
    input: z.object({ id: sourceIdSchema }).strict(),
    output: z.object({ tools: z.array(compactToolSchema), error: z.string().nullable() }).strict(),
  },
  setGuide: {
    input: z.object({ id: sourceIdSchema, guide: z.string().max(GUIDE_INPUT_MAX_CHARS).nullable() }).strict(),
    output: z.object({ id: z.string(), handle: z.string(), guide: z.string().nullable() }).strict(),
  },
  listToolPolicies: {
    input: z.object({ id: sourceIdSchema }).strict(),
    output: z.object({ tools: z.array(toolPolicySchema) }).strict(),
  },
  setToolPolicy: {
    input: z.object({ id: sourceIdSchema, tool: z.string().min(1).max(512), mode: policyModeSchema }).strict(),
    output: toolPolicySchema,
  },
  providerStatus: {
    input: z.object({ hostId: z.string().min(1).max(128).optional() }).strict(),
    output: providerStatusSchema,
  },
  providerFix: {
    input: z.object({ hostId: z.string().min(1).max(128).optional() }).strict(),
    output: providerStatusSchema,
  },
});

function errorText(e: unknown): string { return e instanceof Error ? e.message : String(e); }

function redactMcpConfigJson(raw: string): string {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const redacted: Record<string, unknown> = { ...obj };
    if (obj.headers && typeof obj.headers === "object") {
      const headers: Record<string, string> = {};
      for (const key of Object.keys(obj.headers as Record<string, unknown>)) headers[key] = "***";
      redacted.headers = headers;
    }
    if (obj.env && typeof obj.env === "object") {
      const env: Record<string, string> = {};
      for (const key of Object.keys(obj.env as Record<string, unknown>)) env[key] = "***";
      redacted.env = env;
    }
    return JSON.stringify(redacted);
  } catch {
    return raw;
  }
}

function registryHit(summary: RegistryServerSummary) {
  const install = normalizeRegistryServer(summary);
  const remote = summary.remotes.find((item) => item.type === "streamable-http" || item.type === "sse" || item.url.startsWith("http"));
  return {
    name: summary.name,
    description: summary.description,
    version: summary.version,
    status: summary.status,
    installable: install !== null,
    sourceRef: install?.sourceRef ?? null,
    type: install?.type ?? null,
    remote: Boolean(remote),
    requiredHeaders: (remote?.headers ?? []).filter((header) => header.isRequired).map((header) => header.name),
  };
}

function headersFromInput(headers?: Record<string, string>, headerLines?: string[]): Record<string, string> | undefined {
  const parsed = headerLines ? parseHeaderLines(headerLines) : {};
  const merged = { ...parsed, ...(headers ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export default async function plugin(bb: BbPluginApi) {
  bb.log.info("[mcps] loading");

  let dataDir: string | null = null;
  const getDataDir = async (): Promise<string> => {
    if (dataDir) return dataDir;
    const cfg = await bb.sdk.system.config() as unknown as { dataDir?: string };
    if (typeof cfg.dataDir === "string" && cfg.dataDir) {
      dataDir = cfg.dataDir;
      return cfg.dataDir;
    }
    throw new Error("dataDir unavailable");
  };

  let warmTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  async function publishChanged(payload: Record<string, unknown>): Promise<void> {
    if (payload.kind !== "mcp-runtime") scheduleWarmup(WARMUP_AFTER_CHANGE_MS);
    try { await bb.realtime.publish("mcps-changed", payload); }
    catch (error) { bb.log.warn(`[mcps] realtime publish failed: ${errorText(error)}`); }
  }

  const store = new McpsStore(bb.storage.database(), (db, statements) => bb.storage.migrate(db, statements));
  const settings = bb.settings.define({
    registryUrl: {
      type: "string",
      label: "MCP Registry URL",
      description: "Official or private MCP Registry base URL.",
      default: OFFICIAL_REGISTRY,
    },
    oauthCredentials: {
      type: "string",
      label: "MCP OAuth credentials",
      description: "Managed automatically by MCPs; stored as a BB secret.",
      secret: true,
      default: "",
    },
    oauthRedirectBaseUrl: {
      type: "string",
      label: "OAuth redirect base URL",
      description: "Public origin for MCP OAuth callbacks when the browser is not on this server. Empty uses BB_APP_URL, then this instance's public Connect URL, then loopback.",
      default: "",
    },
  });
  const oauthCredentialStore = new DeferredOAuthCredentialStore({
    async load(): Promise<Record<string, OAuthCredentialRecord>> {
      const raw = (await settings.get()).oauthCredentials;
      if (!raw) return {};
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, OAuthCredentialRecord>;
      } catch (error) { bb.log.warn(`[mcps] OAuth secret store is invalid: ${errorText(error)}`); }
      return {};
    },
    async save(next: Record<string, OAuthCredentialRecord>): Promise<void> {
      await bb.sdk.plugins.updateSettings({ pluginId: bb.pluginId, values: { oauthCredentials: JSON.stringify(next) } });
    },
  }, (error) => bb.log.warn(`[mcps] OAuth secret persistence failed: ${errorText(error)}`));
  async function withDeferredOAuthPersistence<T>(operation: () => Promise<T>): Promise<T> {
    const release = oauthCredentialStore.deferPersistence();
    try { return await operation(); }
    finally { release(); }
  }

  const mcpHostClient = bb.hosts.experimental_client({
    contract: mcpHostContract,
    experimental_signals: mcpHostSignals,
  });
  let mcpHostIdPromise: Promise<string> | null = null;
  async function getMcpHostId(): Promise<string> {
    if (mcpHostIdPromise) return mcpHostIdPromise;
    mcpHostIdPromise = (async () => {
      const cfg = await bb.sdk.system.config() as unknown as { primaryHostId?: string | null };
      if (cfg.primaryHostId) return cfg.primaryHostId;
      const hosts = await bb.sdk.hosts.list();
      const hostId = hosts[0]?.id;
      if (!hostId) throw new Error("No host available for isolated MCP servers");
      return hostId;
    })().catch((error) => {
      mcpHostIdPromise = null;
      throw error;
    });
    return mcpHostIdPromise;
  }
  const hostCall = async (method: string, input: unknown, signal?: AbortSignal): Promise<unknown> => {
    const hostId = await getMcpHostId();
    const client = mcpHostClient as unknown as {
      call(name: string, value: unknown, options: { hostId: string; signal?: AbortSignal }): Promise<unknown>;
    };
    return client.call(method, input, { hostId, ...(signal ? { signal } : {}) });
  };
  const stdioHost: McpStdioHost = {
    async start(config, signal) { return await hostCall("start", config, signal) as McpStdioCatalog; },
    async refresh(id, signal) { return await hostCall("refresh", { id }, signal) as McpStdioCatalog; },
    async close(id, signal) { await hostCall("close", { id }, signal); },
    async callTool(id, name, args, toolDefinition, signal) {
      return hostCall("callTool", { id, name, args, ...(toolDefinition ? { toolDefinition } : {}) }, signal);
    },
    async getPrompt(id, name, args, signal) { return hostCall("getPrompt", { id, name, args }, signal); },
    async readResource(id, uri, signal) { return hostCall("readResource", { id, uri }, signal); },
    onWorkerExit(handler) {
      return mcpHostClient.experimental_onWorkerExit(({ hostId }) => handler(hostId));
    },
    onCatalogChanged(handler) {
      return mcpHostClient.experimental_onSignal("catalogChanged", ({ payload }) => handler(payload.id, payload.kind, payload.error));
    },
    onConnectionChanged(handler) {
      return mcpHostClient.experimental_onSignal("connectionChanged", ({ payload }) => handler(payload.id, payload.status, payload.error));
    },
  };
  async function serverDir(id: string): Promise<string> {
    return path.join(await getDataDir(), "plugins", "mcps", "servers", id);
  }
  async function serverDirs(id: string) {
    const dir = await serverDir(id);
    return { root: path.join(dir, "root"), data: path.join(dir, "data") };
  }

  const approvals = new McpApprovals(bb.ui, bb.log);
  const gateway = new McpGateway(store, bb.log, {
    serverDirs,
    onChanged: () => publishChanged({ kind: "mcp-runtime" }),
    onElicitation: (request, id) => approvals.elicit(request, id, store.get(id)?.handle ?? id),
    stdioHost,
    oauth: {
      async getProvider(id, serverUrl) {
        const current = await settings.get();
        let publicUrl: string | null = null;
        try { publicUrl = serverAccessPublicUrl(await bb.sdk.system.config()); } catch {}
        const base = oauthRedirectBase({
          setting: current.oauthRedirectBaseUrl,
          appUrl: serverAppUrl(bb.server),
          publicUrl,
          loopbackBaseUrl: bb.server.loopbackBaseUrl,
        });
        const redirect = new URL(`/api/v1/plugins/${encodeURIComponent(bb.pluginId)}/http/oauth/callback`, base);
        redirect.search = new URLSearchParams({ id }).toString();
        return new McpOAuthProvider(id, serverUrl, redirect, oauthCredentialStore);
      },
    },
  });

  async function artifactDir(): Promise<string> {
    const dir = path.join(await getDataDir(), "plugins", "mcps", "artifacts");
    await ensureDir(dir);
    return dir;
  }
  async function agentReply(value: unknown, name: string, maxChars = 8_000) {
    const formatted = formatMcpResult(value);
    const text = await boundText(formatted.text, { artifactDir: await artifactDir(), name, maxChars });
    return { content: [{ type: "text" as const, text }], ...(formatted.isError ? { isError: true as const } : {}) };
  }

  async function agentData(value: unknown, name: string) {
    const result = await boundJson(value, { artifactDir: await artifactDir(), name, maxChars: 8_000 });
    return { content: [{ type: "text" as const, text: result.json }] };
  }

  async function addServer({ config, ...input }: Omit<NewMcpSource, "configJson"> & { config: Record<string, unknown> }) {
    const validation = validateMcpServer(config);
    if (!validation.valid || !validation.config) throw new Error(validation.errors.join("; "));
    const source = store.insert({ ...input, configJson: JSON.stringify(validation.config) });
    try {
      const dirs = await serverDirs(source.id);
      await ensureDir(dirs.root);
      await ensureDir(dirs.data);
    } catch (error) {
      store.delete(source.id);
      throw error;
    }
    await publishChanged({ kind: "add", id: source.id });
    return { id: source.id, handle: source.handle, name: source.name };
  }

  function requireSource(ref: string): McpSource {
    const source = store.resolve(ref);
    if (!source) throw new Error(`MCP server not found: ${ref}`);
    return source;
  }

  async function removeServer(ref: string): Promise<McpSource | undefined> {
    const source = store.resolve(ref);
    if (!source) return undefined;
    await gateway.resetServer(source.id).catch(() => {});
    await oauthCredentialStore.delete(source.id).catch((error) => {
      bb.log.warn(`[mcps] could not delete OAuth credentials for ${source.handle}: ${errorText(error)}`);
    });
    store.delete(source.id);
    await rimraf(await serverDir(source.id)).catch(() => {});
    await publishChanged({ kind: "remove", id: source.id });
    return source;
  }

  function counts(id: string) {
    const known = gateway.catalogCounts(id);
    return { toolCount: known?.tools ?? null, promptCount: known?.prompts ?? null, resourceCount: known?.resources ?? null };
  }

  async function snapshotRow(source: McpSource) {
    let authStatus = "not-applicable";
    if (source.type !== "stdio") {
      try { authStatus = await gateway.authStatus(source.id); }
      catch { authStatus = "unknown"; }
    }
    return {
      id: source.id,
      handle: source.handle,
      name: source.name,
      description: source.description,
      type: source.type,
      status: source.status,
      sourceKind: source.sourceKind,
      enabled: source.enabled,
      authStatus,
      lastError: source.lastError,
      sourceRef: source.sourceRef,
      registryName: source.registryName,
      registryVersion: source.registryVersion,
      configJson: redactMcpConfigJson(source.configJson),
      guide: source.guide,
      ...counts(source.id),
    };
  }

  async function buildSnapshot() {
    return { servers: await Promise.all(store.list().map(snapshotRow)) };
  }

  async function searchRegistry(query: string, limit = 12, remoteOnly = false) {
    const baseUrl = (await settings.get()).registryUrl || OFFICIAL_REGISTRY;
    const page = await fetchRegistryServers({ baseUrl, search: query, limit: remoteOnly ? Math.min(limit * 2, 50) : limit });
    return page.servers;
  }

  async function addFromRegistry(name: string, extraHeaders?: Record<string, string>, displayName?: string) {
    const servers = await searchRegistry(name, 20);
    const summary = servers.find((item) => item.name === name) ?? servers.find((item) => item.name.toLowerCase() === name.toLowerCase());
    if (!summary) throw new Error(`Registry server not found: ${name}`);
    const install = normalizeRegistryServer(summary);
    if (!install) throw new Error(`No supported install package or remote for ${name}`);
    const config = extraHeaders && Object.keys(extraHeaders).length > 0
      ? { ...install.config, headers: { ...((install.config.headers as Record<string, string> | undefined) ?? {}), ...extraHeaders } }
      : install.config;
    return addServer({
      name: displayName ?? install.name,
      description: install.description,
      sourceKind: "registry",
      sourceRef: install.sourceRef,
      registryName: install.registryName,
      registryVersion: install.registryVersion,
      type: install.type,
      config,
    });
  }

  async function writeHeaders(ref: string, headers?: Record<string, string>) {
    const source = requireSource(ref);
    if (source.type === "stdio") throw new Error("stdio MCP servers do not use HTTP headers");
    let cfg: Record<string, unknown>;
    try { cfg = JSON.parse(source.configJson) as Record<string, unknown>; }
    catch (error) { throw new Error(`invalid server config: ${errorText(error)}`); }
    if (headers && Object.keys(headers).length > 0) cfg.headers = headers;
    else delete cfg.headers;
    const validation = validateMcpServer(cfg);
    if (!validation.valid || !validation.config) throw new Error(validation.errors.join("; "));
    store.setConfig(source.id, JSON.stringify(validation.config));
    await gateway.resetServer(source.id);
    await publishChanged({ kind: "headers", id: source.id });
  }

  async function setEnabled(ref: string, enabled: boolean) {
    const source = requireSource(ref);
    const next = store.setEnabled(source.id, enabled)!;
    if (!enabled) await gateway.closeServer(source.id);
    await publishChanged({ kind: "enable", id: source.id, enabled });
    return { enabled: next.enabled, status: next.status };
  }

  function policyRow(tool: string, mode: PolicyMode, risk: ToolRisk) {
    return { tool, risk, mode, policy: effectivePolicy(mode, risk) };
  }

  async function listPolicies(ref: string) {
    const source = requireSource(ref);
    const { tools } = await gateway.inspectServer(source.id);
    const stored = store.listToolPolicies(source.id);
    if (tools.length === 0) return stored.map((row) => policyRow(row.toolName, row.mode, row.risk));
    const modes = new Map(stored.map((row) => [row.toolName, row.mode]));
    return tools.map((tool) => policyRow(tool.name, modes.get(tool.name) ?? "inherit", tool.risk)).sort((a, b) => a.tool.localeCompare(b.tool));
  }

  async function setPolicy(ref: string, tool: string, mode: PolicyMode) {
    const source = requireSource(ref);
    if (!store.getToolPolicy(source.id, tool)) await gateway.inspectServer(source.id);
    const next = store.setToolPolicyMode(source.id, tool, mode);
    if (!next) throw new Error(`Tool not found on ${source.handle}: ${tool}`);
    await publishChanged({ kind: "policy", id: source.id, tool });
    return policyRow(next.toolName, next.mode, next.risk);
  }

  async function providerStatus(method: "providerMcpStatus" | "providerMcpFix", hostId?: string, projectPath?: string) {
    const target = hostId ?? await getMcpHostId();
    const status = providerMcpStatusSchema.parse(await mcpHostClient.call(method, projectPath ? { projectPath } : {}, { hostId: target }));
    return { hostId: target, status, issues: providerGuardIssues(status) };
  }

  function scheduleWarmup(delayMs: number): void {
    if (disposed) return;
    if (warmTimer) clearTimeout(warmTimer);
    warmTimer = setTimeout(() => {
      warmTimer = null;
      if (!disposed) void gateway.warm().catch((error) => bb.log.info(`[mcps] warmup failed: ${errorText(error)}`));
    }, delayMs);
    warmTimer.unref?.();
  }

  async function invokeTool(id: string, args: JsonRecord, scope: CallScope = { threadId: null }) {
    const tool = gateway.peekTool(id) ?? await gateway.getTool(id);
    const invalid = validateCallArgs(tool.inputSchema, args);
    if (invalid) {
      return { isError: true, error: `Invalid arguments for ${tool.name}: ${invalid}` };
    }
    const risk = classifyTool(tool.annotations);
    const policy = effectivePolicy(store.getToolPolicy(tool.sourceId, tool.name)?.mode ?? "inherit", risk);
    if (policy === "deny") {
      return { isError: true, error: `${tool.handle}/${tool.name} is blocked by the user's MCP policy (deny); the tool was not run. Ask the user if it should be allowed.` };
    }
    if (policy === "confirm") {
      const refused = await approvals.confirmTool({ scope, server: tool.handle, tool: tool.name, risk, args });
      if (refused) return { isError: true, error: refused };
    }
    return approvals.runCall(tool.sourceId, scope, () => gateway.call(id, args, scope.signal));
  }

  bb.http.route("GET", "/oauth/callback", async (context) => {
    const url = new URL(context.req.url);
    const id = url.searchParams.get("id");
    if (!id) return new Response("Missing MCPs OAuth callback context", { status: 400 });
    try {
      await withDeferredOAuthPersistence(() => gateway.finishAuth(id, url.searchParams));
      await publishChanged({ kind: "oauth", id });
      return new Response("<p>Authentication completed. You can close this window.</p>", { headers: { "content-type": "text/html; charset=utf-8" } });
    } catch (error) {
      bb.log.warn(`[mcps] OAuth callback failed for ${id}: ${errorText(error)}`);
      return new Response("<p>Authentication failed. Return to BB and try again.</p>", { status: 400, headers: { "content-type": "text/html; charset=utf-8" } });
    }
  });

  async function writeGuide(ref: string, guide: string | null) {
    const source = requireSource(ref);
    if (guide !== null && guide.length > GUIDE_INPUT_MAX_CHARS) throw new Error(`Guide is longer than ${GUIDE_INPUT_MAX_CHARS} characters`);
    const next = guide?.trim() || null;
    store.setGuide(source.id, next);
    await publishChanged({ kind: "guide", id: source.id });
    return { id: source.id, handle: source.handle, guide: next };
  }

  bb.rpc.register(rpcContract, {
    snapshot: () => buildSnapshot(),
    async remove({ id }) { return { deleted: (await removeServer(id)) !== undefined }; },
    setEnabled: ({ id, enabled }) => setEnabled(id, enabled),
    async setHeaders({ id, headers, headerLines }) {
      await writeHeaders(id, headersFromInput(headers, headerLines));
      return { updated: true };
    },
    async authenticate({ id }) {
      const source = requireSource(id);
      const url = await gateway.authUrl(source.id);
      return { url, status: await gateway.authStatus(source.id) };
    },
    async reconnect({ id }) {
      const source = requireSource(id);
      const url = await gateway.reconnectServer(source.id);
      await publishChanged({ kind: "reconnect", id: source.id });
      return { url, status: await gateway.authStatus(source.id) };
    },
    async finishAuthentication({ id, callbackUrl }) {
      const source = requireSource(id);
      await withDeferredOAuthPersistence(() => gateway.finishAuth(source.id, new URL(callbackUrl).searchParams));
      await publishChanged({ kind: "oauth", id: source.id });
      return { authenticated: true };
    },
    async cancelAuthentication({ id }) {
      const source = requireSource(id);
      await withDeferredOAuthPersistence(() => gateway.cancelAuthentication(source.id));
      return { canceled: true };
    },
    async searchTools({ query, limit }) { return gateway.searchTools(query, limit ?? SEARCH_LIMIT); },
    inspectServer: ({ id }) => gateway.inspectServer(requireSource(id).id),
    setGuide: ({ id, guide }) => writeGuide(id, guide),
    async listToolPolicies({ id }) { return { tools: await listPolicies(id) }; },
    setToolPolicy: ({ id, tool, mode }) => setPolicy(id, tool, mode),
    providerStatus: ({ hostId }) => providerStatus("providerMcpStatus", hostId),
    providerFix: ({ hostId }) => providerStatus("providerMcpFix", hostId),
  });

  const idSchema = z.string().trim().min(1).describe("ID from discovery.");

  function toolRows(tools: CompactTool[]) {
    return tools.map(tool => {
      const policy = effectivePolicy(store.getToolPolicy(tool.sourceId, tool.name)?.mode ?? "inherit", tool.risk);
      return {
        id: tool.id,
        server: tool.handle,
        name: tool.name,
        description: tool.description,
        ...(tool.risk !== "read" ? { risk: tool.risk } : {}),
        ...(policy !== "allow" ? { policy } : {}),
        ...(tool.card ? { input: Object.fromEntries(tool.card.fields.map(field => [field.name + (field.required ? "" : "?"), field.type])) } : { schemaRequired: true }),
        ...(tool.schemaRequired || tool.card?.truncated || tool.card?.shape.includes("…") || tool.card?.fields.length === 0 && tool.card.shape !== "{}" ? { schemaRequired: true } : {}),
      };
    });
  }

  function serverRows(details = false) {
    return store.list().map(source => {
      const { toolCount, promptCount, resourceCount } = counts(source.id);
      return {
        id: source.id,
        handle: source.handle,
        type: source.type,
        status: source.status,
        ...(toolCount !== null ? { tools: toolCount } : {}),
        ...(details ? {
          name: source.name,
          ...(source.description ? { description: source.description } : {}),
          sourceKind: source.sourceKind,
          ...(promptCount !== null ? { prompts: promptCount } : {}),
          ...(resourceCount !== null ? { resources: resourceCount } : {}),
          ...(source.lastError ? { error: source.lastError } : {}),
        } : {}),
      };
    });
  }

  const toolNames = ["mcp_servers", "mcp_search", "mcp_schema", "mcp_call", "mcp_prompts", "mcp_get_prompt", "mcp_resources", "mcp_read_resource"] as const;
  bb.agents.registerTool({
    name: "mcp_servers",
    description: "List installed MCPs with stable IDs, handles, status and known tool counts. Paginated; details opt-in.",
    instructions: "Use only to inspect installed servers, status, or handles. mcp_search does not require this first.",
    presentation: { label: { pending: "Listing MCP servers", completed: "Listed MCP servers" } },
    parameters: z.object({
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      cursor: z.number().int().min(0).default(0),
      details: z.boolean().default(false),
    }).strict(),
    async execute({ query, limit, cursor, details }) {
      let rows = serverRows(details);
      if (query) {
        const q = query.toLowerCase();
        const names = new Map(store.list().map((source) => [source.id, source.name.toLowerCase()]));
        rows = rows.filter(row => row.id === query || row.handle.includes(q) || names.get(row.id)?.includes(q));
      }
      rows.sort((a, b) => a.handle.localeCompare(b.handle));
      const servers = rows.slice(cursor, cursor + limit);
      return agentData({ servers, ...(cursor + limit < rows.length ? { nextCursor: cursor + limit } : {}) }, "servers");
    },
  });
  bb.agents.registerTool({
    name: "mcp_search",
    description: "Search MCP tools directly; returns id, server handle, description and input fields (? optional, dots nested). Default 5 results; optional limit is capped at 12.",
    instructions: "Do not list servers first. Search a short capability phrase, optionally filtering by a known server ID or handle. Do not repeat an unchanged query after it succeeds. Usually omit limit; oversized values are capped. Call by id. Request mcp_schema only for missing constraints or schemaRequired results.",
    presentation: { label: { pending: "Searching MCP tools", completed: "Searched MCP tools" } },
    parameters: z.object({
      query: z.string().trim().min(1).max(200),
      server: z.string().max(128).optional(),
      limit: z.number().int().min(1).optional().describe("Desired result count; values above 12 are capped. Usually omit."),
    }).strict(),
    async execute({ query, limit, server }) {
      const result = await gateway.searchTools(query, Math.min(limit ?? SEARCH_LIMIT, SEARCH_MAX), server);
      return agentData({ tools: toolRows(result.tools), ...(result.unavailable.length ? { unavailable: result.unavailable } : {}) }, "search");
    },
  });
  bb.agents.registerTool({
    name: "mcp_schema",
    description: "Get one tool's full description and input schema by id. Large schemas are saved as artifacts.",
    instructions: "Use when search input is insufficient. Read artifactPath for schemas too large to inline.",
    presentation: { label: { pending: "Loading MCP schema", completed: "Loaded MCP schema" } },
    parameters: z.object({ id: idSchema }).strict(),
    async execute({ id }) {
      const tool = await gateway.getTool(id);
      const schemaJson = JSON.stringify(tool.inputSchema);
      const payload: JsonRecord = {
        id: tool.id,
        name: tool.name,
        description: tool.description,
        risk: classifyTool(tool.annotations),
      };
      if (schemaJson.length <= SCHEMA_INLINE_CHARS) payload.inputSchema = tool.inputSchema;
      else {
        payload.bytes = Buffer.byteLength(schemaJson, "utf8");
        payload.artifactPath = await writeArtifact(JSON.stringify(tool.inputSchema, null, 2), {
          artifactDir: await artifactDir(),
          name: "schema",
        });
      }
      return agentData(payload, "schema");
    },
  });
  bb.agents.registerTool({
    name: "mcp_call",
    description: "Call one MCP tool by id. Does not re-list the catalog.",
    instructions: "Use id from mcp_search. Report the result to the user; the UI may show only a success envelope.",
    presentation: { label: { pending: "Calling MCP tool", completed: "Called MCP tool" } },
    parameters: z.object({ id: idSchema, args: jsonRecordSchema.default({}) }).strict(),
    async execute({ id, args }, ctx) {
      return agentReply(await invokeTool(id, args, { threadId: ctx.threadId, signal: ctx.signal }), "call");
    },
  });
  bb.agents.registerTool({
    name: "mcp_prompts",
    description: "Search compact MCP prompts. Pass query; default 5 hits.",
    presentation: { label: { pending: "Searching MCP prompts", completed: "Searched MCP prompts" } },
    parameters: z.object({ query: z.string().trim().max(200).optional(), server: z.string().max(128).optional() }).strict(),
    async execute({ query, server }) {
      const prompts = await gateway.listPrompts(server);
      const q = query?.trim() ?? "";
      const rows = prompts.map((item) => ({
        id: item.id,
        server: item.handle,
        name: item.name,
        description: item.description ?? "",
        score: q ? scoreMatch(q, [item.name, item.description ?? "", item.handle]) : 1,
      })).filter((item) => item.score > 0);
      rows.sort((a, b) => b.score - a.score);
      return agentData({ prompts: rows.slice(0, SEARCH_LIMIT).map(({ score: _, ...item }) => item) }, "prompts");
    },
  });
  bb.agents.registerTool({
    name: "mcp_get_prompt",
    description: "Get one MCP prompt by id.",
    instructions: "Use id from mcp_prompts.",
    presentation: { label: { pending: "Getting MCP prompt", completed: "Got MCP prompt" } },
    parameters: z.object({ id: idSchema, args: jsonRecordSchema.default({}) }).strict(),
    async execute({ id, args }, ctx) {
      return agentReply(await gateway.getPrompt(id, args, ctx.signal), "prompt");
    },
  });
  bb.agents.registerTool({
    name: "mcp_resources",
    description: "Search compact MCP resources. Pass query; default 5 hits.",
    presentation: { label: { pending: "Searching MCP resources", completed: "Searched MCP resources" } },
    parameters: z.object({ query: z.string().trim().max(200).optional(), server: z.string().max(128).optional() }).strict(),
    async execute({ query, server }) {
      const [resources, resourceTemplates] = await Promise.all([gateway.listResources(server), gateway.listResourceTemplates(server)]);
      const q = query?.trim() ?? "";
      const rows = [
        ...resources.map((item) => ({ id: item.id, server: item.handle, uri: item.uri, name: item.name, score: q ? scoreMatch(q, [item.name, item.uri, item.handle]) : 1 })),
        ...resourceTemplates.map((item) => ({ id: item.id, server: item.handle, uri: item.uriTemplate, name: item.name, score: q ? scoreMatch(q, [item.name, item.uriTemplate, item.handle]) : 1 })),
      ].filter((item) => item.score > 0);
      rows.sort((a, b) => b.score - a.score);
      return agentData({ resources: rows.slice(0, SEARCH_LIMIT).map(({ score: _, ...item }) => item) }, "resources");
    },
  });
  bb.agents.registerTool({
    name: "mcp_read_resource",
    description: "Read one MCP resource by id.",
    instructions: "Use id from mcp_resources.",
    presentation: { label: { pending: "Reading MCP resource", completed: "Read MCP resource" } },
    parameters: z.object({ id: idSchema }).strict(),
    async execute({ id }, ctx) { return agentReply(await gateway.readResource(id, ctx.signal), "resource"); },
  });
  bb.agents.configure((ctx) => {
    const instructions = connectedInstructions(store.listEnabled(), threadServerSelection(ctx.pluginMetadata));
    return { tools: [...toolNames], skills: [], ...(instructions ? { instructions } : {}) };
  });

  function looksLikeUrl(value: string): boolean {
    return /^https?:\/\//i.test(value);
  }
  function nameFromUrl(value: string): string {
    try { return handleFor(new URL(value).hostname.replace(/^(mcp|www)\./, "")); }
    catch { return "http"; }
  }
  function addManual(name: string, type: McpSource["type"], sourceRef: string, config: Record<string, unknown>) {
    return addServer({ name, description: null, type, sourceKind: "manual", sourceRef, registryName: null, registryVersion: null, config });
  }
  async function addFromArgv(opts: { positional: string[]; headerLines: string[]; sse: boolean }) {
    const dash = opts.positional.indexOf("--");
    const before = dash >= 0 ? opts.positional.slice(0, dash) : opts.positional;
    const after = dash >= 0 ? opts.positional.slice(dash + 1) : [];
    const headers = headersFromInput(undefined, opts.headerLines);
    if (dash >= 0) {
      const name = before[0];
      const commandName = after[0];
      if (!name || !commandName) throw new Error("Usage: bb mcp add <name> -- <command> [args...]");
      return addManual(name, "stdio", commandName, { type: "stdio", command: commandName, args: after.slice(1), cwd: "${PLUGIN_DATA}" });
    }
    const source = before.length >= 2 ? before[1]! : before[0];
    if (!source) throw new Error("Usage: bb mcp add <name> <url|registry-id>");
    const explicitName = before.length >= 2 ? before[0]! : undefined;
    if (looksLikeUrl(source) || opts.sse) {
      const type = opts.sse || source.includes("/sse") ? "sse" as const : "streamable-http" as const;
      return addManual(explicitName || nameFromUrl(source), type, source, headers ? { type, url: source, headers } : { type, url: source });
    }
    return addFromRegistry(source, headers, explicitName);
  }

  const usage = [
    "Usage:",
    "  bb mcp list [--details] [--json]",
    "  bb mcp show <id> [--json]",
    "  bb mcp add <name> <url> [--header 'Name: value'] [--sse] [--json]",
    "  bb mcp add <name> <registry-id> [--header 'Name: value'] [--json]",
    "  bb mcp add <name> -- <command> [args...] [--json]",
    "  bb mcp registry <query> [--http] [--json]",
    "  bb mcp tools <query> [--json]",
    "  bb mcp auth <id> [--json]",
    "  bb mcp header <id> Name: value [--json]",
    "  bb mcp enable <id> [--json]",
    "  bb mcp disable <id> [--json]",
    "  bb mcp remove <id> [--json]",
    "  bb mcp call <id> [json-args] [--json]",
    "  bb mcp guide <id> [text] [--clear] [--json]",
    "  bb mcp policy <id> [tool] [allow|confirm|deny|inherit] [--json]",
    "  bb mcp providers [--fix] [--machine <id>] [--path <dir>] [--json]",
  ].join("\n");

  bb.cli.register({
    name: "mcp",
    summary: "Manage MCP servers for every provider",
    commands: [
      { name: "list", summary: "List installed MCP servers", usage: "bb mcp list [--details] [--json]" },
      { name: "show", summary: "Show one MCP server", usage: "bb mcp show <id> [--json]" },
      { name: "add", summary: "Add an HTTP URL, registry id, or local command", usage: "bb mcp add <name> <url|registry-id>  |  bb mcp add <name> -- <command> [args...]" },
      { name: "registry", summary: "Search the official MCP Registry", usage: "bb mcp registry <query> [--http] [--json]" },
      { name: "tools", summary: "Search tools on enabled servers", usage: "bb mcp tools <query> [--json]" },
      { name: "auth", summary: "Start or inspect OAuth for an HTTP server", usage: "bb mcp auth <id> [--json]" },
      { name: "header", summary: "Set HTTP headers on a cloud server", usage: "bb mcp header <id> Name: value [--json]" },
      { name: "enable", summary: "Enable a server", usage: "bb mcp enable <id> [--json]" },
      { name: "disable", summary: "Disable a server", usage: "bb mcp disable <id> [--json]" },
      { name: "remove", summary: "Remove a server", usage: "bb mcp remove <id> [--json]" },
      { name: "call", summary: "Call one MCP tool by tool ID", usage: "bb mcp call <id> [json-args] [--json]" },
      { name: "guide", summary: "Show, set, or clear the agent guide for a server", usage: "bb mcp guide <id> [text] [--clear] [--json]" },
      { name: "policy", summary: "List or set per-tool call policies", usage: "bb mcp policy <id> [tool] [allow|confirm|deny|inherit] [--json]" },
      { name: "providers", summary: "Check that Claude Code and Codex load no MCPs of their own", usage: "bb mcp providers [--fix] [--machine <id>] [--path <dir>] [--json]" },
    ],
    async run(argv, ctx) {
      const asJson = argv.includes("--json");
      const args = argv.filter((item) => item !== "--json");
      const [command, ...rest] = args;
      const reply = (value: unknown, text: string) => ({ exitCode: 0, stdout: (asJson ? JSON.stringify(value) : text) + "\n" });
      const takeOptions = (argv: string[]) => {
        const positional: string[] = [];
        const headerLines: string[] = [];
        let sse = false;
        let remoteOnly = false;
        for (let i = 0; i < argv.length; i += 1) {
          const item = argv[i]!;
          if (item === "--sse") sse = true;
          else if (item === "--http") remoteOnly = true;
          else if (item === "--header") {
            const value = argv[i + 1];
            if (!value) throw new Error("--header needs a 'Name: value' argument");
            headerLines.push(value);
            i += 1;
          } else if (item.startsWith("--header=")) headerLines.push(item.slice("--header=".length));
          else positional.push(item);
        }
        return { positional, headerLines, sse, remoteOnly };
      };
      try {
        switch (command) {
          case undefined:
          case "help":
          case "--help":
            return { exitCode: 0, stdout: usage + "\n" };
          case "list": {
            const rows = serverRows(rest.includes("--details"));
            return reply(rows, rows.length === 0
              ? "No MCP servers. Try: bb mcp registry notion"
              : rows.map((item) => `${item.id}  ${item.handle}  ${item.type}  ${item.status}`).join("\n"));
          }
          case "show": {
            if (!rest[0]) break;
            const source = store.resolve(rest[0]);
            if (!source) return { exitCode: 1, stderr: `not found: ${rest[0]}\n` };
            const item = await snapshotRow(source);
            return reply(item, [
              `id: ${item.id}`,
              `handle: ${item.handle}`,
              `name: ${item.name}`,
              `type: ${item.type}`,
              `status: ${item.status}`,
              `enabled: ${item.enabled}`,
              `auth: ${item.authStatus}`,
              item.sourceRef ? `source: ${item.sourceRef}` : null,
              item.registryName ? `registry: ${item.registryName}` : null,
              item.lastError ? `error: ${item.lastError}` : null,
              item.guide ? `guide: ${item.guide}` : null,
            ].filter(Boolean).join("\n"));
          }
          case "registry": {
            const opts = takeOptions(rest);
            const query = opts.positional.join(" ").trim();
            if (!query) break;
            const hits = (await searchRegistry(query, 12, opts.remoteOnly)).map(registryHit).filter((hit) => !opts.remoteOnly || hit.remote);
            return reply(hits, hits.length === 0 ? "No registry matches." : hits.map((item) => `${item.remote ? "http" : item.type ?? "unsupported"}  ${item.name}  ${item.requiredHeaders.length ? `headers:${item.requiredHeaders.join(",")}` : ""}  ${item.description}`.replace(/\s+/g, " ").trim()).join("\n"));
          }
          case "add": {
            const added = await addFromArgv(takeOptions(rest));
            return reply(added, `Added ${added.name} (${added.id})`);
          }
          case "header": {
            const opts = takeOptions(rest);
            const id = opts.positional[0];
            if (!id) break;
            const inline = opts.positional.slice(1).join(" ").trim();
            const lines = [...opts.headerLines];
            if (inline) lines.push(inline);
            await writeHeaders(id, headersFromInput(undefined, lines));
            return reply({ updated: true, id }, `Updated headers for ${id}`);
          }
          case "enable":
          case "disable": {
            if (!rest[0]) break;
            const result = await setEnabled(rest[0], command === "enable");
            return reply(result, `${command}d ${rest[0]}`);
          }
          case "remove": {
            if (!rest[0]) break;
            const source = await removeServer(rest[0]);
            if (!source) return { exitCode: 1, stderr: `not found: ${rest[0]}\n` };
            return reply({ deleted: true, id: source.id }, `Removed ${source.name}`);
          }
          case "auth": {
            if (!rest[0]) break;
            const source = requireSource(rest[0]);
            const url = await gateway.authUrl(source.id);
            const status = await gateway.authStatus(source.id);
            return reply({ url, status }, url ? `${status}\n${url}` : status);
          }
          case "tools": {
            const query = rest.join(" ").trim();
            if (!query) break;
            const { tools, unavailable } = await gateway.searchTools(query);
            const lines = tools.map((tool) => `${tool.id}  ${tool.name}  ${tool.description}`);
            if (unavailable.length > 0) lines.push(`unavailable: ${unavailable.join("; ")}`);
            return reply({ tools: toolRows(tools), ...(unavailable.length ? { unavailable } : {}) }, lines.length === 0 ? "No matching tools." : lines.join("\n"));
          }
          case "guide": {
            const id = rest[0];
            if (!id) break;
            const clear = rest.includes("--clear");
            const text = rest.slice(1).filter((item) => item !== "--clear").join(" ").trim();
            if (clear && text) return { exitCode: 2, stderr: "Pass guide text or --clear, not both\n" };
            if (!clear && !text) {
              const source = store.resolve(id);
              if (!source) return { exitCode: 1, stderr: `not found: ${id}\n` };
              return reply({ id: source.id, handle: source.handle, guide: source.guide }, source.guide ?? `No guide for ${source.handle}.`);
            }
            const result = await writeGuide(id, clear ? null : text);
            return reply(result, result.guide === null ? `Cleared guide for ${result.handle}` : `Updated guide for ${result.handle}`);
          }
          case "policy": {
            const [id, tool, mode, extra] = rest;
            if (!id || extra !== undefined) break;
            if (!tool) {
              const rows = await listPolicies(id);
              return reply(rows, rows.length === 0 ? "No tools reported yet." : formatPolicyRows(rows));
            }
            if (!mode) {
              const row = (await listPolicies(id)).find((item) => item.tool === tool);
              if (!row) return { exitCode: 1, stderr: `Tool not found on ${id}: ${tool}\n` };
              return reply(row, formatPolicyRows([row]));
            }
            if (!isPolicyMode(mode)) return { exitCode: 2, stderr: `mode must be one of: ${POLICY_MODES.join(", ")}\n` };
            const row = await setPolicy(id, tool, mode);
            return reply(row, formatPolicyRows([row]));
          }
          case "providers": {
            let machine: string | undefined;
            let projectPath: string | undefined;
            let fix = false;
            for (let i = 0; i < rest.length; i += 1) {
              const item = rest[i]!;
              if (item === "--fix") fix = true;
              else if (item === "--machine" || item === "--path") {
                const value = rest[i + 1];
                if (!value) return { exitCode: 2, stderr: `${item} needs a value\n` };
                if (item === "--machine") machine = value; else projectPath = value;
                i += 1;
              } else return { exitCode: 2, stderr: usage + "\n" };
            }
            const result = await providerStatus(fix ? "providerMcpFix" : "providerMcpStatus", machine, projectPath ?? (machine ? undefined : ctx.cwd));
            return reply(result, formatProviderStatus(result, fix));
          }
          case "call": {
            const id = rest[0];
            if (!id) break;
            let callArgs: JsonRecord = {};
            if (rest[1]) {
              try { callArgs = JSON.parse(rest.slice(1).join(" ")) as JsonRecord; }
              catch { return { exitCode: 2, stderr: "call args must be JSON object\n" }; }
            }
            const result = await invokeTool(id, callArgs, { threadId: ctx.threadId ?? null, ...(ctx.signal ? { signal: ctx.signal } : {}) });
            return reply(result, JSON.stringify(result, null, 2));
          }
        }
      } catch (error) {
        return { exitCode: 1, stderr: errorText(error) + "\n" };
      }
      return { exitCode: 2, stderr: usage + "\n" };
    },
  });

  scheduleWarmup(WARMUP_ON_START_MS);
  void providerStatus("providerMcpStatus").then(({ hostId, issues }) => {
    for (const issue of issues) bb.log.warn(`[mcps] provider MCP guard on ${hostId}: ${issue.message}`);
  }, (error) => bb.log.info(`[mcps] provider MCP guard unavailable: ${errorText(error)}`));

  bb.onDispose(async () => {
    disposed = true;
    if (warmTimer) clearTimeout(warmTimer);
    await gateway.close().catch(() => {});
    oauthCredentialStore.dispose();
    bb.log.info("[mcps] disposed");
  });
}
