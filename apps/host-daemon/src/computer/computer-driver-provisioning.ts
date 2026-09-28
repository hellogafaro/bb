import { constants } from "node:fs";
import { access, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sha256Hex } from "../sha256-hex.js";
import type { HostDaemonLogger } from "../logger.js";

export interface ComputerDriverPin {
  readonly version: string;
  readonly url: string;
  readonly sha256: string;
  readonly byteLength: number;
}

export const COMPUTER_DRIVER_PINS: Partial<Record<string, ComputerDriverPin>> = {};

export function computerDriverPlatformKey(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

export type ComputerDriverProvisionState =
  | { readonly status: "unpinned" }
  | { readonly status: "installed"; readonly path: string }
  | { readonly status: "permissions-missing"; readonly path: string }
  | { readonly status: "failed"; readonly message: string };

interface EnsureProvisionedDriverArgs {
  readonly dataDir: string;
  readonly logger: Pick<HostDaemonLogger, "debug" | "warn">;
  readonly platformKey?: string;
  readonly fetchImpl?: typeof fetch;
}

const pendingInstalls = new Map<string, Promise<ComputerDriverProvisionState>>();

function driverFileName(platformKey: string): string {
  return platformKey.startsWith("win32-") ? "cua-driver.exe" : "cua-driver";
}

function describeMismatch(pin: ComputerDriverPin, bytes: Uint8Array): string | null {
  if (bytes.byteLength !== pin.byteLength) {
    return `expected ${pin.byteLength} bytes, received ${bytes.byteLength}`;
  }
  const actual = sha256Hex(bytes);
  if (actual !== pin.sha256) {
    return `expected sha256 ${pin.sha256}, received ${actual}`;
  }
  return null;
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function pruneOtherVersions(driverRoot: string, keepVersion: string, logger: Pick<HostDaemonLogger, "warn">): Promise<void> {
  let entries;
  try {
    entries = await readdir(driverRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const stale = entries
    .filter((entry) => entry.isDirectory() && entry.name !== keepVersion)
    .map((entry) => join(driverRoot, entry.name));
  const results = await Promise.allSettled(stale.map((path) => rm(path, { recursive: true, force: true })));
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    logger.warn({ path: stale[index], err: result.reason }, "Failed to prune stale cua-driver install");
  });
}

export async function ensureProvisionedDriver(
  args: EnsureProvisionedDriverArgs,
): Promise<ComputerDriverProvisionState> {
  const platformKey = args.platformKey ?? computerDriverPlatformKey();
  const pin = COMPUTER_DRIVER_PINS[platformKey];
  if (pin === undefined) return { status: "unpinned" };
  const key = `${args.dataDir}\0${platformKey}\0${pin.version}`;
  const pending = pendingInstalls.get(key);
  if (pending !== undefined) return pending;
  const install = ensureProvisionedDriverUnlocked(args, platformKey, pin).finally(() => {
    pendingInstalls.delete(key);
  });
  pendingInstalls.set(key, install);
  return install;
}

async function ensureProvisionedDriverUnlocked(
  args: EnsureProvisionedDriverArgs,
  platformKey: string,
  pin: ComputerDriverPin,
): Promise<ComputerDriverProvisionState> {
  const driverRoot = join(args.dataDir, "computer", "driver");
  const versionDir = join(driverRoot, pin.version, platformKey);
  const binaryPath = join(versionDir, driverFileName(platformKey));

  if (await isExecutable(binaryPath)) {
    await pruneOtherVersions(driverRoot, pin.version, args.logger);
    return { status: "installed", path: binaryPath };
  }

  const doFetch = args.fetchImpl ?? fetch;
  args.logger.debug({ dataDir: args.dataDir, version: pin.version, platformKey }, "Downloading cua-driver");
  await mkdir(versionDir, { recursive: true });
  let lastMismatch = "unknown mismatch";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let bytes: Uint8Array;
    try {
      const response = await doFetch(pin.url);
      if (!response.ok) {
        return { status: "failed", message: `cua-driver download failed with HTTP ${response.status}` };
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return {
        status: "failed",
        message: `cua-driver download failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const mismatch = describeMismatch(pin, bytes);
    if (mismatch !== null) {
      lastMismatch = mismatch;
      continue;
    }
    const staged = join(versionDir, `.staged-${randomUUID()}.tmp`);
    try {
      await writeFile(staged, bytes, { mode: 0o755 });
      await rename(staged, binaryPath);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
    if (!(await isExecutable(binaryPath))) {
      return { status: "permissions-missing", path: binaryPath };
    }
    await pruneOtherVersions(driverRoot, pin.version, args.logger);
    return { status: "installed", path: binaryPath };
  }
  return {
    status: "failed",
    message: `cua-driver download failed verification after retry: ${lastMismatch}`,
  };
}
