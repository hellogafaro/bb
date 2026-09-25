import { randomBytes } from "node:crypto";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ProviderGuardFixResult,
  ProviderGuardMcpEntry,
  ProviderGuardStatus,
} from "@bb/host-daemon-contract";

export const CODEX_DISABLED_FEATURES = [
  "remote_plugin",
  "plugins",
  "apps",
  "skill_mcp_dependency_install",
] as const;

const BB_SKILL_NAME = "bb-cli";

export interface ProviderGuardPaths {
  claudeSettings: string;
  claudeJson: string;
  claudePluginsDir: string;
  claudeSkillsDir: string;
  codexHome: string;
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
    claudePluginsDir: path.join(claudeDir, "plugins"),
    claudeSkillsDir: path.join(claudeDir, "skills"),
    codexHome,
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

async function pathExists(file: string): Promise<boolean> {
  try {
    await fsp.lstat(file);
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function listEntries(
  dir: string,
  include: "all" | "folders",
): Promise<string[]> {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) return [];
    throw error;
  }
  return entries
    .filter(
      (entry) =>
        !entry.name.startsWith(".") &&
        (include === "all" || entry.isDirectory() || entry.isSymbolicLink()),
    )
    .map((entry) => entry.name)
    .sort();
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

async function writeFileAtomic(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const mode = await fsp.stat(file).then(
    (stat) => stat.mode & 0o777,
    () => 0o600,
  );
  const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await fsp.writeFile(temp, text, { mode });
    await fsp.rename(temp, file);
  } catch (error) {
    await fsp.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
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

interface TomlSection {
  name: string;
  array: boolean;
  start: number;
  end: number;
}

function tomlSections(lines: readonly string[]): TomlSection[] {
  const sections: TomlSection[] = [
    { name: "", array: false, start: -1, end: lines.length },
  ];
  lines.forEach((raw, index) => {
    const line = raw.trim();
    const header = TABLE_HEADER.exec(line);
    if (header?.[1] === undefined) return;
    const previous = sections.at(-1);
    if (previous) previous.end = index;
    sections.push({
      name: header[1]
        .split(".")
        .map((part) => part.trim())
        .join("."),
      array: line.startsWith("[["),
      start: index,
      end: lines.length,
    });
  });
  return sections;
}

function sectionLines(section: TomlSection): number[] {
  const indexes: number[] = [];
  for (let index = section.start + 1; index < section.end; index += 1)
    indexes.push(index);
  return indexes;
}

function lastContentLine(
  lines: readonly string[],
  section: TomlSection,
): number {
  let last = section.start;
  for (const index of sectionLines(section))
    if (lines[index]?.trim()) last = index;
  return last;
}

function tomlString(raw: string): string | null {
  const value = raw.trim();
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return end > 0 ? value.slice(1, end) : null;
  }
  if (!value.startsWith('"')) return null;
  const match = /^"(?:[^"\\]|\\.)*"/.exec(value);
  if (!match) return null;
  try {
    const parsed: unknown = JSON.parse(match[0]);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function booleanValue(raw: string): boolean | null {
  const match = /^\s*(true|false)\s*(?:#.*)?$/.exec(raw);
  return match ? match[1] === "true" : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assignment(line: string, key: string): string | null {
  const match = new RegExp(`^\\s*${escapeRegExp(key)}\\s*=(.*)$`).exec(line);
  return match?.[1] ?? null;
}

export function codexFeatureValues(toml: string): Map<string, boolean> {
  const lines = toml.split(/\r?\n/);
  const values = new Map<string, boolean>();
  for (const section of tomlSections(lines)) {
    if (section.array) continue;
    if (section.name !== "features" && section.name !== "") continue;
    const prefix = section.name === "" ? String.raw`features\s*\.\s*` : "";
    const pattern = new RegExp(`^\\s*${prefix}([A-Za-z0-9_-]+)\\s*=(.*)$`);
    for (const index of sectionLines(section)) {
      const match = pattern.exec(lines[index] ?? "");
      if (match?.[1] === undefined || match[2] === undefined) continue;
      const value = booleanValue(match[2]);
      if (value !== null) values.set(match[1], value);
    }
  }
  return values;
}

interface CodexSkillConfigEntry {
  path: string | null;
  enabled: boolean | null;
  pathLine: number | null;
  enabledLine: number | null;
}

function skillConfigEntries(lines: readonly string[]): CodexSkillConfigEntry[] {
  return tomlSections(lines)
    .filter((section) => section.array && section.name === "skills.config")
    .map((section) => {
      const entry: CodexSkillConfigEntry = {
        path: null,
        enabled: null,
        pathLine: null,
        enabledLine: null,
      };
      for (const index of sectionLines(section)) {
        const line = lines[index] ?? "";
        const pathValue = assignment(line, "path");
        if (pathValue !== null) {
          entry.path = tomlString(pathValue);
          entry.pathLine = index;
        }
        const enabledValue = assignment(line, "enabled");
        if (enabledValue !== null) {
          entry.enabled = booleanValue(enabledValue);
          entry.enabledLine = index;
        }
      }
      return entry;
    });
}

export function codexDisabledSkillPaths(toml: string): Set<string> {
  return new Set(
    skillConfigEntries(toml.split(/\r?\n/))
      .filter((entry) => entry.enabled === false && entry.path !== null)
      .map((entry) => entry.path ?? ""),
  );
}

function assertEditableCodexConfig(lines: readonly string[]): void {
  for (const section of tomlSections(lines)) {
    for (const index of sectionLines(section)) {
      const line = lines[index] ?? "";
      if (
        section.name === "" &&
        (assignment(line, "features") !== null ||
          assignment(line, "skills") !== null ||
          /^\s*skills\s*\.\s*config\s*=/.test(line))
      )
        throw new Error(
          "Codex config.toml declares features or skills inline; edit it by hand",
        );
      if (
        !section.array &&
        section.name === "skills" &&
        assignment(line, "config") !== null
      )
        throw new Error(
          "Codex config.toml declares skills.config inline; edit it by hand",
        );
    }
  }
}

function appendBlock(lines: string[], block: readonly string[]): void {
  const last = lines.at(-1);
  if (last !== undefined && last.trim() !== "") lines.push("");
  lines.push(...block);
}

function disableCodexFeature(lines: string[], key: string): boolean {
  const sections = tomlSections(lines);
  const table = sections.find(
    (section) => !section.array && section.name === "features",
  );
  const root = sections[0];
  const dottedLines =
    root === undefined
      ? []
      : sectionLines(root).filter((index) =>
          /^\s*features\s*\.\s*[A-Za-z0-9_-]+\s*=/.test(lines[index] ?? ""),
        );
  const [target, lineKey] =
    table !== undefined || dottedLines.length === 0
      ? [table, key]
      : [root, `features.${key}`];
  if (target === undefined) {
    appendBlock(lines, ["[features]", `${key} = false`]);
    return true;
  }
  const candidates = target === table ? sectionLines(target) : dottedLines;
  const pattern = new RegExp(
    `^\\s*${escapeRegExp(lineKey).replace("\\.", String.raw`\s*\.\s*`)}\\s*=(.*)$`,
  );
  for (const index of candidates) {
    const match = pattern.exec(lines[index] ?? "");
    if (match?.[1] === undefined) continue;
    if (booleanValue(match[1]) === false) return false;
    lines[index] = `${lineKey} = false`;
    return true;
  }
  const insertAt =
    target === table
      ? lastContentLine(lines, target) + 1
      : (dottedLines.at(-1) ?? -1) + 1;
  lines.splice(insertAt, 0, `${lineKey} = false`);
  return true;
}

function disableCodexSkill(lines: string[], skillPath: string): boolean {
  const entry = skillConfigEntries(lines).find(
    (candidate) => candidate.path === skillPath,
  );
  if (entry === undefined) {
    appendBlock(lines, [
      "[[skills.config]]",
      `path = ${JSON.stringify(skillPath)}`,
      "enabled = false",
    ]);
    return true;
  }
  if (entry.enabled === false) return false;
  if (entry.enabledLine !== null) {
    lines[entry.enabledLine] = "enabled = false";
  } else {
    lines.splice((entry.pathLine ?? 0) + 1, 0, "enabled = false");
  }
  return true;
}

export interface CodexConfigEdit {
  text: string;
  features: string[];
  skills: string[];
}

export function applyCodexGuardConfig(
  toml: string,
  systemSkillPaths: readonly string[],
): CodexConfigEdit {
  const hadTrailingNewline = toml.endsWith("\n");
  const lines = toml === "" ? [] : toml.split("\n");
  if (hadTrailingNewline) lines.pop();
  assertEditableCodexConfig(lines);
  const features = CODEX_DISABLED_FEATURES.filter((key) =>
    disableCodexFeature(lines, key),
  );
  const skills = systemSkillPaths.filter((skillPath) =>
    disableCodexSkill(lines, skillPath),
  );
  if (features.length === 0 && skills.length === 0)
    return { text: toml, features, skills };
  return { text: `${lines.join("\n")}\n`, features, skills };
}

async function readClaudeMcpServers(
  paths: ProviderGuardPaths,
  projectPath: string | null,
): Promise<ProviderGuardMcpEntry[]> {
  const claudeJson = await readJsonObject(paths.claudeJson);
  const entries: ProviderGuardMcpEntry[] = serverNames(
    claudeJson?.mcpServers,
  ).map((name) => ({ name, file: paths.claudeJson, scope: "user" }));
  if (isRecord(claudeJson?.projects)) {
    for (const [project, value] of Object.entries(claudeJson.projects)) {
      if (!isRecord(value)) continue;
      for (const name of serverNames(value.mcpServers)) {
        entries.push({
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
      entries.push({ name, file: mcpJsonPath, scope: "project" });
  }
  return entries;
}

function claudeInstalledPlugins(value: Record<string, unknown> | null) {
  if (value === null) return [];
  if (isRecord(value.plugins)) return Object.keys(value.plugins).sort();
  if (Array.isArray(value.plugins))
    return value.plugins.map((plugin) => String(plugin)).sort();
  return [];
}

function enabledPluginNames(value: unknown): string[] {
  if (!isRecord(value)) return [];
  return Object.entries(value)
    .filter(([, enabled]) => enabled !== false)
    .map(([name]) => name)
    .sort();
}

function codexSystemSkillsDir(paths: ProviderGuardPaths): string {
  return path.join(paths.codexHome, "skills", ".system");
}

async function codexSystemSkillPaths(
  paths: ProviderGuardPaths,
): Promise<{ name: string; path: string }[]> {
  const dir = codexSystemSkillsDir(paths);
  return (await listEntries(dir, "folders")).map((name) => ({
    name,
    path: path.join(dir, name, "SKILL.md"),
  }));
}

export async function readProviderGuardStatus(
  paths: ProviderGuardPaths,
  projectPath: string | null,
): Promise<ProviderGuardStatus> {
  const settings = await readJsonObject(paths.claudeSettings);
  const knownMarketplacesFile = path.join(
    paths.claudePluginsDir,
    "known_marketplaces.json",
  );
  const codexToml = (await readText(paths.codexConfig)) ?? "";
  const features = codexFeatureValues(codexToml);
  const disabledSkills = codexDisabledSkillPaths(codexToml);
  const pluginCacheDir = path.join(paths.codexHome, "plugins", "cache");
  const codexSkillsDir = path.join(paths.codexHome, "skills");
  return {
    claude: {
      settingsPath: paths.claudeSettings,
      connectorsDisabled: settings?.disableClaudeAiConnectors === true,
      bundledSkillsDisabled: settings?.disableBundledSkills === true,
      skillSyncDisabled: settings?.syncClaudeAiSkills === false,
      enabledPlugins: enabledPluginNames(settings?.enabledPlugins),
      mcpServers: await readClaudeMcpServers(paths, projectPath),
      pluginsDir: paths.claudePluginsDir,
      marketplaces: await listEntries(
        path.join(paths.claudePluginsDir, "marketplaces"),
        "all",
      ),
      knownMarketplacesFile: (await pathExists(knownMarketplacesFile))
        ? knownMarketplacesFile
        : null,
      installedPlugins: claudeInstalledPlugins(
        await readJsonObject(
          path.join(paths.claudePluginsDir, "installed_plugins.json"),
        ),
      ),
      skillsDir: paths.claudeSkillsDir,
      extraSkills: (await listEntries(paths.claudeSkillsDir, "folders")).filter(
        (name) => name !== BB_SKILL_NAME,
      ),
    },
    codex: {
      configPath: paths.codexConfig,
      features: CODEX_DISABLED_FEATURES.map((key) => ({
        key,
        value: features.get(key) ?? null,
      })),
      systemSkills: (await codexSystemSkillPaths(paths)).map((skill) => ({
        ...skill,
        disabled: disabledSkills.has(skill.path),
      })),
      mcpServers: codexMcpServerNames(codexToml).map((name) => ({
        name,
        file: paths.codexConfig,
        scope: "user",
      })),
      pluginCacheDir,
      pluginCache: await listEntries(pluginCacheDir, "all"),
      skillsDir: codexSkillsDir,
      extraSkills: (await listEntries(codexSkillsDir, "folders")).filter(
        (name) => name !== BB_SKILL_NAME,
      ),
    },
  };
}

export async function mergeClaudeGuardSettings(
  settingsPath: string,
): Promise<string[]> {
  const current = (await readJsonObject(settingsPath)) ?? {};
  const changes: string[] = [];
  const next: Record<string, unknown> = { ...current };
  if (next.disableClaudeAiConnectors !== true) {
    next.disableClaudeAiConnectors = true;
    changes.push(`Set "disableClaudeAiConnectors": true in ${settingsPath}`);
  }
  if (next.disableBundledSkills !== true) {
    next.disableBundledSkills = true;
    changes.push(`Set "disableBundledSkills": true in ${settingsPath}`);
  }
  if (next.syncClaudeAiSkills !== false) {
    next.syncClaudeAiSkills = false;
    changes.push(`Set "syncClaudeAiSkills": false in ${settingsPath}`);
  }
  if (
    !isRecord(next.enabledPlugins) ||
    Object.keys(next.enabledPlugins).length > 0
  ) {
    next.enabledPlugins = {};
    changes.push(`Set "enabledPlugins": {} in ${settingsPath}`);
  }
  if (changes.length > 0)
    await writeFileAtomic(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
  return changes;
}

async function removeClaudeMarketplaces(
  status: ProviderGuardStatus["claude"],
): Promise<string[]> {
  if (status.installedPlugins.length > 0) return [];
  const changes: string[] = [];
  for (const name of status.marketplaces) {
    const target = path.join(status.pluginsDir, "marketplaces", name);
    await fsp.rm(target, { recursive: true, force: true });
    changes.push(`Deleted ${target}`);
  }
  if (status.knownMarketplacesFile !== null) {
    await fsp.rm(status.knownMarketplacesFile, { force: true });
    changes.push(`Deleted ${status.knownMarketplacesFile}`);
  }
  return changes;
}

async function fixCodexConfig(paths: ProviderGuardPaths): Promise<string[]> {
  const current = (await readText(paths.codexConfig)) ?? "";
  const edit = applyCodexGuardConfig(
    current,
    (await codexSystemSkillPaths(paths)).map((skill) => skill.path),
  );
  if (edit.text === current) return [];
  await writeFileAtomic(paths.codexConfig, edit.text);
  return [
    ...edit.features.map(
      (key) => `Set features.${key} = false in ${paths.codexConfig}`,
    ),
    ...edit.skills.map(
      (skillPath) =>
        `Disabled Codex system skill ${skillPath} in ${paths.codexConfig}`,
    ),
  ];
}

export async function fixProviderGuard(
  paths: ProviderGuardPaths,
  projectPath: string | null,
): Promise<ProviderGuardFixResult> {
  const before = await readProviderGuardStatus(paths, projectPath);
  const changes = [
    ...(await mergeClaudeGuardSettings(paths.claudeSettings)),
    ...(await removeClaudeMarketplaces(before.claude)),
    ...(await fixCodexConfig(paths)),
  ];
  if (before.codex.pluginCache.length > 0) {
    await fsp.rm(before.codex.pluginCacheDir, { recursive: true, force: true });
    changes.push(`Deleted ${before.codex.pluginCacheDir}`);
  }
  return {
    status: await readProviderGuardStatus(paths, projectPath),
    changes,
  };
}
