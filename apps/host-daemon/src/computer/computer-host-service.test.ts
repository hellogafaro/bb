import { EventEmitter } from "node:events";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
    const binaryProbe = report.probes.find((probe) => probe.label === "binary");
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
    const binaryProbe = report.probes.find((probe) => probe.label === "binary");
    expect(binaryProbe?.status).toBe("ok");
    expect(binaryProbe?.message).toContain("cua-driver");
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
    const binaryProbe = report.probes.find((probe) => probe.label === "binary");
    expect(binaryProbe?.status).toBe("ok");
    service.dispose();
  });
});
