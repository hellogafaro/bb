import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CuaToolResult, CuaTransport } from "./computer-transport.js";
import { ComputerHostService, type SpawnFn } from "./computer-host-service.js";

const testLogger = { debug: () => {}, warn: () => {} };

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
    });
    await expect(service.observe({})).rejects.toThrow();
    service.dispose();
  });
});
