import { randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export interface ProviderMcpEntry {
  name: string;
  file: string;
  scope: string;
}

export interface ProviderMcpStatus {
  claude: {
    settingsPath: string;
    connectorsDisabled: boolean;
    mcpServers: ProviderMcpEntry[];
  };
  codex: {
    configPath: string;
    mcpServers: ProviderMcpEntry[];
  };
}

export interface ProviderGuardPaths {
  claudeSettings: string;
  claudeJson: string;
  codexConfig: string;
}

export function providerGuardPaths(env: NodeJS.ProcessEnv = process.env): ProviderGuardPaths {
  const home = env.HOME || os.homedir();
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const codexHome = env.CODEX_HOME || path.join(home, ".codex");
  return {
    claudeSettings: path.join(claudeDir, "settings.json"),
    claudeJson: env.CLAUDE_CONFIG_DIR ? path.join(claudeDir, ".claude.json") : path.join(home, ".claude.json"),
    codexConfig: path.join(codexHome, "config.toml"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readText(file: string): Promise<string | null> {
  try { return await fsp.readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  const text = await readText(file);
  if (text === null || !text.trim()) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch (error) { throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`); }
  if (!isRecord(parsed)) throw new Error(`${file} must contain a JSON object`);
  return parsed;
}

function serverNames(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function tomlKey(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && (trimmed.startsWith("\"") || trimmed.startsWith("'")) && trimmed.endsWith(trimmed[0]!)) return trimmed.slice(1, -1);
  return trimmed;
}

const TOML_KEY = String.raw`("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)`;
const TABLE_HEADER = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/;
const SERVER_TABLE = new RegExp(String.raw`^mcp_servers\s*\.\s*${TOML_KEY}`);
const SERVER_DOTTED_KEY = new RegExp(String.raw`^mcp_servers\s*\.\s*${TOML_KEY}\s*[.=]`);
const SERVER_KEY = new RegExp(String.raw`^${TOML_KEY}\s*[.=]`);
const INLINE_TABLE = /^mcp_servers\s*=\s*\{(.*)\}\s*(?:#.*)?$/;

function inlineTableKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let segmentStart = 0;
  for (let i = 0; i <= body.length; i += 1) {
    const char = body[i];
    if (quote) {
      if (char === "\\" && quote === "\"") i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") quote = char;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    else if ((char === "," && depth === 0) || char === undefined) {
      const match = SERVER_KEY.exec(body.slice(segmentStart, i).trim());
      if (match) keys.push(tomlKey(match[1]!));
      segmentStart = i + 1;
    }
  }
  return keys;
}

export function codexMcpServerNames(toml: string): string[] {
  const names = new Set<string>();
  let table = "";
  for (const raw of toml.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const header = TABLE_HEADER.exec(line);
    if (header) {
      table = header[1]!.trim();
      const server = SERVER_TABLE.exec(table);
      if (server) names.add(tomlKey(server[1]!));
      continue;
    }
    if (table === "mcp_servers") {
      const key = SERVER_KEY.exec(line);
      if (key) names.add(tomlKey(key[1]!));
    } else if (table === "") {
      const dotted = SERVER_DOTTED_KEY.exec(line);
      if (dotted) names.add(tomlKey(dotted[1]!));
      const inline = INLINE_TABLE.exec(line);
      if (inline) for (const name of inlineTableKeys(inline[1]!)) names.add(name);
    }
  }
  return [...names].sort();
}

export async function readProviderMcpStatus(options: { paths?: ProviderGuardPaths; projectPath?: string } = {}): Promise<ProviderMcpStatus> {
  const paths = options.paths ?? providerGuardPaths();
  const settings = await readJsonObject(paths.claudeSettings);
  const claudeJson = await readJsonObject(paths.claudeJson);
  const claudeEntries: ProviderMcpEntry[] = serverNames(claudeJson?.mcpServers)
    .map((name) => ({ name, file: paths.claudeJson, scope: "user" }));
  if (isRecord(claudeJson?.projects)) {
    for (const [project, value] of Object.entries(claudeJson.projects)) {
      if (!isRecord(value)) continue;
      for (const name of serverNames(value.mcpServers)) claudeEntries.push({ name, file: paths.claudeJson, scope: `project ${project}` });
    }
  }
  if (options.projectPath) {
    const mcpJsonPath = path.join(options.projectPath, ".mcp.json");
    const mcpJson = await readJsonObject(mcpJsonPath);
    for (const name of serverNames(mcpJson?.mcpServers)) claudeEntries.push({ name, file: mcpJsonPath, scope: "project" });
  }
  const codexToml = await readText(paths.codexConfig);
  return {
    claude: {
      settingsPath: paths.claudeSettings,
      connectorsDisabled: settings?.disableClaudeAiConnectors === true,
      mcpServers: claudeEntries,
    },
    codex: {
      configPath: paths.codexConfig,
      mcpServers: (codexToml ? codexMcpServerNames(codexToml) : []).map((name) => ({ name, file: paths.codexConfig, scope: "user" })),
    },
  };
}

export async function disableClaudeConnectors(settingsPath: string): Promise<void> {
  const current = await readJsonObject(settingsPath) ?? {};
  if (current.disableClaudeAiConnectors === true) return;
  const next = { ...current, disableClaudeAiConnectors: true };
  await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
  const mode = await fsp.stat(settingsPath).then((stat) => stat.mode & 0o777, () => 0o600);
  const temp = `${settingsPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fsp.writeFile(temp, JSON.stringify(next, null, 2) + "\n", { mode });
    await fsp.rename(temp, settingsPath);
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

function codexTable(name: string): string {
  return `[mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name)}]`;
}

function claudeLocation(entry: ProviderMcpEntry): string {
  if (entry.scope === "user") return "the top-level mcpServers";
  if (entry.scope === "project") return "mcpServers in that file";
  return `projects[${JSON.stringify(entry.scope.slice("project ".length))}].mcpServers`;
}

export interface ProviderGuardIssue {
  provider: "claude" | "codex";
  message: string;
}

export function providerGuardIssues(status: ProviderMcpStatus): ProviderGuardIssue[] {
  const issues: ProviderGuardIssue[] = [];
  if (!status.claude.connectorsDisabled) {
    issues.push({ provider: "claude", message: `claude.ai connectors are enabled; set "disableClaudeAiConnectors": true in ${status.claude.settingsPath} (bb mcp providers --fix)` });
  }
  for (const entry of status.claude.mcpServers) {
    issues.push({ provider: "claude", message: `Claude Code MCP server "${entry.name}" (${entry.scope}) in ${entry.file}; remove it from ${claudeLocation(entry)} by hand` });
  }
  for (const entry of status.codex.mcpServers) {
    issues.push({ provider: "codex", message: `Codex MCP server "${entry.name}" in ${entry.file}; delete its ${codexTable(entry.name)} table by hand` });
  }
  return issues;
}

export function formatProviderStatus(result: { hostId: string; status: ProviderMcpStatus; issues: ProviderGuardIssue[] }, fixed: boolean): string {
  const { claude, codex } = result.status;
  const entries = (items: ProviderMcpEntry[], hint: (entry: ProviderMcpEntry) => string) => items.length === 0
    ? ["  MCP servers: none"]
    : ["  MCP servers:", ...items.map((entry) => `    ${entry.name} (${entry.scope}) in ${entry.file}\n      ${hint(entry)}`)];
  return [
    `machine: ${result.hostId}`,
    ...(fixed ? [`Set "disableClaudeAiConnectors": true in ${claude.settingsPath}`] : []),
    "Claude Code",
    `  claude.ai connectors: ${claude.connectorsDisabled ? "disabled" : "ENABLED"} (${claude.settingsPath})`,
    ...entries(claude.mcpServers, (entry) => `Remove "${entry.name}" from ${claudeLocation(entry)} by hand.`),
    "Codex",
    ...entries(codex.mcpServers, (entry) => `Delete the ${codexTable(entry.name)} table by hand.`),
    result.issues.length === 0 ? "guard: ok" : `guard: ${result.issues.length} issue(s)${claude.connectorsDisabled ? "" : "; run bb mcp providers --fix to disable claude.ai connectors"}`,
  ].join("\n");
}
