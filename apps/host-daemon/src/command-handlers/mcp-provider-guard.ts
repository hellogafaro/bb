import { randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  McpProviderEntry,
  McpProviderStatus,
} from "@bb/host-daemon-contract";

export interface ProviderGuardPaths {
  claudeSettings: string;
  claudeJson: string;
  codexConfig: string;
}

export function providerGuardPaths(env: NodeJS.ProcessEnv): ProviderGuardPaths {
  const home = env.HOME || os.homedir();
  const claudeDir = env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  const codexHome = env.CODEX_HOME || path.join(home, ".codex");
  return {
    claudeSettings: path.join(claudeDir, "settings.json"),
    claudeJson: env.CLAUDE_CONFIG_DIR
      ? path.join(claudeDir, ".claude.json")
      : path.join(home, ".claude.json"),
    codexConfig: path.join(codexHome, "config.toml"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fsp.readFile(file, "utf8");
  } catch (error) {
    if (isMissingFile(error)) return null;
    throw error;
  }
}

async function readJsonObject(
  file: string,
): Promise<Record<string, unknown> | null> {
  const text = await readText(file);
  if (text === null || !text.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!isRecord(parsed)) throw new Error(`${file} must contain a JSON object`);
  return parsed;
}

function serverNames(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function tomlKey(raw: string): string {
  const trimmed = raw.trim();
  const quote = trimmed[0];
  if (
    trimmed.length >= 2 &&
    (quote === '"' || quote === "'") &&
    trimmed.endsWith(quote)
  )
    return trimmed.slice(1, -1);
  return trimmed;
}

const TOML_KEY = String.raw`("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)`;
const TABLE_HEADER = /^\[\[?\s*([^\]]+?)\s*\]\]?\s*(?:#.*)?$/;
const SERVER_TABLE = new RegExp(String.raw`^mcp_servers\s*\.\s*${TOML_KEY}`);
const SERVER_DOTTED_KEY = new RegExp(
  String.raw`^mcp_servers\s*\.\s*${TOML_KEY}\s*[.=]`,
);
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
      if (char === "\\" && quote === '"') i += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") quote = char;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    else if ((char === "," && depth === 0) || char === undefined) {
      const match = SERVER_KEY.exec(body.slice(segmentStart, i).trim());
      if (match?.[1] !== undefined) keys.push(tomlKey(match[1]));
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
    if (header?.[1] !== undefined) {
      table = header[1].trim();
      const server = SERVER_TABLE.exec(table);
      if (server?.[1] !== undefined) names.add(tomlKey(server[1]));
      continue;
    }
    if (table === "mcp_servers") {
      const key = SERVER_KEY.exec(line);
      if (key?.[1] !== undefined) names.add(tomlKey(key[1]));
    } else if (table === "") {
      const dotted = SERVER_DOTTED_KEY.exec(line);
      if (dotted?.[1] !== undefined) names.add(tomlKey(dotted[1]));
      const inline = INLINE_TABLE.exec(line);
      if (inline?.[1] !== undefined)
        for (const name of inlineTableKeys(inline[1])) names.add(name);
    }
  }
  return [...names].sort();
}

export async function readProviderMcpStatus(
  paths: ProviderGuardPaths,
  projectPath: string | null,
): Promise<McpProviderStatus> {
  const settings = await readJsonObject(paths.claudeSettings);
  const claudeJson = await readJsonObject(paths.claudeJson);
  const claudeEntries: McpProviderEntry[] = serverNames(
    claudeJson?.mcpServers,
  ).map((name) => ({ name, file: paths.claudeJson, scope: "user" }));
  if (isRecord(claudeJson?.projects)) {
    for (const [project, value] of Object.entries(claudeJson.projects)) {
      if (!isRecord(value)) continue;
      for (const name of serverNames(value.mcpServers)) {
        claudeEntries.push({
          name,
          file: paths.claudeJson,
          scope: `project ${project}`,
        });
      }
    }
  }
  if (projectPath !== null) {
    const mcpJsonPath = path.join(projectPath, ".mcp.json");
    const mcpJson = await readJsonObject(mcpJsonPath);
    for (const name of serverNames(mcpJson?.mcpServers))
      claudeEntries.push({ name, file: mcpJsonPath, scope: "project" });
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
      mcpServers: (codexToml ? codexMcpServerNames(codexToml) : []).map(
        (name) => ({ name, file: paths.codexConfig, scope: "user" }),
      ),
    },
  };
}

export async function disableClaudeConnectors(
  settingsPath: string,
): Promise<void> {
  const current = (await readJsonObject(settingsPath)) ?? {};
  if (current.disableClaudeAiConnectors === true) return;
  const next = { ...current, disableClaudeAiConnectors: true };
  await fsp.mkdir(path.dirname(settingsPath), { recursive: true });
  const mode = await fsp.stat(settingsPath).then(
    (stat) => stat.mode & 0o777,
    () => 0o600,
  );
  const temp = `${settingsPath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fsp.writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { mode });
    await fsp.rename(temp, settingsPath);
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function fixProviderMcpStatus(
  paths: ProviderGuardPaths,
  projectPath: string | null,
): Promise<McpProviderStatus> {
  await disableClaudeConnectors(paths.claudeSettings);
  return readProviderMcpStatus(paths, projectPath);
}
