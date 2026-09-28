import { constants } from "node:fs";
import { access, chmod, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { sha256Hex } from "../sha256-hex.js";
import { spawn as nodeSpawn } from "node:child_process";
import { extractArchive, type ArchiveSpawnFn } from "./computer-driver-archive.js";
import {
  assembleDarwinAppBundle,
  bundledComputerIconPath,
  darwinBundleBinaryPath,
  isDarwinPlatformKey,
  repairDarwinBundle,
} from "./computer-driver-bundle.js";
import type { HostDaemonLogger } from "../logger.js";

export interface ComputerDriverPin {
  readonly version: string;
  readonly asset: string;
  readonly sha256: string;
}

const CUA_DRIVER_REPO = "trycua/cua";

export function computerDriverDownloadUrl(pin: ComputerDriverPin): string {
  return `https://github.com/${CUA_DRIVER_REPO}/releases/download/cua-driver-rs-v${pin.version}/${pin.asset}`;
}

const DRIVER_VERSION = "0.30.2";

function pin(asset: string, sha256: string): ComputerDriverPin {
  return { version: DRIVER_VERSION, asset, sha256 };
}

const DARWIN_UNIVERSAL_PIN = pin(
  "cua-driver-rs-0.30.2-darwin-universal-binary.tar.gz",
  "b545f63b746dc87004836c316245a1b5769ad5373ac6d7737996308042af7eed",
);

export const COMPUTER_DRIVER_PINS: Partial<Record<string, ComputerDriverPin>> = {
  "linux-x64": pin(
    "cua-driver-rs-0.30.2-linux-x86_64-binary.tar.gz",
    "3b05920e412717be150b9629b96c1817499088ec779cadc13700d07084abe504",
  ),
  "linux-arm64": pin(
    "cua-driver-rs-0.30.2-linux-arm64-binary.tar.gz",
    "11573eed8e7ce16cad97212ebedacc1b911a9e20192b09551cff8795482cee8a",
  ),
  "darwin-x64": DARWIN_UNIVERSAL_PIN,
  "darwin-arm64": DARWIN_UNIVERSAL_PIN,
  "win32-x64": pin(
    "cua-driver-rs-0.30.2-windows-x86_64-binary.zip",
    "bbf9909b92cf57e6faf0edc3542cff2accd52096e34d56baadcf1a2340c8ec2d",
  ),
  "win32-arm64": pin(
    "cua-driver-rs-0.30.2-windows-arm64-binary.zip",
    "5697c6479b3972e00472172d8a698ca07f2809fa3567ba8899d3d89d1356dfaa",
  ),
};

export function computerDriverPlatformKey(
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  return `${platform}-${arch}`;
}

export type ComputerDriverProvisionState =
  | { readonly status: "unpinned" }
  | { readonly status: "installed"; readonly path: string; readonly changed?: boolean }
  | { readonly status: "permissions-missing"; readonly path: string }
  | { readonly status: "failed"; readonly message: string };

interface EnsureProvisionedDriverArgs {
  readonly dataDir: string;
  readonly logger: Pick<HostDaemonLogger, "debug" | "warn">;
  readonly platformKey?: string;
  readonly fetchImpl?: typeof fetch;
  readonly spawnImpl?: ArchiveSpawnFn;
  readonly pins?: Partial<Record<string, ComputerDriverPin>>;
  readonly iconPath?: string | null;
  readonly signBundle?: boolean;
}

const pendingInstalls = new Map<string, Promise<ComputerDriverProvisionState>>();

function driverFileName(platformKey: string): string {
  return platformKey.startsWith("win32-") ? "cua-driver.exe" : "cua-driver";
}

export function installedDriverBinaryPath(root: string, platformKey: string): string {
  return isDarwinPlatformKey(platformKey) ? darwinBundleBinaryPath(root) : join(root, driverFileName(platformKey));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
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
  const pinned = (args.pins ?? COMPUTER_DRIVER_PINS)[platformKey];
  if (pinned === undefined) return { status: "unpinned" };
  const key = `${args.dataDir}\0${platformKey}\0${pinned.version}`;
  const pending = pendingInstalls.get(key);
  if (pending !== undefined) return pending;
  const install = ensureProvisionedDriverUnlocked(args, platformKey, pinned).finally(() => {
    pendingInstalls.delete(key);
  });
  pendingInstalls.set(key, install);
  return install;
}

async function downloadAndVerify(
  args: EnsureProvisionedDriverArgs,
  pinned: ComputerDriverPin,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }> {
  const doFetch = args.fetchImpl ?? fetch;
  const url = computerDriverDownloadUrl(pinned);
  let lastMismatch = "unknown mismatch";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let bytes: Uint8Array;
    try {
      const response = await doFetch(url);
      if (!response.ok) {
        return { ok: false, message: `The bb computer driver download failed with HTTP ${response.status}` };
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return { ok: false, message: `The bb computer driver download failed: ${errorMessage(error)}` };
    }
    const actual = sha256Hex(bytes);
    if (actual === pinned.sha256) return { ok: true, bytes };
    lastMismatch = `expected sha256 ${pinned.sha256}, received ${actual}`;
  }
  return { ok: false, message: `The bb computer driver download failed verification after retry: ${lastMismatch}` };
}

async function ensureProvisionedDriverUnlocked(
  args: EnsureProvisionedDriverArgs,
  platformKey: string,
  pinned: ComputerDriverPin,
): Promise<ComputerDriverProvisionState> {
  const computerRoot = join(args.dataDir, "computer");
  const driverRoot = join(computerRoot, "driver");
  const versionDir = join(driverRoot, pinned.version, platformKey);
  const binaryPath = installedDriverBinaryPath(versionDir, platformKey);

  if (await isExecutable(binaryPath)) {
    let changed = false;
    if (isDarwinPlatformKey(platformKey)) {
      changed = await repairDarwinBundle({
        binaryPath,
        version: pinned.version,
        iconPath: args.iconPath === undefined ? await bundledComputerIconPath() : args.iconPath,
        spawnImpl: args.spawnImpl ?? nodeSpawn,
        logger: args.logger,
        sign: args.signBundle,
      }).catch((error: unknown) => {
        args.logger.warn({ err: error }, "Could not repair the computer driver bundle");
        return false;
      });
    }
    await pruneOtherVersions(driverRoot, pinned.version, args.logger);
    return { status: "installed", path: binaryPath, changed };
  }

  args.logger.debug(
    { dataDir: args.dataDir, version: pinned.version, platformKey },
    "Downloading cua-driver",
  );

  const stagingDir = join(computerRoot, "staging", randomUUID());
  try {
    await mkdir(stagingDir, { recursive: true });

    const downloaded = await downloadAndVerify(args, pinned);
    if (!downloaded.ok) return { status: "failed", message: downloaded.message };

    const archivePath = join(stagingDir, pinned.asset);
    await writeFile(archivePath, downloaded.bytes);

    const extractDir = join(stagingDir, "extracted");
    await mkdir(extractDir, { recursive: true });
    try {
      await extractArchive(archivePath, extractDir, args.spawnImpl);
    } catch (error) {
      return { status: "failed", message: `The bb computer driver extraction failed: ${errorMessage(error)}` };
    }

    if (!(await pathExists(join(extractDir, driverFileName(platformKey))))) {
      return {
        status: "failed",
        message: `The bb computer driver archive did not contain ${driverFileName(platformKey)}`,
      };
    }
    const extractedBinary = isDarwinPlatformKey(platformKey)
      ? await assembleDarwinAppBundle({
          extractDir,
          version: pinned.version,
          iconPath: args.iconPath === undefined ? await bundledComputerIconPath() : args.iconPath,
          spawnImpl: args.spawnImpl ?? nodeSpawn,
          logger: args.logger,
          sign: args.signBundle,
        })
      : join(extractDir, driverFileName(platformKey));
    await chmod(extractedBinary, 0o755).catch(() => {});

    await mkdir(join(driverRoot, pinned.version), { recursive: true });
    await rm(versionDir, { recursive: true, force: true });
    await rename(extractDir, versionDir);

    if (!(await isExecutable(binaryPath))) {
      return { status: "permissions-missing", path: binaryPath };
    }
    await pruneOtherVersions(driverRoot, pinned.version, args.logger);
    return { status: "installed", path: binaryPath };
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}
