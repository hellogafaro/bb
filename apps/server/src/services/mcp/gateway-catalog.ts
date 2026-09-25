import * as crypto from "node:crypto";
import type {
  Prompt,
  Resource,
  ResourceTemplateType,
  Tool,
} from "@modelcontextprotocol/client";
import { parameterNames } from "./call-card.js";
import {
  compactToolFromCatalog,
  scoreTokens,
  tokenize,
  SEARCH_MAX,
} from "./catalog.js";
import type {
  CatalogTool,
  CompactTool,
  JsonRecord,
  McpServerRecord,
} from "./types.js";

export type RefKind = "tool" | "prompt" | "resource" | "resource-template";

export const ID_PREFIX: Record<RefKind, string> = {
  tool: "mcpt",
  prompt: "mcpp",
  resource: "mcpr",
  "resource-template": "mcprt",
};
export const ID_SOURCE: Record<RefKind, string> = {
  tool: "mcp_search",
  prompt: "mcp_prompts",
  resource: "mcp_resources",
  "resource-template": "mcp_resources",
};

export function exposedId(
  kind: RefKind,
  sourceId: string,
  name: string,
): string {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify([kind, sourceId, name]))
    .digest("hex");
  return `${ID_PREFIX[kind]}_${BigInt(`0x${hash}`).toString(36).slice(0, 10)}`;
}

export interface CatalogLists {
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
}

export interface CatalogCache extends CatalogLists {
  toolSearchText: Map<string, string>;
  updatedAt: number;
  error: string | null;
}

export interface CatalogRef {
  kind: RefKind;
  sourceId: string;
  name: string;
}

export function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : undefined;
}

export function toolSchema(value: unknown): JsonRecord {
  return (
    asRecord(value) ?? {
      type: "object",
      properties: {},
      additionalProperties: true,
    }
  );
}

export function buildCatalogCache(
  lists: CatalogLists,
  error: string | null,
): CatalogCache {
  const toolSearchText = new Map<string, string>();
  for (const tool of lists.tools) {
    toolSearchText.set(
      tool.name,
      [
        tool.name,
        tool.description ?? "",
        ...parameterNames(toolSchema(tool.inputSchema)),
      ]
        .join("\n")
        .toLowerCase(),
    );
  }
  return {
    tools: lists.tools,
    prompts: lists.prompts,
    resources: lists.resources,
    resourceTemplates: lists.resourceTemplates,
    toolSearchText,
    updatedAt: Date.now(),
    error,
  };
}

export function catalogNames(kind: RefKind, catalog: CatalogLists): string[] {
  switch (kind) {
    case "tool":
      return catalog.tools.map((item) => item.name);
    case "prompt":
      return catalog.prompts.map((item) => item.name);
    case "resource":
      return catalog.resources.map((item) => item.uri);
    case "resource-template":
      return catalog.resourceTemplates.map((item) => item.uriTemplate);
  }
}

export class CatalogIndex {
  private readonly refs = new Map<string, CatalogRef>();
  private readonly byServer = new Map<string, Set<string>>();

  get(id: string): CatalogRef | undefined {
    return this.refs.get(id);
  }

  drop(sourceId: string): void {
    for (const refId of this.byServer.get(sourceId) ?? [])
      this.refs.delete(refId);
    this.byServer.delete(sourceId);
  }

  clear(): void {
    this.refs.clear();
    this.byServer.clear();
  }

  index(sourceId: string, catalog: CatalogLists): void {
    this.drop(sourceId);
    const refIds = new Set<string>();
    this.byServer.set(sourceId, refIds);
    for (const kind of [
      "tool",
      "prompt",
      "resource",
      "resource-template",
    ] as const) {
      for (const name of catalogNames(kind, catalog)) {
        const refId = exposedId(kind, sourceId, name);
        refIds.add(refId);
        this.refs.set(refId, { kind, sourceId, name });
      }
    }
  }
}

export function catalogTool(record: McpServerRecord, tool: Tool): CatalogTool {
  const annotations = asRecord(tool.annotations);
  return {
    id: exposedId("tool", record.id, tool.name),
    sourceId: record.id,
    handle: record.handle,
    name: tool.name,
    description:
      tool.description?.trim() || `Call ${tool.name} on ${record.handle}`,
    inputSchema: toolSchema(tool.inputSchema),
    ...(annotations ? { annotations } : {}),
  };
}

export interface SearchCandidate {
  record: McpServerRecord;
  catalog: CatalogCache;
}

export function rankTools(
  query: string,
  candidates: SearchCandidate[],
  exactRef: CatalogRef | undefined,
  limit: number,
): CompactTool[] {
  const tokens = tokenize(query);
  const normalizedQuery = query.toLowerCase();
  const ranked: Array<{ score: number; tool: Tool; record: McpServerRecord }> =
    [];
  for (const { record, catalog } of candidates) {
    const serverText = `${record.name.toLowerCase()}\n${record.handle}`;
    for (const tool of catalog.tools) {
      const exact =
        tool.name.toLowerCase() === normalizedQuery ||
        (exactRef?.kind === "tool" &&
          exactRef.sourceId === record.id &&
          exactRef.name === tool.name);
      let score = scoreTokens(
        tokens,
        tool.name.toLowerCase(),
        `${serverText}\n${catalog.toolSearchText.get(tool.name) ?? tool.name}`,
      );
      if (exact) score += 50;
      if (score <= 0) continue;
      ranked.push({ score, tool, record });
    }
  }
  ranked.sort(
    (a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name),
  );
  const cap = Math.min(Math.max(1, limit), SEARCH_MAX);
  return ranked
    .slice(0, cap)
    .map((hit) =>
      compactToolFromCatalog(catalogTool(hit.record, hit.tool), { card: true }),
    );
}
