import Database from "better-sqlite3";
import type { McpStdioCatalog, McpStdioHost } from "../src/gateway.js";
import { McpsStore, type NewMcpSource } from "../src/store.js";
import type { McpSource } from "../src/types.js";

export const silent = { info() {}, warn() {}, error() {} };

export const serverDirs = async () => ({ root: "/tmp/mcps-root", data: "/tmp/mcps-data" });

export function memoryStore(): McpsStore {
  return new McpsStore(new Database(":memory:"), (db, statements) => {
    for (const statement of statements) db.exec(statement);
  });
}

export function addSource(store: McpsStore, input: Partial<NewMcpSource> & { name: string }, enabled = true): McpSource {
  const source = store.insert({
    description: null,
    type: "stdio",
    configJson: JSON.stringify({ type: "stdio", command: "echo", args: [], cwd: "${PLUGIN_DATA}" }),
    sourceKind: "manual",
    sourceRef: null,
    registryName: null,
    registryVersion: null,
    ...input,
  });
  return enabled ? source : store.setEnabled(source.id, false)!;
}

export function stdioHost(catalog: () => McpStdioCatalog, onCall: (name: string) => void = () => {}): McpStdioHost {
  return {
    async start() { return catalog(); },
    async refresh() { return catalog(); },
    async close() {},
    async callTool(_id, name) { onCall(name); return { content: [{ type: "text", text: "ok" }] }; },
    async getPrompt() { return {}; },
    async readResource() { return {}; },
  };
}
