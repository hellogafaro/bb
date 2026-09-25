import { afterEach, expect, it } from "vitest";
import { addSource, memoryStore, type MemoryStore } from "./helpers.js";

const stores: MemoryStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function createStore() {
  const created = memoryStore();
  stores.push(created);
  return created.store;
}

it("assigns an mcp_ id and a unique handle, and resolves by id, handle, or name", () => {
  const store = createStore();
  const first = addSource(store, { name: "Notion Docs" });
  const second = addSource(store, { name: "notion docs" });
  expect(first).toMatchObject({
    id: expect.stringMatching(/^mcp_[a-z0-9]{10}$/),
    handle: "notion_docs",
    enabled: true,
    status: "idle",
    guide: null,
  });
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
  expect(store.listToolPolicies(id)).toEqual([]);
});

it("keeps a chosen policy mode when a re-seed changes the risk", () => {
  const store = createStore();
  const { id } = addSource(store, { name: "notes" });
  store.seedToolPolicies(id, [{ name: "write_note", risk: "write" }]);
  store.setToolPolicyMode(id, "write_note", "deny");
  store.seedToolPolicies(id, [{ name: "write_note", risk: "destructive" }]);
  expect(store.getToolPolicy(id, "write_note")).toEqual({
    toolName: "write_note",
    risk: "destructive",
    mode: "deny",
  });
  expect(store.setToolPolicyMode(id, "missing", "allow")).toBeUndefined();
});

it("tracks enablement and status on the source row", () => {
  const store = createStore();
  const { id } = addSource(store, { name: "files" });
  expect(store.hasEnabled()).toBe(true);
  store.setStatus(id, "error", "offline");
  expect(store.setEnabled(id, false)).toMatchObject({
    enabled: false,
    status: "disabled",
    lastError: null,
  });
  expect(store.listEnabled()).toEqual([]);
  expect(store.hasEnabled()).toBe(false);
  expect(store.setEnabled(id, true)).toMatchObject({
    enabled: true,
    status: "idle",
  });
  expect(store.listEnabled().map((source) => source.id)).toEqual([id]);
});
