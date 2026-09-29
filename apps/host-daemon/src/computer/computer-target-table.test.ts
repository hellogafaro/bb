import { describe, expect, it } from "vitest";
import { findWindow, TargetTable } from "./computer-target-table.js";
import { CuaError, type CuaTransport, type CuaToolResult } from "./computer-transport.js";

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

  it("falls back to the accessible description when a toolbar button reports no label", async () => {
    const unlabelledButton: CuaToolResult = {
      structuredContent: {
        window_title: "Editor",
        snapshot_id: "s4",
        elements: [
          {
            element_index: 0,
            role: "button",
            label: "",
            description: "Open Tab",
            enabled: true,
            actions: ["press"],
            frame: { x: 0, y: 0, w: 20, h: 20 },
          },
        ],
      },
    };
    const transport = new FakeTransport({ list_windows: windowsResponse, get_window_state: unlabelledButton });
    const table = new TargetTable();
    const observation = await table.observe(transport, new AbortController().signal);
    expect(observation.targets).toHaveLength(1);
    expect(observation.targets[0]?.name).toBe("Open Tab");
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

  it("returns no hint when the window has elements", async () => {
    const transport = new FakeTransport({ list_windows: windowsResponse, get_window_state: stateResponse });
    const table = new TargetTable();
    const observation = await table.observe(transport, new AbortController().signal);
    expect(observation.hint).toBeNull();
  });

  it("hints at --force-renderer-accessibility for a Chromium window with zero elements", async () => {
    const chromeWindow: CuaToolResult = {
      structuredContent: {
        windows: [
          { pid: 200, window_id: 2, title: "Example Domain - Google Chrome for Testing", app_name: "chrome", is_on_screen: true, z_index: 1 },
        ],
      },
    };
    const emptyState: CuaToolResult = {
      structuredContent: { window_title: "Example Domain - Google Chrome for Testing", snapshot_id: "s2", elements: [] },
    };
    const transport = new FakeTransport({ list_windows: chromeWindow, get_window_state: emptyState });
    const table = new TargetTable();
    const observation = await table.observe(transport, new AbortController().signal);
    expect(observation.targets).toHaveLength(0);
    expect(observation.hint).toMatch(/force-renderer-accessibility/);
    expect(observation.hint).toMatch(/browser binding/);
  });

  it("follows a newly topmost window on reobserve instead of staying pinned to the previously observed one", async () => {
    let windows = [{ pid: 100, window_id: 1, title: "jev-test", app_name: "xfce4-terminal", is_on_screen: true, z_index: 1 }];
    class SwitchingTransport implements CuaTransport {
      async call(tool: string): Promise<CuaToolResult> {
        if (tool === "list_windows") return { structuredContent: { windows } };
        if (tool === "get_window_state") {
          const top = windows[windows.length - 1]!;
          return { structuredContent: { window_title: top.title, snapshot_id: `s-${top.window_id}`, elements: [] } };
        }
        throw new Error(`No fake response for ${tool}`);
      }
    }
    const transport = new SwitchingTransport();
    const table = new TargetTable();
    const first = await table.observe(transport, new AbortController().signal);
    expect(first.title).toBe("jev-test");

    windows = [
      ...windows,
      { pid: 100, window_id: 2, title: "jev-test (new tab)", app_name: "xfce4-terminal", is_on_screen: true, z_index: 2 },
    ];
    const second = await table.reobserve(transport, new AbortController().signal);
    expect(second.title).toBe("jev-test (new tab)");
    expect(table.window?.windowId).toBe(2);
  });

  it("grants the initial window before observing it", async () => {
    const transport = new FakeTransport({ list_windows: windowsResponse, get_window_state: stateResponse });
    const calls: string[] = [];
    const table = new TargetTable(async (pid, windowId) => {
      calls.push(`grant:${pid}:${windowId}`);
    });
    await table.observe(transport, new AbortController().signal);
    expect(calls).toEqual(["grant:100:1"]);
  });

  it("grants a newly appeared window before reobserving it, so a new window appearing gets granted then observed and acted on", async () => {
    let windows = [{ pid: 100, window_id: 1, title: "jev-test", app_name: "xfce4-terminal", is_on_screen: true, z_index: 1 }];
    const calls: string[] = [];
    class SwitchingTransport implements CuaTransport {
      async call(tool: string): Promise<CuaToolResult> {
        if (tool === "list_windows") return { structuredContent: { windows } };
        if (tool === "get_window_state") {
          const top = windows[windows.length - 1]!;
          calls.push(`observe:${top.pid}:${top.window_id}`);
          return { structuredContent: { window_title: top.title, snapshot_id: `s-${top.window_id}`, elements: [] } };
        }
        throw new Error(`No fake response for ${tool}`);
      }
    }
    const transport = new SwitchingTransport();
    const table = new TargetTable(async (pid, windowId) => {
      calls.push(`grant:${pid}:${windowId}`);
    });
    await table.observe(transport, new AbortController().signal);

    windows = [
      ...windows,
      { pid: 100, window_id: 2, title: "jev-test (new tab)", app_name: "xfce4-terminal", is_on_screen: true, z_index: 2 },
    ];
    await table.reobserve(transport, new AbortController().signal);

    expect(calls).toEqual(["grant:100:1", "observe:100:1", "grant:100:2", "observe:100:2"]);
  });

  it("gives a generic hint for a non-Chromium window with zero elements", async () => {
    const nativeWindow: CuaToolResult = {
      structuredContent: {
        windows: [{ pid: 300, window_id: 3, title: "Untitled - gedit", app_name: "gedit", is_on_screen: true, z_index: 1 }],
      },
    };
    const emptyState: CuaToolResult = {
      structuredContent: { window_title: "Untitled - gedit", snapshot_id: "s3", elements: [] },
    };
    const transport = new FakeTransport({ list_windows: nativeWindow, get_window_state: emptyState });
    const table = new TargetTable();
    const observation = await table.observe(transport, new AbortController().signal);
    expect(observation.targets).toHaveLength(0);
    expect(observation.hint).not.toMatch(/force-renderer-accessibility/);
    expect(observation.hint).not.toBeNull();
  });
});
