import type {
  ProviderGuardFixResult,
  ProviderGuardMcpEntry,
  ProviderGuardStatus,
} from "@bb/host-daemon-contract";
import { getHost } from "@bb/db";
import type { ProviderGuardResponse } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { resolvePrimaryHostId } from "../hosts/primary-host.js";

const PROVIDER_GUARD_TIMEOUT_MS = 15_000;
const FIX_HINT = "bb provider guard --fix";

export interface ProviderGuardIssue {
  provider: "claude" | "codex";
  message: string;
  fixable: boolean;
}

function codexTable(name: string): string {
  return `[mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name)}]`;
}

function claudeLocation(entry: ProviderGuardMcpEntry): string {
  if (entry.scope === "user") return "the top-level mcpServers";
  if (entry.scope === "project") return "mcpServers in that file";
  return `projects[${JSON.stringify(entry.scope.slice("project ".length))}].mcpServers`;
}

function list(names: readonly string[]): string {
  return names.join(", ");
}

function enabledCodexFeatures(status: ProviderGuardStatus): string[] {
  return status.codex.features
    .filter((feature) => feature.value !== false)
    .map((feature) => feature.key);
}

function enabledCodexSystemSkills(status: ProviderGuardStatus): string[] {
  return status.codex.systemSkills
    .filter((skill) => !skill.disabled)
    .map((skill) => skill.name);
}

function claudeMarketplaceNames(status: ProviderGuardStatus): string[] {
  const { claude } = status;
  return claude.marketplaces.length === 0 && claude.knownMarketplacesFile
    ? ["known_marketplaces.json"]
    : claude.marketplaces;
}

export function providerGuardIssues(
  status: ProviderGuardStatus,
): ProviderGuardIssue[] {
  const { claude, codex } = status;
  const issues: ProviderGuardIssue[] = [];
  const claudeIssue = (message: string, fixable: boolean) =>
    issues.push({ provider: "claude", message, fixable });
  const codexIssue = (message: string, fixable: boolean) =>
    issues.push({ provider: "codex", message, fixable });
  if (!claude.connectorsDisabled)
    claudeIssue(
      `claude.ai connectors are enabled; set "disableClaudeAiConnectors": true in ${claude.settingsPath} (${FIX_HINT})`,
      true,
    );
  if (!claude.bundledSkillsDisabled)
    claudeIssue(
      `Claude Code bundled skills are enabled; set "disableBundledSkills": true in ${claude.settingsPath} (${FIX_HINT})`,
      true,
    );
  if (claude.enabledPlugins.length > 0)
    claudeIssue(
      `Claude Code plugins are enabled (${list(claude.enabledPlugins)}); set "enabledPlugins": {} in ${claude.settingsPath} (${FIX_HINT})`,
      true,
    );
  const marketplaces = claudeMarketplaceNames(status);
  if (marketplaces.length > 0)
    claudeIssue(
      claude.installedPlugins.length === 0
        ? `Claude Code plugin marketplaces are cloned in ${claude.pluginsDir} (${list(marketplaces)}); ${FIX_HINT} deletes them`
        : `Claude Code plugin marketplaces in ${claude.pluginsDir} (${list(marketplaces)}) are kept because installed_plugins.json lists ${list(claude.installedPlugins)}; uninstall those plugins by hand`,
      claude.installedPlugins.length === 0,
    );
  for (const entry of claude.mcpServers)
    claudeIssue(
      `Claude Code MCP server "${entry.name}" (${entry.scope}) in ${entry.file}; remove it from ${claudeLocation(entry)} by hand`,
      false,
    );
  if (claude.extraSkills.length > 0)
    claudeIssue(
      `Claude Code skills outside BB in ${claude.skillsDir} (${list(claude.extraSkills)}); remove them by hand if unwanted`,
      false,
    );
  const features = enabledCodexFeatures(status);
  if (features.length > 0)
    codexIssue(
      `Codex features are not disabled (${list(features)}); set them to false under [features] in ${codex.configPath} (${FIX_HINT})`,
      true,
    );
  const systemSkills = enabledCodexSystemSkills(status);
  if (systemSkills.length > 0)
    codexIssue(
      `Codex system skills are enabled (${list(systemSkills)}); add [[skills.config]] entries with enabled = false in ${codex.configPath} (${FIX_HINT})`,
      true,
    );
  if (codex.pluginCache.length > 0)
    codexIssue(
      `Codex plugin cache in ${codex.pluginCacheDir} (${list(codex.pluginCache)}); ${FIX_HINT} deletes it`,
      true,
    );
  for (const entry of codex.mcpServers)
    codexIssue(
      `Codex MCP server "${entry.name}" in ${entry.file}; delete its ${codexTable(entry.name)} table by hand`,
      false,
    );
  if (codex.extraSkills.length > 0)
    codexIssue(
      `Codex skills outside BB in ${codex.skillsDir} (${list(codex.extraSkills)}); remove them by hand if unwanted`,
      false,
    );
  return issues;
}

function state(ok: boolean, okText: string, badText: string): string {
  return ok ? okText : badText;
}

function mcpLines(
  items: readonly ProviderGuardMcpEntry[],
  hint: (entry: ProviderGuardMcpEntry) => string,
): string[] {
  return items.length === 0
    ? ["  MCP servers: none"]
    : [
        "  MCP servers:",
        ...items.map(
          (entry) =>
            `    ${entry.name} (${entry.scope}) in ${entry.file}\n      ${hint(entry)}`,
        ),
      ];
}

export function formatProviderGuard(result: {
  hostId: string;
  status: ProviderGuardStatus;
  issues: readonly ProviderGuardIssue[];
  changes: readonly string[];
}): string {
  const { claude, codex } = result.status;
  const marketplaces = claudeMarketplaceNames(result.status);
  const systemSkills = enabledCodexSystemSkills(result.status);
  const fixable = result.issues.filter((issue) => issue.fixable).length;
  return [
    `machine: ${result.hostId}`,
    ...result.changes,
    "Claude Code",
    `  claude.ai connectors: ${state(claude.connectorsDisabled, "disabled", "ENABLED")} (${claude.settingsPath})`,
    `  bundled skills: ${state(claude.bundledSkillsDisabled, "disabled", "ENABLED")}`,
    `  enabled plugins: ${claude.enabledPlugins.length === 0 ? "none" : list(claude.enabledPlugins)}`,
    `  plugin marketplaces: ${marketplaces.length === 0 ? "none" : `${list(marketplaces)} (${claude.pluginsDir})`}`,
    ...(claude.installedPlugins.length > 0
      ? [`  installed plugins: ${list(claude.installedPlugins)}`]
      : []),
    ...mcpLines(
      claude.mcpServers,
      (entry) =>
        `Remove "${entry.name}" from ${claudeLocation(entry)} by hand.`,
    ),
    `  skills outside BB: ${claude.extraSkills.length === 0 ? "none" : `${list(claude.extraSkills)} (${claude.skillsDir}, report only)`}`,
    "Codex",
    `  features: ${codex.features.map((feature) => `${feature.key}=${feature.value ?? "unset"}`).join(", ")} (${codex.configPath})`,
    `  system skills: ${
      codex.systemSkills.length === 0
        ? "none"
        : systemSkills.length === 0
          ? "all disabled"
          : `ENABLED ${list(systemSkills)}`
    }`,
    `  plugin cache: ${codex.pluginCache.length === 0 ? "empty" : `${list(codex.pluginCache)} (${codex.pluginCacheDir})`}`,
    ...mcpLines(
      codex.mcpServers,
      (entry) => `Delete the ${codexTable(entry.name)} table by hand.`,
    ),
    `  skills outside BB: ${codex.extraSkills.length === 0 ? "none" : `${list(codex.extraSkills)} (${codex.skillsDir}, report only)`}`,
    result.issues.length === 0
      ? "guard: ok"
      : `guard: ${result.issues.length} issue(s)${fixable > 0 ? `; run ${FIX_HINT} to apply ${fixable} fix(es)` : ""}`,
  ].join("\n");
}

export interface ProviderGuardClient {
  status(
    hostId: string,
    projectPath: string | null,
  ): Promise<ProviderGuardStatus>;
  fix(
    hostId: string,
    projectPath: string | null,
  ): Promise<ProviderGuardFixResult>;
}

export interface ProviderGuardServiceOptions {
  client: ProviderGuardClient;
  primaryHostId(): string | null;
  hostName(hostId: string): string;
  logger: { info(message: string): void; warn(message: string): void };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ProviderGuardService {
  constructor(private readonly options: ProviderGuardServiceOptions) {}

  async run(input: {
    hostId: string | null;
    projectPath: string | null;
    fix: boolean;
  }): Promise<ProviderGuardResponse> {
    const hostId = input.hostId ?? this.options.primaryHostId();
    if (!hostId) throw new Error("No host available for the provider guard");
    const { status, changes } = input.fix
      ? await this.options.client.fix(hostId, input.projectPath)
      : {
          status: await this.options.client.status(hostId, input.projectPath),
          changes: [],
        };
    const issues = providerGuardIssues(status);
    return {
      hostId,
      hostName: this.options.hostName(hostId),
      status,
      issues,
      changes,
      text: formatProviderGuard({ hostId, status, issues, changes }),
    };
  }

  start(): void {
    void this.run({ hostId: null, projectPath: null, fix: false }).then(
      ({ hostId, issues }) => {
        for (const issue of issues)
          this.options.logger.warn(
            `[providers] guard on ${hostId}: ${issue.message}`,
          );
      },
      (error: unknown) =>
        this.options.logger.info(
          `[providers] guard unavailable: ${errorText(error)}`,
        ),
    );
  }
}

export function createProviderGuardService(
  deps: AppDeps,
): ProviderGuardService {
  return new ProviderGuardService({
    primaryHostId: () => resolvePrimaryHostId(deps),
    hostName: (hostId) => getHost(deps.db, hostId)?.name ?? hostId,
    logger: deps.logger,
    client: {
      status: (hostId, projectPath) =>
        callHostOnlineRpc(deps, {
          hostId,
          timeoutMs: PROVIDER_GUARD_TIMEOUT_MS,
          command: { type: "providers.guardStatus", projectPath },
        }),
      fix: (hostId, projectPath) =>
        callHostOnlineRpc(deps, {
          hostId,
          timeoutMs: PROVIDER_GUARD_TIMEOUT_MS,
          command: { type: "providers.guardFix", projectPath },
        }),
    },
  });
}
