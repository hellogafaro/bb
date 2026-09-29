import { spawn as nodeSpawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../sha256-hex.js";
import { ensureProvisionedComputerApp } from "./computer-app-provisioning.js";
import type { ComputerDriverPin } from "./computer-driver-provisioning.js";
import type { ComputerHelperPin } from "./computer-helper-provisioning.js";

const testLogger = { debug: () => {}, warn: () => {} };

function fakeFetch(byAsset: Record<string, Uint8Array>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const asset = Object.keys(byAsset).find((name) => url.endsWith(name));
    if (asset === undefined) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } as Response;
    const bytes = byAsset[asset]!;
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } as Response;
  }) as typeof fetch;
}

async function runTar(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = nodeSpawn("tar", args, { cwd, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
  });
}

describe("ensureProvisionedComputerApp", () => {
  let dataDir: string;
  let buildDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-app-provisioning-"));
    buildDir = await mkdtemp(join(tmpdir(), "computer-app-fixture-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(buildDir, { recursive: true, force: true });
  });

  it("falls back to legacy on a non-darwin platform even with a helper pin", async () => {
    await writeFile(join(buildDir, "cua-driver"), "#!/bin/sh\necho fixture\n");
    const driverArchive = join(buildDir, "driver.tar.gz");
    await runTar(["-czf", driverArchive, "-C", buildDir, "cua-driver"], buildDir);
    const driverBytes = new Uint8Array(await readFile(driverArchive));
    const driverPin: ComputerDriverPin = { version: "9.9.9", asset: "driver.tar.gz", sha256: sha256Hex(driverBytes) };

    const state = await ensureProvisionedComputerApp({
      dataDir,
      logger: testLogger,
      platformKey: "linux-x64",
      fetchImpl: fakeFetch({ "driver.tar.gz": driverBytes }),
      driverPins: { "linux-x64": driverPin },
      helperPins: { "linux-x64": { version: "0.1.0", asset: "helper.tar.gz", sha256: "0".repeat(64) } },
    });

    expect(state.kind).toBe("legacy");
  });

  it("falls back to legacy on darwin when no helper pin exists for this platform", async () => {
    await writeFile(join(buildDir, "cua-driver"), "#!/bin/sh\necho fixture\n");
    const driverArchive = join(buildDir, "driver.tar.gz");
    await runTar(["-czf", driverArchive, "-C", buildDir, "cua-driver"], buildDir);
    const driverBytes = new Uint8Array(await readFile(driverArchive));
    const driverPin: ComputerDriverPin = { version: "9.9.9", asset: "driver.tar.gz", sha256: sha256Hex(driverBytes) };

    const state = await ensureProvisionedComputerApp({
      dataDir,
      logger: testLogger,
      platformKey: "darwin-arm64",
      fetchImpl: fakeFetch({ "driver.tar.gz": driverBytes }),
      driverPins: { "darwin-arm64": driverPin },
      helperPins: {},
      signBundle: false,
    });

    expect(state.kind).toBe("legacy");
  });

  it("assembles the embedded bb Computer.app when both driver and helper are pinned on darwin", async () => {
    await writeFile(join(buildDir, "cua-driver"), "#!/bin/sh\necho fixture\n");
    const driverArchive = join(buildDir, "driver.tar.gz");
    await runTar(["-czf", driverArchive, "-C", buildDir, "cua-driver"], buildDir);
    const driverBytes = new Uint8Array(await readFile(driverArchive));
    const driverPin: ComputerDriverPin = { version: "9.9.9", asset: "driver.tar.gz", sha256: sha256Hex(driverBytes) };

    const helperBuildDir = await mkdtemp(join(tmpdir(), "computer-helper-fixture-"));
    try {
      await writeFile(join(helperBuildDir, "bb-computer-helper"), "#!/bin/sh\necho helper-fixture\n");
      const helperArchive = join(helperBuildDir, "helper.tar.gz");
      await runTar(["-czf", helperArchive, "-C", helperBuildDir, "bb-computer-helper"], helperBuildDir);
      const helperBytes = new Uint8Array(await readFile(helperArchive));
      const helperPin: ComputerHelperPin = { version: "0.1.0", asset: "helper.tar.gz", sha256: sha256Hex(helperBytes) };

      const state = await ensureProvisionedComputerApp({
        dataDir,
        logger: testLogger,
        platformKey: "darwin-arm64",
        fetchImpl: fakeFetch({ "driver.tar.gz": driverBytes, "helper.tar.gz": helperBytes }),
        driverPins: { "darwin-arm64": driverPin },
        helperPins: { "darwin-arm64": helperPin },
        signBundle: false,
      });

      expect(state.kind).toBe("embedded");
      if (state.kind !== "embedded") return;
      expect(state.changed).toBe(true);
      await access(state.helperExecutablePath);
      await access(join(state.bundleDir, "Contents", "MacOS", "cua-driver"));
      const plist = await readFile(join(state.bundleDir, "Contents", "Info.plist"), "utf8");
      expect(plist).toContain("<string>app.getbb.computer</string>");
      expect(plist).toContain("<string>bb-computer-helper</string>");
    } finally {
      await rm(helperBuildDir, { recursive: true, force: true });
    }
  });
});
