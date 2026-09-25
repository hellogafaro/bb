import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type {
  Prompt,
  Resource,
  ResourceTemplateType,
  Tool,
} from "@modelcontextprotocol/client";
import { expandPlaceholders, type StdioServerConfig } from "./config.js";
import type { JsonRecord } from "./types.js";

export interface McpServerDirs {
  root: string;
  data: string;
}

export interface McpStdioConfig {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface McpStdioCatalog {
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
}

export type CatalogChangeKind = "tools" | "prompts" | "resources";

export interface McpStdioHost {
  start(config: McpStdioConfig): Promise<McpStdioCatalog>;
  refresh(id: string): Promise<McpStdioCatalog>;
  close(id: string): Promise<void>;
  callTool(
    id: string,
    name: string,
    args: JsonRecord,
    toolDefinition: Tool | undefined,
  ): Promise<unknown>;
  getPrompt(
    id: string,
    name: string,
    args: Record<string, string>,
  ): Promise<unknown>;
  readResource(id: string, uri: string): Promise<unknown>;
}

export function isWithinRoot(resolvedPath: string, root: string): boolean {
  const rel = path.relative(root, resolvedPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function resolveCwd(
  cfg: StdioServerConfig,
  dirs: McpServerDirs,
): Promise<string> {
  const { root, data } = dirs;
  if (!cfg.cwd) return root;
  const original = cfg.cwd;
  const expanded = expandPlaceholders(original, root, data);
  let anchor = root;
  let resolved: string;
  const absoluteUserPath =
    path.isAbsolute(original) && !original.includes("${");
  if (original.startsWith("./"))
    resolved = path.resolve(root, expanded.slice(2));
  else if (
    original === "${PLUGIN_DATA}" ||
    original.startsWith("${PLUGIN_DATA}/")
  ) {
    anchor = data;
    resolved = path.resolve(expanded);
  } else resolved = path.resolve(expanded);
  if (!absoluteUserPath) {
    const anchorName = anchor === root ? "PLUGIN_ROOT" : "PLUGIN_DATA";
    if (!isWithinRoot(resolved, anchor))
      throw new Error(`cwd escapes ${anchorName}: ${original} -> ${resolved}`);
    const real = await fsp.realpath(resolved).catch(() => resolved);
    if (!isWithinRoot(real, anchor))
      throw new Error(`cwd realpath escapes: ${real}`);
  }
  return resolved;
}

export async function expandedStdioConfig(
  id: string,
  cfg: StdioServerConfig,
  dirs: McpServerDirs,
): Promise<McpStdioConfig> {
  const { root, data } = dirs;
  const args = (cfg.args ?? []).map((item) =>
    expandPlaceholders(item, root, data),
  );
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(cfg.env ?? {}))
    env[name] = expandPlaceholders(value, root, data);
  env.PLUGIN_ROOT = root;
  env.PLUGIN_DATA = data;
  const cwd = await resolveCwd(cfg, dirs);
  const executable = cfg.command.startsWith("./")
    ? path.resolve(root, cfg.command.slice(2))
    : cfg.command;
  if (cfg.command.startsWith("./") && !isWithinRoot(executable, root)) {
    throw new Error(
      `command escapes plugin root: ${cfg.command} -> ${executable}`,
    );
  }
  return { id, command: executable, args, cwd, env };
}
