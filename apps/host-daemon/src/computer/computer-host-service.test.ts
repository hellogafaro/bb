import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CuaToolResult, CuaTransport } from "./computer-transport.js";
import { ComputerHostService, type SpawnFn } from "./computer-host-service.js";

const testLogger = { debug: () => {}, warn: () => {} };

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
    const bundleDir = join(dataDir, "computer", "driver", "0.30.2", "darwin-arm64", "bb.app");
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
    const binaryPath = join(dataDir, "bb.app", "Contents", "MacOS", "cua-driver");
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
          : probe === "permissions" && args[1] === "status"
            ? '{"accessibility":"granted","screen_recording":"denied"}\n'
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
      if (command === "/usr/bin/open" || (probe === "permissions" && args[1] === "grant")) {
        queueMicrotask(() => child.emit("close", 0));
      }
      return child;
    }) as SpawnFn;

    const service = new ComputerHostService({
      dataDir,
      logger: testLogger,
      transportFactory: () => new FakeTransport(),
      spawnProcess,
      driverFetchImpl: networkDisabledFetch,
      platform: "darwin",
    });
    const report = await service.requestPermissions({});
    expect(calls.some((call) => call.args[0] === "permissions" && call.args[1] === "grant")).toBe(true);
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
