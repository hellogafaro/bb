import { describe, expect, it } from "vitest";
import { buildCapabilityManifest, WindowGrantSet } from "./computer-manifest.js";

describe("buildCapabilityManifest", () => {
  it("never allows kill_app, clipboard, or launch_app", () => {
    const manifest = buildCapabilityManifest({ writablePaths: [], windows: [] });
    const tools = (manifest.allow as { tools: string[] }).tools;
    expect(tools).not.toContain("kill_app");
    expect(tools).not.toContain("clipboard_read");
    expect(tools).not.toContain("clipboard_write");
    expect(tools).not.toContain("launch_app");
  });

  it("grants exactly the requested windows and writable paths", () => {
    const manifest = buildCapabilityManifest({
      writablePaths: ["/data/runs"],
      windows: [{ pid: 100, windowId: 1 }],
    });
    const resources = manifest.resources as {
      desktop: { display: boolean; windows: { pid: number; window_id: number }[] };
      files: { write: string[] };
    };
    expect(resources.desktop.display).toBe(true);
    expect(resources.desktop.windows).toEqual([{ pid: 100, window_id: 1 }]);
    expect(resources.files.write).toEqual(["/data/runs"]);
  });

  it("is bounded mode with an expiry and idle timeout", () => {
    const manifest = buildCapabilityManifest({ writablePaths: [], windows: [] });
    expect(manifest.mode).toBe("bounded");
    expect(manifest.expires_after).toBeTruthy();
    expect(manifest.idle_timeout).toBeTruthy();
  });
});

describe("WindowGrantSet", () => {
  it("reports new grants as added and repeats as no-ops", () => {
    const grants = new WindowGrantSet();
    expect(grants.add(1, 1)).toBe(true);
    expect(grants.add(1, 1)).toBe(false);
    expect(grants.has(1, 1)).toBe(true);
  });

  it("evicts the oldest grant once the cap is reached", () => {
    const grants = new WindowGrantSet();
    for (let i = 0; i < 8; i += 1) grants.add(i, i);
    expect(grants.has(0, 0)).toBe(true);
    grants.add(8, 8);
    expect(grants.has(0, 0)).toBe(false);
    expect(grants.has(8, 8)).toBe(true);
    expect(grants.list()).toHaveLength(8);
  });
});
