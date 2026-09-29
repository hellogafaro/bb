import { describe, expect, it } from "vitest";
import {
  buildCapabilityManifest,
  MANIFEST_EXPIRES_AFTER_MS,
  MANIFEST_IDLE_TIMEOUT_MS,
  PathGrantSet,
  WindowGrantSet,
} from "./computer-manifest.js";

describe("buildCapabilityManifest", () => {
  it("never allows kill_app or launch_app", () => {
    const manifest = buildCapabilityManifest({ writablePaths: [], windows: [] });
    const tools = (manifest.allow as { tools: string[] }).tools;
    expect(tools).not.toContain("kill_app");
    expect(tools).not.toContain("launch_app");
  });

  it("allows the desktop input and text clipboard tools the human live view drives", () => {
    const manifest = buildCapabilityManifest({ writablePaths: [], windows: [] });
    const tools = (manifest.allow as { tools: string[] }).tools;
    for (const tool of ["click", "drag", "scroll", "move_cursor", "type_text", "press_key", "clipboard_read", "clipboard_write"]) {
      expect(tools).toContain(tool);
    }
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

  it("writes expiry/idle strings that match the exported ms constants used for proactive renewal", () => {
    const manifest = buildCapabilityManifest({ writablePaths: [], windows: [] });
    expect(manifest.expires_after).toBe(`${MANIFEST_EXPIRES_AFTER_MS / 3_600_000}h`);
    expect(manifest.idle_timeout).toBe(`${MANIFEST_IDLE_TIMEOUT_MS / 3_600_000}h`);
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

  it("drops grants for pids that are no longer alive, so a fresh terminal doesn't lose its slot to a dead one", () => {
    const grants = new WindowGrantSet();
    grants.add(100, 1);
    grants.add(200, 2);
    grants.pruneDead((pid) => pid !== 100);
    expect(grants.has(100, 1)).toBe(false);
    expect(grants.has(200, 2)).toBe(true);
    expect(grants.list()).toEqual([{ pid: 200, windowId: 2 }]);
  });

  it("never prunes live pids, even when every current grant is still alive", () => {
    const grants = new WindowGrantSet();
    grants.add(1, 1);
    grants.add(2, 2);
    grants.pruneDead(() => true);
    expect(grants.list()).toHaveLength(2);
  });
});

describe("PathGrantSet", () => {
  it("reports new grants as added and repeats as no-ops", () => {
    const grants = new PathGrantSet();
    expect(grants.add("/data/runs/a")).toBe(true);
    expect(grants.add("/data/runs/a")).toBe(false);
    expect(grants.has("/data/runs/a")).toBe(true);
  });

  it("evicts the oldest grant once the cap of 8 run dirs is reached", () => {
    const grants = new PathGrantSet();
    for (let i = 0; i < 8; i += 1) grants.add(`/data/runs/${i}`);
    expect(grants.has("/data/runs/0")).toBe(true);
    grants.add("/data/runs/8");
    expect(grants.has("/data/runs/0")).toBe(false);
    expect(grants.has("/data/runs/8")).toBe(true);
    expect(grants.list()).toHaveLength(8);
  });

  it("feeds buildCapabilityManifest an exact run directory grant, matching the driver's exact-path check", () => {
    const grants = new PathGrantSet();
    grants.add("/data/runs/11111111-1111-1111-1111-111111111111");
    const manifest = buildCapabilityManifest({ writablePaths: grants.list(), windows: [] });
    const resources = manifest.resources as { files: { write: string[] } };
    expect(resources.files.write).toEqual(["/data/runs/11111111-1111-1111-1111-111111111111"]);
  });
});
