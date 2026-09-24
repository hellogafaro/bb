import { afterEach, describe, expect, it } from "vitest";
import type { McpsStore } from "../src/store.js";
import { connectedInstructions, GUIDE_MAX_CHARS, INSTRUCTIONS_MAX_CHARS, threadServerSelection } from "../src/context.js";
import { addSource as insertSource, memoryStore } from "./helpers.js";

const stores: McpsStore[] = [];
afterEach(() => { for (const store of stores.splice(0)) store.db.close(); });

function createStore(): McpsStore {
  const store = memoryStore();
  stores.push(store);
  return store;
}

function addSource(store: McpsStore, name: string, options: { description?: string | null; enabled?: boolean } = {}) {
  return insertSource(store, { name, description: options.description ?? null }, options.enabled !== false).id;
}

function render(store: McpsStore, metadata: Record<string, unknown> = {}) {
  return connectedInstructions(store.listEnabled(), threadServerSelection(metadata));
}

const TRAILER = "Use mcp_search to find tools on connected MCPs, then mcp_call.";
const block = (...lines: string[]) => ["<connected_mcps>", ...lines, "</connected_mcps>", TRAILER].join("\n");

describe("connected MCP instructions", () => {
  it("omits the section when no enabled server exists", () => {
    const store = createStore();
    expect(render(store)).toBeUndefined();
    addSource(store, "off", { enabled: false });
    expect(render(store)).toBeUndefined();
  });

  it("renders one server with a collapsed description", () => {
    const store = createStore();
    addSource(store, "notion", { description: "Notion pages\n and databases" });
    expect(render(store)).toBe(block('  <mcp handle="notion" description="Notion pages and databases" />'));
  });

  it("lists servers in handle order, omits empty descriptions, and escapes attributes", () => {
    const store = createStore();
    addSource(store, "slack", { description: "Slack <messages> & \"threads\"" });
    addSource(store, "notion", { description: "  " });
    addSource(store, "local");
    addSource(store, "disabled", { enabled: false });
    expect(render(store)).toBe(block(
      '  <mcp handle="local" />',
      '  <mcp handle="notion" />',
      '  <mcp handle="slack" description="Slack &lt;messages&gt; &amp; &quot;threads&quot;" />',
    ));
  });

  it("clips descriptions to 160 characters", () => {
    const store = createStore();
    addSource(store, "long", { description: "d".repeat(300) });
    expect(render(store)).toContain(`description="${"d".repeat(159)}…"`);
  });

  it("drops servers into a more count to stay under the size limit", () => {
    const store = createStore();
    for (let i = 0; i < 80; i += 1) addSource(store, `server${String(i).padStart(2, "0")}`, { description: "x".repeat(200) });
    const text = render(store)!;
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
    const shown = text.match(/<mcp handle="server\d\d"/g)!.length;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(80);
    expect(text).toContain(`  <more count="${80 - shown}" />\n</connected_mcps>\n${TRAILER}`);
  });

  it("nests clipped, escaped guides inside the server element", () => {
    const store = createStore();
    const notion = addSource(store, "notion", { description: "Notion" });
    const github = addSource(store, "github");
    store.setGuide(notion, "Search Engineering first.\n\nNever edit <archived> & old pages.");
    store.setGuide(github, "y".repeat(GUIDE_MAX_CHARS + 200));
    expect(render(store)).toBe(block(
      '  <mcp handle="github">',
      `    ${"y".repeat(GUIDE_MAX_CHARS - 1)}…`,
      "  </mcp>",
      '  <mcp handle="notion" description="Notion">',
      "    Search Engineering first.",
      "    Never edit &lt;archived> &amp; old pages.",
      "  </mcp>",
    ));
  });

  it("drops a server's guide with the server when the list is truncated", () => {
    const store = createStore();
    for (let i = 0; i < 12; i += 1) {
      const id = addSource(store, `server${String(i).padStart(2, "0")}`);
      store.setGuide(id, "z".repeat(GUIDE_MAX_CHARS));
    }
    const text = render(store)!;
    expect(text.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
    const opened = text.match(/<mcp handle="server\d\d">/g)!.length;
    expect(text.match(/<\/mcp>/g)!.length).toBe(opened);
    expect(text).toContain(`<more count="${12 - opened}" />`);
  });

  it("restricts the list to the thread's selected ids or handles", () => {
    const store = createStore();
    addSource(store, "notion");
    const slackId = addSource(store, "slack");
    addSource(store, "github");
    expect(render(store, { servers: ["notion", slackId, 7] })).toBe(block('  <mcp handle="notion" />', '  <mcp handle="slack" />'));
    expect(render(store, { servers: [] })).toBeUndefined();
    expect(render(store, { servers: "notion" })).toBe(block('  <mcp handle="github" />', '  <mcp handle="notion" />', '  <mcp handle="slack" />'));
    expect(render(store, { servers: ["notion"] })).not.toContain("<more");
  });
});
