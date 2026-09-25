import { createConnection, migrate, type DbConnection } from "@bb/db";
import type { Tool } from "@modelcontextprotocol/client";
import type {
  McpStdioCatalog,
  McpStdioHost,
} from "../../../src/services/mcp/gateway-stdio.js";
import {
  McpStore,
  type NewMcpServer,
} from "../../../src/services/mcp/store.js";
import type { McpServerRecord } from "../../../src/services/mcp/types.js";

export const silent = { info() {}, warn() {} };

export const serverDirs = async () => ({
  root: "/tmp/mcp-root",
  data: "/tmp/mcp-data",
});

export interface MemoryStore {
  db: DbConnection;
  store: McpStore;
  close(): void;
}

export function memoryStore(): MemoryStore {
  const db = createConnection(":memory:");
  migrate(db);
  return { db, store: new McpStore(db), close: () => db.$client.close() };
}

export function addSource(
  store: McpStore,
  input: Partial<NewMcpServer> & { name: string },
  enabled = true,
): McpServerRecord {
  const source = store.insert({
    description: null,
    type: "stdio",
    configJson: JSON.stringify({
      type: "stdio",
      command: "echo",
      args: [],
      cwd: "${PLUGIN_DATA}",
    }),
    sourceKind: "manual",
    sourceRef: null,
    registryName: null,
    registryVersion: null,
    ...input,
  });
  if (enabled) return source;
  const disabled = store.setEnabled(source.id, false);
  if (!disabled) throw new Error("source vanished");
  return disabled;
}

export function stdioHost(
  catalog: () => McpStdioCatalog,
  onCall: (name: string) => void = () => {},
): McpStdioHost {
  return {
    async start() {
      return catalog();
    },
    async refresh() {
      return catalog();
    },
    async close() {},
    async callTool(_id, name) {
      onCall(name);
      return { content: [{ type: "text", text: "ok" }] };
    },
    async getPrompt() {
      return {};
    },
    async readResource() {
      return {};
    },
  };
}

export function hostWithTools(
  tools: Tool[],
  onCall: (name: string) => void = () => {},
): McpStdioHost {
  return stdioHost(
    () => ({ tools, prompts: [], resources: [], resourceTemplates: [] }),
    onCall,
  );
}
