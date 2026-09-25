import { afterEach, expect, it } from "vitest";
import type { McpStore } from "../src/store.js";
import { addSource, memoryStore } from "./helpers.js";

const stores: McpStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });

function createStore(): McpStore {
  const store = memoryStore();
  stores.push(store);
  return store;
}

it("creates only the sources and tool_policies tables", () => {
  const store = createStore();
  const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").pluck().all();
  expect(tables).toEqual(["sources", "tool_policies"]);
  const columns = (table: string) => store.db.prepare(`SELECT name FROM pragma_table_info(?)`).pluck().all(table);
  expect(columns("sources")).toEqual([
    "id", "handle", "name", "description", "type", "configJson", "status", "lastError", "enabled", "guide",
    "sourceKind", "sourceRef", "registryName", "registryVersion", "createdAt", "updatedAt",
  ]);
  expect(columns("tool_policies")).toEqual(["sourceId", "toolName", "risk", "mode"]);
});

it("assigns an mcp_ id and a unique handle, and resolves by id, handle, or name", () => {
  const store = createStore();
  const first = addSource(store, { name: "Notion Docs" });
  const second = addSource(store, { name: "notion docs" });
  expect(first).toMatchObject({ id: expect.stringMatching(/^mcp_[a-z0-9]{10}$/), handle: "notion_docs", enabled: true, status: "idle", guide: null });
  expect(second.handle).toMatch(/^notion_docs_[a-z0-9]{4}$/);
  expect(store.resolve(first.id)?.id).toBe(first.id);
  expect(store.resolve(second.handle)?.id).toBe(second.id);
  expect(store.resolve("Notion Docs")?.id).toBe(first.id);
  expect(store.resolve("notion")).toBeUndefined();
});

it("cascades tool policies when a source is deleted", () => {
  const store = createStore();
  const { id } = addSource(store, { name: "files" });
  store.seedToolPolicies(id, [{ name: "write", risk: "write" }]);
  expect(store.listToolPolicies(id)).toHaveLength(1);
  expect(store.delete(id)).toBe(true);
  expect(store.db.prepare("SELECT COUNT(*) FROM tool_policies").pluck().get()).toBe(0);
});

it("tracks enablement and status on the source row", () => {
  const store = createStore();
  const { id } = addSource(store, { name: "files" });
  store.setStatus(id, "error", "offline");
  expect(store.setEnabled(id, false)).toMatchObject({ enabled: false, status: "disabled", lastError: null });
  expect(store.listEnabled()).toEqual([]);
  expect(store.setEnabled(id, true)).toMatchObject({ enabled: true, status: "idle" });
  expect(store.listEnabled().map((source) => source.id)).toEqual([id]);
});
