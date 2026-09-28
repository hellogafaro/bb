import { spawn as nodeSpawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../sha256-hex.js";
import {
  COMPUTER_DRIVER_PINS,
  computerDriverPlatformKey,
  ensureProvisionedDriver,
  type ComputerDriverPin,
} from "./computer-driver-provisioning.js";

const testLogger = { debug: () => {}, warn: () => {} };

function fakeFetch(bytes: Uint8Array, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }) as Response) as typeof fetch;
}

async function runTar(args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = nodeSpawn("tar", args, { cwd, stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))));
  });
}

async function stagingEntries(dataDir: string): Promise<string[]> {
  try {
    return await readdir(join(dataDir, "computer", "staging"));
  } catch {
    return [];
  }
}

describe("computerDriverPlatformKey and COMPUTER_DRIVER_PINS", () => {
  it("joins platform and arch", () => {
    expect(computerDriverPlatformKey("linux", "x64")).toBe("linux-x64");
    expect(computerDriverPlatformKey("win32", "arm64")).toBe("win32-arm64");
  });

  it("pins all five supported platform keys to version 0.30.2", () => {
    const expectedKeys = [
      "linux-x64",
      "linux-arm64",
      "darwin-x64",
      "darwin-arm64",
      "win32-x64",
      "win32-arm64",
    ];
    for (const key of expectedKeys) {
      const pin = COMPUTER_DRIVER_PINS[key];
      expect(pin, `missing pin for ${key}`).toBeDefined();
      expect(pin?.version).toBe("0.30.2");
      expect(pin?.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("shares the darwin-universal asset and digest between darwin-x64 and darwin-arm64", () => {
    expect(COMPUTER_DRIVER_PINS["darwin-x64"]).toEqual(COMPUTER_DRIVER_PINS["darwin-arm64"]);
  });
});

describe("ensureProvisionedDriver", () => {
  let dataDir: string;
  const platformKey = "linux-x64";
  const pin: ComputerDriverPin = {
    version: "9.9.9-test",
    asset: "cua-driver-fixture.tar.gz",
    sha256: "",
  };

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "computer-driver-provisioning-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("rejects a digest mismatch and cleans the staging directory", async () => {
    const bytes = new TextEncoder().encode("not the real archive");
    const badPin: ComputerDriverPin = {
      ...pin,
      sha256: "0".repeat(64),
    };
    const result = await ensureProvisionedDriver({
      dataDir,
      logger: testLogger,
      platformKey,
      fetchImpl: fakeFetch(bytes),
      pins: { [platformKey]: badPin },
    });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.message).toContain("sha256");
    }
    expect(await stagingEntries(dataDir)).toEqual([]);
  });

  it("cleans the staging directory after a download failure", async () => {
    const result = await ensureProvisionedDriver({
      dataDir,
      logger: testLogger,
      platformKey,
      fetchImpl: fakeFetch(new Uint8Array(), false, 500),
      pins: { [platformKey]: { ...pin, sha256: "0".repeat(64) } },
    });
    expect(result.status).toBe("failed");
    expect(await stagingEntries(dataDir)).toEqual([]);
  });

  it("returns unpinned for a platform with no pin", async () => {
    const result = await ensureProvisionedDriver({
      dataDir,
      logger: testLogger,
      platformKey: "os2-x64",
    });
    expect(result).toEqual({ status: "unpinned" });
  });

  it("downloads, verifies, extracts, and installs a real archive", async () => {
    const buildDir = await mkdtemp(join(tmpdir(), "computer-driver-fixture-"));
    try {
      await writeFile(join(buildDir, "cua-driver"), "#!/bin/sh\necho fixture\n");
      await writeFile(join(buildDir, "cua-cursor-theme"), "theme");
      const archivePath = join(buildDir, "archive.tar.gz");
      await runTar(["-czf", archivePath, "-C", buildDir, "cua-driver", "cua-cursor-theme"], buildDir);
      const bytes = new Uint8Array(await readFile(archivePath));
      const goodPin: ComputerDriverPin = { ...pin, sha256: sha256Hex(bytes) };

      const result = await ensureProvisionedDriver({
        dataDir,
        logger: testLogger,
        platformKey,
        fetchImpl: fakeFetch(bytes),
        pins: { [platformKey]: goodPin },
      });

      expect(result.status).toBe("installed");
      if (result.status === "installed") {
        await access(result.path, constants.X_OK);
        expect(result.path).toBe(
          join(dataDir, "computer", "driver", goodPin.version, platformKey, "cua-driver"),
        );
      }
      expect(await stagingEntries(dataDir)).toEqual([]);

      const cached = await ensureProvisionedDriver({
        dataDir,
        logger: testLogger,
        platformKey,
        fetchImpl: fakeFetch(new Uint8Array(), false, 500),
        pins: { [platformKey]: goodPin },
      });
      expect(cached.status).toBe("installed");
    } finally {
      await rm(buildDir, { recursive: true, force: true });
    }
  });

  it("wraps the macOS driver in a bb-branded app bundle", async () => {
    const buildDir = await mkdtemp(join(tmpdir(), "computer-driver-fixture-"));
    try {
      await writeFile(join(buildDir, "cua-driver"), "#!/bin/sh\necho fixture\n");
      await writeFile(join(buildDir, "libcua_driver_sdk.dylib"), "lib");
      const archivePath = join(buildDir, "archive.tar.gz");
      await runTar(["-czf", archivePath, "-C", buildDir, "cua-driver", "libcua_driver_sdk.dylib"], buildDir);
      const bytes = new Uint8Array(await readFile(archivePath));
      const darwinPin: ComputerDriverPin = { ...pin, sha256: sha256Hex(bytes) };

      const result = await ensureProvisionedDriver({
        dataDir,
        logger: testLogger,
        platformKey: "darwin-arm64",
        fetchImpl: fakeFetch(bytes),
        pins: { "darwin-arm64": darwinPin },
        iconPath: null,
        signBundle: false,
      });

      expect(result.status).toBe("installed");
      if (result.status !== "installed") return;
      const bundleDir = join(dataDir, "computer", "driver", darwinPin.version, "darwin-arm64", "CuaDriver.app");
      expect(result.path).toBe(join(bundleDir, "Contents", "MacOS", "cua-driver"));
      await access(result.path, constants.X_OK);
      await access(join(bundleDir, "Contents", "MacOS", "libcua_driver_sdk.dylib"));
      const plist = await readFile(join(bundleDir, "Contents", "Info.plist"), "utf8");
      expect(plist).toContain("<string>com.trycua.driver</string>");
      expect(plist).toContain("<key>CFBundleDisplayName</key>\n\t<string>bb Computer</string>");
      expect(plist).toContain("<key>CFBundleName</key>\n\t<string>CuaDriver</string>");
      expect(plist).toContain("<key>LSHasLocalizedDisplayName</key>\n\t<true/>");
      expect(plist).toContain("<key>LSUIElement</key>\n\t<true/>");
      expect(await stagingEntries(dataDir)).toEqual([]);
    } finally {
      await rm(buildDir, { recursive: true, force: true });
    }
  });

  it("adds the bb icon to an already installed macOS bundle", async () => {
    const buildDir = await mkdtemp(join(tmpdir(), "computer-driver-fixture-"));
    try {
      await writeFile(join(buildDir, "cua-driver"), "#!/bin/sh\necho fixture\n");
      const archivePath = join(buildDir, "archive.tar.gz");
      await runTar(["-czf", archivePath, "-C", buildDir, "cua-driver"], buildDir);
      const bytes = new Uint8Array(await readFile(archivePath));
      const darwinPin: ComputerDriverPin = { ...pin, sha256: sha256Hex(bytes) };
      const iconPath = join(buildDir, "bb.icns");
      await writeFile(iconPath, "icon");

      const installed = await ensureProvisionedDriver({
        dataDir,
        logger: testLogger,
        platformKey: "darwin-arm64",
        fetchImpl: fakeFetch(bytes),
        pins: { "darwin-arm64": darwinPin },
        iconPath: null,
        signBundle: false,
      });
      expect(installed.status).toBe("installed");
      if (installed.status !== "installed") return;
      const iconTarget = join(installed.path, "..", "..", "Resources", "bb.icns");
      await expect(access(iconTarget)).rejects.toThrow();

      const repaired = await ensureProvisionedDriver({
        dataDir,
        logger: testLogger,
        platformKey: "darwin-arm64",
        fetchImpl: fakeFetch(new Uint8Array(), false, 500),
        pins: { "darwin-arm64": darwinPin },
        iconPath,
        signBundle: false,
      });
      expect(repaired.status).toBe("installed");
      expect(await readFile(iconTarget, "utf8")).toBe("icon");
    } finally {
      await rm(buildDir, { recursive: true, force: true });
    }
  });

  it("prunes a stale version directory once a new version installs", async () => {
    await mkdir(join(dataDir, "computer", "driver", "0.0.1-stale", platformKey), { recursive: true });

    const buildDir = await mkdtemp(join(tmpdir(), "computer-driver-fixture-"));
    try {
      await writeFile(join(buildDir, "cua-driver"), "#!/bin/sh\necho fixture\n");
      const archivePath = join(buildDir, "archive.tar.gz");
      await runTar(["-czf", archivePath, "-C", buildDir, "cua-driver"], buildDir);
      const bytes = new Uint8Array(await readFile(archivePath));
      const goodPin: ComputerDriverPin = { ...pin, sha256: sha256Hex(bytes) };

      await ensureProvisionedDriver({
        dataDir,
        logger: testLogger,
        platformKey,
        fetchImpl: fakeFetch(bytes),
        pins: { [platformKey]: goodPin },
      });

      const versions = await readdir(join(dataDir, "computer", "driver"));
      expect(versions).toEqual([goodPin.version]);
    } finally {
      await rm(buildDir, { recursive: true, force: true });
    }
  });
});
