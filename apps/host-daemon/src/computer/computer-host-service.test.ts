import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CuaError, type CuaToolResult, type CuaTransport } from "./computer-transport.js";
import { ComputerHostService, mapFramePoint, type SpawnFn } from "./computer-host-service.js";

const testLogger = { debug: () => {}, warn: () => {} };
const noLive = { sendFrame: () => {}, sendStatus: () => {} };

const networkDisabledFetch: typeof fetch = (async () => {
  throw new Error("network disabled in test");
}) as typeof fetch;

class FakeTransport implements CuaTransport {
  async call(): Promise<CuaToolResult> {
    throw new Error("transport should not be called while the driver binary is unavailable");
  }
}

function enoentSpawn(): SpawnFn {
  return ((): unknown => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: { end(): void };
      stdout: { setEncoding(): void; on(): void };
      exitCode: number | null;
      unref(): void;
      kill(): boolean;
    };
    child.stdin = { end() {} };
    child.stdout = { setEncoding() {}, on() {} };
    child.exitCode = null;
    child.unref = () => {};
    child.kill = () => true;
    queueMicrotask(() => {
      child.emit("error", Object.assign(new Error("spawn cua-driver ENOENT"), { code: "ENOENT" }));
    });
    return child;
  }) as SpawnFn;
}

function succeedingSpawn(): SpawnFn {
  return ((): unknown => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: { end(): void };
      stdout: { setEncoding(): void; on(event: string, callback: (chunk: string) => void): void };
      exitCode: number | null;
      unref(): void;
      kill(): boolean;
    };
    child.stdin = { end() {} };
    child.stdout = {
      setEncoding() {},
      on(_event: string, callback: (chunk: string) => void) {
        queueMicrotask(() => {
          callback("cua-driver 0.0.0-test\n");
          queueMicrotask(() => child.emit("close", 0));
        });
      },
    };
    child.exitCode = null;
    child.unref = () => {};
    child.kill = () => true;
    return child;
  }) as SpawnFn;
}

describe("ComputerHostService when the cua-driver binary cannot be spawned", () => {
  let dataDir: string;
  let fakeHome: string;
  let previousOverride: string | undefined;
  let previousHome: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-host-data-"));
    fakeHome = await mkdtemp(join(tmpdir(), "computer-host-home-"));
    previousOverride = process.env.CUA_DRIVER_PATH;
    previousHome = process.env.HOME;
    delete process.env.CUA_DRIVER_PATH;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.CUA_DRIVER_PATH;
    else process.env.CUA_DRIVER_PATH = previousOverride;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(dataDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("reports a doctor probe naming the tried paths instead of crashing the daemon", async () => {
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new FakeTransport(),
      spawnProcess: enoentSpawn(),
      driverFetchImpl: networkDisabledFetch,
    });
    const report = await service.doctor();
    expect(report.state).not.toBe("ready");
    const binaryProbe = report.probes.find((probe) => probe.id === "driver");
    expect(binaryProbe?.status).toBe("setup-required");
    expect(binaryProbe?.message).toContain("cua-driver");
    expect(binaryProbe?.message).toContain(join(dataDir, "runtime", "cua-driver"));
    service.dispose();
  });

  it("returns a typed error from observe instead of letting a spawn failure crash the daemon", async () => {
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new FakeTransport(),
      spawnProcess: enoentSpawn(),
      driverFetchImpl: networkDisabledFetch,
    });
    await expect(service.observe({})).rejects.toThrow();
    service.dispose();
  });
});

describe("ComputerHostService driver resolution order", () => {
  let dataDir: string;
  let fakeHome: string;
  let previousOverride: string | undefined;
  let previousHome: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-host-data-"));
    fakeHome = await mkdtemp(join(tmpdir(), "computer-host-home-"));
    previousOverride = process.env.CUA_DRIVER_PATH;
    previousHome = process.env.HOME;
    delete process.env.CUA_DRIVER_PATH;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.CUA_DRIVER_PATH;
    else process.env.CUA_DRIVER_PATH = previousOverride;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(dataDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("falls back to a known candidate path when provisioning is unavailable", async () => {
    const candidatePath = join(dataDir, "runtime", "cua-driver");
    await mkdir(join(dataDir, "runtime"), { recursive: true });
    await writeFile(candidatePath, "#!/bin/sh\necho fixture\n");
    await chmod(candidatePath, 0o755);

    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new FakeTransport(),
      spawnProcess: succeedingSpawn(),
      driverFetchImpl: networkDisabledFetch,
    });
    const report = await service.doctor();
    const binaryProbe = report.probes.find((probe) => probe.id === "driver");
    expect(binaryProbe?.status).toBe("ok");
    expect(binaryProbe?.message).toContain("Installed");
    service.dispose();
  });

  it("prefers CUA_DRIVER_PATH over provisioning and known candidate paths", async () => {
    const overridePath = join(dataDir, "override-driver");
    await writeFile(overridePath, "#!/bin/sh\necho fixture\n");
    await chmod(overridePath, 0o755);
    process.env.CUA_DRIVER_PATH = overridePath;

    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new FakeTransport(),
      spawnProcess: succeedingSpawn(),
      driverFetchImpl: networkDisabledFetch,
    });
    const report = await service.doctor();
    const binaryProbe = report.probes.find((probe) => probe.id === "driver");
    expect(binaryProbe?.status).toBe("ok");
    service.dispose();
  });
});

describe("ComputerHostService on macOS", () => {
  let dataDir: string;
  let previousOverride: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-host-data-"));
    previousOverride = process.env.CUA_DRIVER_PATH;
  });

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.CUA_DRIVER_PATH;
    else process.env.CUA_DRIVER_PATH = previousOverride;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("launches the driver through LaunchServices when it lives in the bb.app bundle", async () => {
    const bundleDir = join(dataDir, "computer", "driver", "0.30.2", "darwin-arm64", "bb Computer.app");
    const binaryPath = join(bundleDir, "Contents", "MacOS", "cua-driver");
    process.env.CUA_DRIVER_PATH = binaryPath;
    const launches: { command: string; args: readonly string[] }[] = [];
    let daemonStarted = false;
    const spawnProcess = ((command: string, args: readonly string[]): unknown => {
      const child = new EventEmitter() as EventEmitter & {
        stdin: { end(): void };
        stdout: { setEncoding(): void; on(event: string, callback: (chunk: string) => void): void };
        exitCode: number | null;
        unref(): void;
        kill(): boolean;
      };
      child.stdin = { end() {} };
      child.exitCode = null;
      child.unref = () => {};
      child.kill = () => true;
      if (command === "/usr/bin/open") {
        launches.push({ command, args });
        daemonStarted = true;
        child.stdout = { setEncoding() {}, on() {} };
        queueMicrotask(() => {
          child.exitCode = 0;
          child.emit("close", 0);
        });
        return child;
      }
      const probe = args[0];
      const exitCode = probe === "status" ? (daemonStarted ? 0 : 1) : 0;
      const output = probe === "--version" ? "cua-driver 0.30.2\n" : probe === "call" ? "{\"windows\":[]}\n" : "";
      child.stdout = {
        setEncoding() {},
        on(_event: string, callback: (chunk: string) => void) {
          queueMicrotask(() => {
            if (output.length > 0) callback(output);
            queueMicrotask(() => child.emit("close", exitCode));
          });
        },
      };
      return child;
    }) as SpawnFn;

    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new FakeTransport(),
      spawnProcess,
      driverFetchImpl: networkDisabledFetch,
    });
    const report = await service.installDriver();
    expect(launches).toHaveLength(1);
    expect(launches[0]?.args.slice(0, 5)).toEqual(["-n", "-g", "-a", bundleDir, "--args"]);
    expect(launches[0]?.args).toContain("serve");
    expect(report.probes.find((probe) => probe.id === "service")?.status).toBe("ok");
    service.dispose();
  });
});

describe("ComputerHostService requestPermissions", () => {
  let dataDir: string;
  let previousOverride: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-host-data-"));
    previousOverride = process.env.CUA_DRIVER_PATH;
  });

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.CUA_DRIVER_PATH;
    else process.env.CUA_DRIVER_PATH = previousOverride;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("runs the driver grant flow and opens the pane for the missing permission on macOS", async () => {
    const binaryPath = join(dataDir, "bb Computer.app", "Contents", "MacOS", "cua-driver");
    process.env.CUA_DRIVER_PATH = binaryPath;
    const calls: { command: string; args: readonly string[] }[] = [];
    const spawnProcess = ((command: string, args: readonly string[]): unknown => {
      calls.push({ command, args });
      const child = new EventEmitter() as EventEmitter & {
        stdin: { end(): void };
        stdout: { setEncoding(): void; on(event: string, callback: (chunk: string) => void): void };
        exitCode: number | null;
        unref(): void;
        kill(): boolean;
      };
      child.stdin = { end() {} };
      child.exitCode = null;
      child.unref = () => {};
      child.kill = () => true;
      const probe = args[0];
      const output =
        probe === "--version"
          ? "cua-driver 0.30.2\n"
          : probe === "call" && args[1] === "health_report"
            ? '{"checks":[{"name":"tcc_accessibility","status":"pass"},{"name":"tcc_screen_recording","status":"fail"}]}\n'
            : probe === "call"
              ? '{"windows":[]}\n'
              : "";
      child.stdout = {
        setEncoding() {},
        on(_event: string, callback: (chunk: string) => void) {
          queueMicrotask(() => {
            if (output.length > 0) callback(output);
            queueMicrotask(() => child.emit("close", 0));
          });
        },
      };
      if (command === "/usr/bin/open" || command === "/usr/bin/tccutil" || (probe === "permissions" && args[1] === "grant")) {
        queueMicrotask(() => child.emit("close", 0));
      }
      return child;
    }) as SpawnFn;

    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new FakeTransport(),
      spawnProcess,
      driverFetchImpl: networkDisabledFetch,
      platform: "darwin",
    });
    const report = await service.requestPermissions({});
    expect(calls).toContainEqual({ command: "/usr/bin/open", args: ["-R", join(dataDir, "bb Computer.app")] });
    expect(calls.some((call) => call.args[0] === "permissions" && call.args[1] === "grant")).toBe(false);
    expect(calls.some((call) => call.command === "/usr/bin/tccutil")).toBe(false);
    const opened = calls.find((call) => call.command === "/usr/bin/open" && String(call.args[0]).startsWith("x-apple"));
    expect(opened?.args[0]).toContain("Privacy_ScreenCapture");
    calls.length = 0;
    await service.requestPermissions({ permission: "accessibility" });
    const explicit = calls.find((call) => call.command === "/usr/bin/open" && String(call.args[0]).startsWith("x-apple"));
    expect(explicit?.args[0]).toContain("Privacy_Accessibility");
    expect(report.probes.find((probe) => probe.id === "screen-recording")?.status).toBe("setup-required");
    expect(report.probes.find((probe) => probe.id === "accessibility")?.status).toBe("ok");
    expect(report.driverPath).toBe(binaryPath);
    service.dispose();
  });
});

describe("ComputerHostService recordStart", () => {
  let dataDir: string;
  let fakeHome: string;
  let previousOverride: string | undefined;
  let previousHome: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-host-data-"));
    fakeHome = await mkdtemp(join(tmpdir(), "computer-host-home-"));
    previousOverride = process.env.CUA_DRIVER_PATH;
    previousHome = process.env.HOME;
    const driverPath = join(dataDir, "runtime", "cua-driver");
    await mkdir(join(dataDir, "runtime"), { recursive: true });
    await writeFile(driverPath, "#!/bin/sh\necho fixture\n");
    await chmod(driverPath, 0o755);
    process.env.CUA_DRIVER_PATH = driverPath;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.CUA_DRIVER_PATH;
    else process.env.CUA_DRIVER_PATH = previousOverride;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(dataDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("grants the exact run directory in the manifest before calling start_recording, not just its parent", async () => {
    const calls: { tool: string; input: Record<string, unknown> }[] = [];
    class RecordingTransport implements CuaTransport {
      async call(tool: string, input: Record<string, unknown>): Promise<CuaToolResult> {
        calls.push({ tool, input });
        return { structuredContent: {} };
      }
    }
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new RecordingTransport(),
      spawnProcess: succeedingSpawn(),
      driverFetchImpl: networkDisabledFetch,
    });

    const runId = "11111111-1111-1111-1111-111111111111";
    await service.recordStart({ runId });

    const startRecordingCall = calls.find((call) => call.tool === "start_recording");
    expect(startRecordingCall).toBeDefined();
    const outputDir = join(dataDir, "runs", runId);
    expect(startRecordingCall?.input.output_dir).toBe(outputDir);

    const manifest = JSON.parse(await readFile(join(dataDir, "capability-manifest.json"), "utf8")) as {
      resources: { files: { write: string[] } };
    };
    expect(manifest.resources.files.write).toContain(outputDir);
    expect(manifest.resources.files.write).not.toContain(join(dataDir, "runs"));

    service.dispose();
  });
});

describe("mapFramePoint", () => {
  it("scales a point from a downscaled capture frame to the real desktop resolution", () => {
    const frame = { width: 1280, height: 800 };
    const desktop = { width: 2560, height: 1600 };
    expect(mapFramePoint(frame, desktop, 640, 400)).toEqual({ x: 1280, y: 800 });
    expect(mapFramePoint(frame, desktop, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("clamps out-of-range coordinates to the desktop bounds", () => {
    const frame = { width: 1280, height: 800 };
    const desktop = { width: 1920, height: 1080 };
    expect(mapFramePoint(frame, desktop, -50, -50)).toEqual({ x: 0, y: 0 });
    expect(mapFramePoint(frame, desktop, 10_000, 10_000)).toEqual({
      x: desktop.width - 1,
      y: desktop.height - 1,
    });
  });

  it("is a no-op when the frame already matches the desktop resolution", () => {
    const frame = { width: 1920, height: 1080 };
    const desktop = { width: 1920, height: 1080 };
    expect(mapFramePoint(frame, desktop, 123, 456)).toEqual({ x: 123, y: 456 });
  });
});

describe("ComputerHostService act with targetless window operations", () => {
  let dataDir: string;
  let fakeHome: string;
  let previousOverride: string | undefined;
  let previousHome: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-host-data-"));
    fakeHome = await mkdtemp(join(tmpdir(), "computer-host-home-"));
    previousOverride = process.env.CUA_DRIVER_PATH;
    previousHome = process.env.HOME;
    const driverPath = join(dataDir, "runtime", "cua-driver");
    await mkdir(join(dataDir, "runtime"), { recursive: true });
    await writeFile(driverPath, "#!/bin/sh\necho fixture\n");
    await chmod(driverPath, 0o755);
    process.env.CUA_DRIVER_PATH = driverPath;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.CUA_DRIVER_PATH;
    else process.env.CUA_DRIVER_PATH = previousOverride;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(dataDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("targets the observed window by pid/window_id for focus_window, type_window, and press_key, translating combos to hotkey", async () => {
    const calls: { tool: string; input: Record<string, unknown> }[] = [];
    class RecordingTransport implements CuaTransport {
      async call(tool: string, input: Record<string, unknown>): Promise<CuaToolResult> {
        calls.push({ tool, input });
        if (tool === "list_windows") {
          return { structuredContent: { windows: [{ pid: 42, window_id: 7, title: "jev-test", is_on_screen: true, z_index: 1 }] } };
        }
        if (tool === "get_window_state") {
          return { structuredContent: { window_title: "jev-test", elements: [] } };
        }
        return { structuredContent: {} };
      }
    }
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new RecordingTransport(),
      spawnProcess: succeedingSpawn(),
      driverFetchImpl: networkDisabledFetch,
      platform: "linux",
    });

    await service.observe({});
    await service.act({ action: { kind: "focus_window" } });
    await service.act({ action: { kind: "type_window", text: "echo hello-from-jev" } });
    await service.act({ action: { kind: "press_key", key: "Enter" } });
    await service.act({ action: { kind: "press_key", key: "mod+c" } });

    const focus = calls.find((call) => call.tool === "bring_to_front");
    expect(focus?.input).toMatchObject({ pid: 42, window_id: 7 });

    const typed = calls.find((call) => call.tool === "type_text");
    expect(typed?.input).toMatchObject({ pid: 42, window_id: 7, text: "echo hello-from-jev" });

    const enter = calls.find((call) => call.tool === "press_key" && call.input.key === "Enter");
    expect(enter?.input).toMatchObject({ pid: 42, window_id: 7 });

    const combo = calls.find((call) => call.tool === "hotkey");
    expect(combo?.input).toMatchObject({ pid: 42, window_id: 7, keys: ["ctrl", "c"] });

    service.dispose();
  });

  it("warmUp() connects the persistent driver session eagerly, before any observe or act", async () => {
    const calls: string[] = [];
    class RecordingLiveTransport implements CuaTransport {
      async call(tool: string): Promise<CuaToolResult> {
        calls.push(tool);
        return { structuredContent: {} };
      }
      close(): void {}
    }
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      liveTransportFactory: () => new RecordingLiveTransport(),
      spawnProcess: succeedingSpawn(),
      driverFetchImpl: networkDisabledFetch,
      platform: "linux",
    });

    await service.warmUp();

    expect(calls).toEqual(["health_report"]);
    service.dispose();
  });

  it("warmUp() never throws even when the driver session cannot be established", async () => {
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      spawnProcess: enoentSpawn(),
      driverFetchImpl: networkDisabledFetch,
      platform: "linux",
    });

    await expect(service.warmUp()).resolves.toBeUndefined();
    service.dispose();
  });
});

function statefulLoggingSpawn(log: string[]): SpawnFn {
  let daemonStarted = false;
  return ((command: string, args: readonly string[]): unknown => {
    const child = new EventEmitter() as EventEmitter & {
      stdin: { end(): void };
      stdout?: { setEncoding(): void; on(event: string, callback: (chunk: string) => void): void };
      exitCode: number | null;
      unref(): void;
      kill(): boolean;
    };
    child.stdin = { end() {} };
    child.exitCode = null;
    child.unref = () => {};
    child.kill = () => true;
    const probe = args[0];
    if (probe === "serve") {
      log.push("serve");
      daemonStarted = true;
      return child;
    }
    if (probe === "stop") {
      log.push("stop");
      daemonStarted = false;
    }
    const exitCode = probe === "status" ? (daemonStarted ? 0 : 1) : 0;
    const output = probe === "--version" ? "cua-driver 0.0.0-test\n" : probe === "call" ? '{"windows":[]}\n' : "";
    child.stdout = {
      setEncoding() {},
      on(_event: string, callback: (chunk: string) => void) {
        queueMicrotask(() => {
          if (output.length > 0) callback(output);
          queueMicrotask(() => child.emit("close", exitCode));
        });
      },
    };
    return child;
  }) as SpawnFn;
}

describe("ComputerHostService manifest renewal", () => {
  let dataDir: string;
  let fakeHome: string;
  let previousOverride: string | undefined;
  let previousHome: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-host-data-"));
    fakeHome = await mkdtemp(join(tmpdir(), "computer-host-home-"));
    previousOverride = process.env.CUA_DRIVER_PATH;
    previousHome = process.env.HOME;
    const driverPath = join(dataDir, "runtime", "cua-driver");
    await mkdir(join(dataDir, "runtime"), { recursive: true });
    await writeFile(driverPath, "#!/bin/sh\necho fixture\n");
    await chmod(driverPath, 0o755);
    process.env.CUA_DRIVER_PATH = driverPath;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.CUA_DRIVER_PATH;
    else process.env.CUA_DRIVER_PATH = previousOverride;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(dataDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("proactively renews and restarts once the driver has been idle past the configured margin", async () => {
    const log: string[] = [];
    let closes = 0;
    class RecordingLiveTransport implements CuaTransport {
      async call(tool: string): Promise<CuaToolResult> {
        log.push(tool);
        return { structuredContent: { text: "clip" } };
      }
      close(): void {
        closes += 1;
      }
    }
    let now = 1_000;
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      liveTransportFactory: () => new RecordingLiveTransport(),
      spawnProcess: statefulLoggingSpawn(log),
      driverFetchImpl: networkDisabledFetch,
      platform: "linux",
      manifestRenewal: { idleTimeoutMs: 1_000, marginMs: 400, now: () => now },
    });

    await service.warmUp();
    expect(log.filter((entry) => entry === "serve")).toHaveLength(1);
    expect(closes).toBe(1);

    log.length = 0;
    await service.clipboardRead();
    expect(log).toEqual(["clipboard_read"]);

    now += 700;
    log.length = 0;
    await service.clipboardRead();
    expect(log).toEqual(["stop", "serve", "clipboard_read"]);
    expect(closes).toBe(2);

    const manifestPath = join(dataDir, "capability-manifest.json");
    expect(await readFile(manifestPath, "utf8")).toContain("idle_timeout");

    service.dispose();
  });

  it("renews the manifest and retries once when a driver call reports the idle timeout has lapsed", async () => {
    const log: string[] = [];
    let calls = 0;
    class LapsingLiveTransport implements CuaTransport {
      async call(tool: string): Promise<CuaToolResult> {
        log.push(tool);
        calls += 1;
        if (calls === 1) {
          throw new CuaError(
            "Policy loading error: capability manifest idle timeout exceeded",
            "provider-unavailable",
          );
        }
        return { structuredContent: { text: "clip" } };
      }
      close(): void {}
    }
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      liveTransportFactory: () => new LapsingLiveTransport(),
      spawnProcess: statefulLoggingSpawn(log),
      driverFetchImpl: networkDisabledFetch,
      platform: "linux",
    });

    const result = await service.clipboardRead();
    expect(result.text).toBe("clip");
    expect(calls).toBe(2);
    expect(log).toEqual(["clipboard_read", "stop", "serve", "clipboard_read"]);

    service.dispose();
  });
});

describe("ComputerHostService desktop capture", () => {
  let dataDir: string;
  let fakeHome: string;
  let previousOverride: string | undefined;
  let previousHome: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-host-data-"));
    fakeHome = await mkdtemp(join(tmpdir(), "computer-host-home-"));
    previousOverride = process.env.CUA_DRIVER_PATH;
    previousHome = process.env.HOME;
    const driverPath = join(dataDir, "runtime", "cua-driver");
    await mkdir(join(dataDir, "runtime"), { recursive: true });
    await writeFile(driverPath, "#!/bin/sh\necho fixture\n");
    await chmod(driverPath, 0o755);
    process.env.CUA_DRIVER_PATH = driverPath;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.CUA_DRIVER_PATH;
    else process.env.CUA_DRIVER_PATH = previousOverride;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(dataDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("decodes a desktop screenshot delivered as an MCP image content item over the persistent session", async () => {
    class McpImageTransport implements CuaTransport {
      async call(tool: string): Promise<CuaToolResult> {
        if (tool !== "get_desktop_state") throw new Error(`unexpected tool ${tool}`);
        return {
          structuredContent: { screenshot_width: 1280, screenshot_height: 800 },
          content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
        };
      }
    }
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new McpImageTransport(),
      spawnProcess: statefulLoggingSpawn([]),
      driverFetchImpl: networkDisabledFetch,
      platform: "linux",
    });

    const image = await service.capture({ kind: "desktop" });
    expect(image.dataBase64).toBe("aGVsbG8=");
    expect(image.mimeType).toBe("image/png");
    expect(image.width).toBe(1280);
    expect(image.height).toBe(800);

    service.dispose();
  });

  it("throws instead of returning an empty image when the driver's capture has no decodable image", async () => {
    class EmptyImageTransport implements CuaTransport {
      async call(): Promise<CuaToolResult> {
        return { structuredContent: { screenshot_width: 0, screenshot_height: 0, screenshot_png_b64: "" } };
      }
    }
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new EmptyImageTransport(),
      spawnProcess: statefulLoggingSpawn([]),
      driverFetchImpl: networkDisabledFetch,
      platform: "linux",
    });

    await expect(service.capture({ kind: "desktop" })).rejects.toThrow(/without an image/);

    service.dispose();
  });
});

describe("ComputerHostService doctor capture probe", () => {
  let dataDir: string;
  let fakeHome: string;
  let previousOverride: string | undefined;
  let previousHome: string | undefined;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-host-data-"));
    fakeHome = await mkdtemp(join(tmpdir(), "computer-host-home-"));
    previousOverride = process.env.CUA_DRIVER_PATH;
    previousHome = process.env.HOME;
    const driverPath = join(dataDir, "runtime", "cua-driver");
    await mkdir(join(dataDir, "runtime"), { recursive: true });
    await writeFile(driverPath, "#!/bin/sh\necho fixture\n");
    await chmod(driverPath, 0o755);
    process.env.CUA_DRIVER_PATH = driverPath;
    process.env.HOME = fakeHome;
  });

  afterEach(async () => {
    if (previousOverride === undefined) delete process.env.CUA_DRIVER_PATH;
    else process.env.CUA_DRIVER_PATH = previousOverride;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(dataDir, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it("fails the Screen capture probe when health_report succeeds but a real capture comes back empty", async () => {
    class HealthyButBlankTransport implements CuaTransport {
      async call(tool: string): Promise<CuaToolResult> {
        if (tool === "get_desktop_state") {
          return { structuredContent: { screenshot_width: 0, screenshot_height: 0, screenshot_png_b64: "" } };
        }
        return { structuredContent: {} };
      }
    }
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new HealthyButBlankTransport(),
      spawnProcess: statefulLoggingSpawn([]),
      driverFetchImpl: networkDisabledFetch,
      platform: "linux",
    });

    const report = await service.doctor();
    const capture = report.probes.find((probe) => probe.id === "capture");
    expect(capture?.status).not.toBe("ok");
    expect(report.state).not.toBe("ready");

    service.dispose();
  });

  it("passes the Screen capture probe when a real capture returns a decodable image", async () => {
    class WorkingCaptureTransport implements CuaTransport {
      async call(tool: string): Promise<CuaToolResult> {
        if (tool === "get_desktop_state") {
          return {
            structuredContent: { screenshot_width: 64, screenshot_height: 40 },
            content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
          };
        }
        if (tool === "list_windows") return { structuredContent: { windows: [] } };
        return { structuredContent: {} };
      }
    }
    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      live: noLive,
      transportFactory: () => new WorkingCaptureTransport(),
      spawnProcess: statefulLoggingSpawn([]),
      driverFetchImpl: networkDisabledFetch,
      platform: "linux",
    });

    const report = await service.doctor();
    const capture = report.probes.find((probe) => probe.id === "capture");
    expect(capture?.status).toBe("ok");

    service.dispose();
  });
});
