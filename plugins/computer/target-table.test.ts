import { describe, expect, it } from "vitest";
import { findWindow, TargetTable } from "./target-table.js";
import { CuaError, type CuaTransport, type CuaToolResult } from "./cua-transport.js";

class FakeTransport implements CuaTransport {
  constructor(private readonly responses: Record<string, CuaToolResult>) {}
  async call(tool: string): Promise<CuaToolResult> {
    const response = this.responses[tool];
    if (response === undefined) throw new Error(`No fake response for ${tool}`);
    return response;
  }
}

const windowsResponse: CuaToolResult = {
  structuredContent: {
    windows: [
      { pid: 100, window_id: 1, title: "Editor", app_name: "gedit", is_on_screen: true, z_index: 1 },
    ],
  },
};

const stateResponse: CuaToolResult = {
  structuredContent: {
    window_title: "Editor",
    snapshot_id: "s1",
    elements: [
      { element_index: 0, role: "button", label: "Save", enabled: true, actions: ["press"], frame: { x: 0, y: 0, w: 40, h: 20 } },
      { element_index: 1, role: "text", label: "Filename", enabled: true, actions: [], value: "notes.txt", frame: { x: 0, y: 30, w: 200, h: 20 } },
      { element_index: 2, role: "button", label: "Disabled", enabled: false, actions: ["press"], frame: { x: 0, y: 60, w: 40, h: 20 } },
    ],
  },
};

describe("findWindow", () => {
  it("picks the topmost on-screen window when no appId is given", async () => {
    const transport = new FakeTransport({ list_windows: windowsResponse });
    const window = await findWindow(transport, new AbortController().signal);
    expect(window.pid).toBe(100);
    expect(window.windowId).toBe(1);
  });

  it("falls back to the topmost on-screen window when appId matches nothing", async () => {
    const transport = new FakeTransport({ list_windows: windowsResponse });
    const window = await findWindow(transport, new AbortController().signal, "chrome");
    expect(window.pid).toBe(100);
  });

  it("throws a retryable error when no window is on-screen at all", async () => {
    const empty: CuaToolResult = { structuredContent: { windows: [] } };
    const transport = new FakeTransport({ list_windows: empty });
    await expect(findWindow(transport, new AbortController().signal)).rejects.toMatchObject({ code: "stale-observation", retryable: true });
  });
});

describe("TargetTable", () => {
  it("builds a target table with allowed operations and drops disabled elements", async () => {
    const transport = new FakeTransport({ list_windows: windowsResponse, get_window_state: stateResponse });
    const table = new TargetTable();
    const observation = await table.observe(transport, new AbortController().signal);
    expect(observation.targets).toHaveLength(2);
    const button = observation.targets.find((target) => target.name === "Save");
    expect(button?.allowedOperations).toContain("click");
    const text = observation.targets.find((target) => target.name === "Filename");
    expect(text?.allowedOperations).toContain("type");
    expect(text?.value).toBe("notes.txt");
  });

  it("rejects an action against a stale snapshotId", async () => {
    const transport = new FakeTransport({ list_windows: windowsResponse, get_window_state: stateResponse });
    const table = new TargetTable();
    const observation = await table.observe(transport, new AbortController().signal);
    const target = observation.targets[0]!;
    expect(() => table.resolveTarget(target.targetId, "not-the-real-snapshot")).toThrow(CuaError);
  });

  it("resolves a fresh target to Cua call args", async () => {
    const transport = new FakeTransport({ list_windows: windowsResponse, get_window_state: stateResponse });
    const table = new TargetTable();
    const observation = await table.observe(transport, new AbortController().signal);
    const target = observation.targets[0]!;
    const args = table.resolveTarget(target.targetId, observation.snapshotId);
    expect(args).toMatchObject({ pid: 100, window_id: 1, element_index: 0 });
  });
});
