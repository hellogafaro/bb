import type {
  McpAuthStatusValue,
  McpRegistryHit,
  McpServer,
  McpServerConfigView,
  McpServerSummary,
  McpToolRow,
} from "@bb/server-contract";
import { parseStoredServerConfig } from "./config.js";
import { effectivePolicy, type PolicyMode } from "./policy.js";
import {
  normalizeRegistryServer,
  type RegistryServerSummary,
} from "./registry.js";
import type { CompactTool, McpServerRecord } from "./types.js";

export interface CatalogCounts {
  tools: number;
  prompts: number;
  resources: number;
}

const REDACTED = "***";

function redactValues(
  values: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(values ?? {}).map((key) => [key, REDACTED]),
  );
}

export function redactedConfig(record: McpServerRecord): McpServerConfigView {
  const cfg = parseStoredServerConfig(record.handle, record.configJson);
  if (cfg.type === "stdio") {
    return {
      type: "stdio",
      command: cfg.command,
      args: cfg.args ?? [],
      env: redactValues(cfg.env),
      cwd: cfg.cwd ?? null,
    };
  }
  return { type: cfg.type, url: cfg.url, headers: redactValues(cfg.headers) };
}

export function serverView(
  record: McpServerRecord,
  authStatus: McpAuthStatusValue,
  counts: CatalogCounts | null,
): McpServer {
  return {
    id: record.id,
    handle: record.handle,
    name: record.name,
    description: record.description,
    type: record.type,
    status: record.status,
    sourceKind: record.sourceKind,
    enabled: record.enabled,
    authStatus,
    lastError: record.lastError,
    sourceRef: record.sourceRef,
    registryName: record.registryName,
    registryVersion: record.registryVersion,
    config: redactedConfig(record),
    toolCount: counts?.tools ?? null,
    promptCount: counts?.prompts ?? null,
    resourceCount: counts?.resources ?? null,
    guide: record.guide,
  };
}

export function serverSummary(
  record: McpServerRecord,
  counts: CatalogCounts | null,
): McpServerSummary {
  return {
    id: record.id,
    handle: record.handle,
    type: record.type,
    status: record.status,
    ...(counts ? { tools: counts.tools } : {}),
  };
}

export function toolRow(tool: CompactTool, mode: PolicyMode): McpToolRow {
  const policy = effectivePolicy(mode, tool.risk);
  const needsSchema =
    tool.schemaRequired ||
    tool.card === undefined ||
    tool.card.truncated ||
    tool.card.shape.includes("…") ||
    (tool.card.fields.length === 0 && tool.card.shape !== "{}");
  return {
    id: tool.id,
    server: tool.handle,
    name: tool.name,
    description: tool.description,
    ...(tool.risk !== "read" ? { risk: tool.risk } : {}),
    ...(policy !== "allow" ? { policy } : {}),
    ...(tool.card
      ? {
          input: Object.fromEntries(
            tool.card.fields.map((field) => [
              field.name + (field.required ? "" : "?"),
              field.type,
            ]),
          ),
        }
      : {}),
    ...(needsSchema ? { schemaRequired: true } : {}),
  };
}

export function registryHit(summary: RegistryServerSummary): McpRegistryHit {
  const install = normalizeRegistryServer(summary);
  const remote = summary.remotes.find(
    (item) =>
      item.type === "streamable-http" ||
      item.type === "sse" ||
      item.url.startsWith("http"),
  );
  return {
    name: summary.name,
    description: summary.description,
    version: summary.version,
    status: summary.status,
    installable: install !== null,
    sourceRef: install?.sourceRef ?? null,
    type: install?.type ?? null,
    remote: Boolean(remote),
    requiredHeaders: (remote?.headers ?? [])
      .filter((header) => header.isRequired)
      .map((header) => header.name),
  };
}
