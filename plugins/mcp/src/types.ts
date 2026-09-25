export type JsonRecord = Record<string, unknown>;

export type McpServerType = "stdio" | "streamable-http" | "sse";
export type McpSourceKind = "manual" | "registry";
export type ToolRisk = "read" | "write" | "destructive";

export type McpServerStatus = "idle" | "ready" | "error" | "disabled" | "needs-auth";

export interface McpSource {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  type: McpServerType;
  configJson: string;
  status: McpServerStatus;
  lastError: string | null;
  enabled: boolean;
  guide: string | null;
  sourceKind: McpSourceKind;
  sourceRef: string | null;
  registryName: string | null;
  registryVersion: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CatalogTool {
  id: string;
  sourceId: string;
  handle: string;
  name: string;
  description: string;
  inputSchema: JsonRecord;
  annotations?: JsonRecord;
}

export interface CatalogPrompt {
  id: string;
  sourceId: string;
  handle: string;
  name: string;
  description?: string;
}

export interface CatalogResource {
  id: string;
  sourceId: string;
  handle: string;
  uri: string;
  name: string;
}

export interface CatalogResourceTemplate {
  id: string;
  sourceId: string;
  handle: string;
  uriTemplate: string;
  name: string;
}

export interface McpCallResult {
  content: JsonRecord[];
  isError?: boolean;
  structuredContent?: unknown;
  _meta?: JsonRecord;
}

export interface CompactTool {
  schemaRequired?: boolean;
  id: string;
  sourceId: string;
  handle: string;
  name: string;
  description: string;
  risk: ToolRisk;
  card?: {
    truncated?: boolean;
    shape: string;
    fields: Array<{ name: string; type: string; required: boolean; enum?: string[] }>;
    example: JsonRecord;
  };
}

export interface ToolSearchHits {
  tools: CompactTool[];
  unavailable: string[];
}

export interface BoundedOutput {
  json: string;
  truncated: boolean;
  bytes: number;
  artifactPath?: string;
}
