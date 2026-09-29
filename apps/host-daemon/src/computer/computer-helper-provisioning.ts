import { access, chmod, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { join } from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { sha256Hex } from "../sha256-hex.js";
import { extractArchive, type ArchiveSpawnFn } from "./computer-driver-archive.js";
import type { HostDaemonLogger } from "../logger.js";

/**
 * bb Computer.app's native helper: the responsible macOS process for the
 * Computer feature's Accessibility/Screen Recording grants (see
 * apps/computer-macos). Published as a checksummed release asset from this
 * repo, the same way COMPUTER_DRIVER_PINS pins the vendored cua-driver.
 *
 * COMPUTER_HELPER_PINS is intentionally empty until CI (see
 * .github/workflows/build-computer-helper.yml) publishes the first signed
 * release asset and this file is updated with its real sha256. Until then,
 * ensureProvisionedComputerHelper always reports "unpinned" and callers fall
 * back to the legacy cua-driver-only bb Computer.app bundle.
 */
export interface ComputerHelperPin {
  readonly version: string;
  readonly asset: string;
  readonly sha256: string;
}

const COMPUTER_HELPER_RELEASE_REPO = "hellogafaro/bb";

export function computerHelperDownloadUrl(pin: ComputerHelperPin): string {
  return `https://github.com/${COMPUTER_HELPER_RELEASE_REPO}/releases/download/computer-helper-v${pin.version}/${pin.asset}`;
}

export const COMPUTER_HELPER_PINS: Partial<Record<string, ComputerHelperPin>> = {};

export const COMPUTER_HELPER_EXECUTABLE = "bb-computer-helper";

export type ComputerHelperProvisionState =
  | { readonly status: "unpinned" }
  | { readonly status: "installed"; readonly path: string }
  | { readonly status: "permissions-missing"; readonly path: string }
  | { readonly status: "failed"; readonly message: string };

interface EnsureProvisionedComputerHelperArgs {
  readonly dataDir: string;
  readonly logger: Pick<HostDaemonLogger, "debug" | "warn">;
  readonly platformKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly spawnImpl?: ArchiveSpawnFn;
  readonly pins?: Partial<Record<string, ComputerHelperPin>>;
}

const pendingInstalls = new Map<string, Promise<ComputerHelperProvisionState>>();

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

async function pruneOtherVersions(root: string, keepVersion: string, logger: Pick<HostDaemonLogger, "warn">): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  const stale = entries
    .filter((entry) => entry.isDirectory() && entry.name !== keepVersion)
    .map((entry) => join(root, entry.name));
  const results = await Promise.allSettled(stale.map((path) => rm(path, { recursive: true, force: true })));
  results.forEach((result, index) => {
    if (result.status === "fulfilled") return;
    logger.warn({ path: stale[index], err: result.reason }, "Failed to prune stale bb-computer-helper install");
  });
}

async function downloadAndVerify(
  args: EnsureProvisionedComputerHelperArgs,
  pinned: ComputerHelperPin,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; message: string }> {
  const doFetch = args.fetchImpl ?? fetch;
  const url = computerHelperDownloadUrl(pinned);
  let lastMismatch = "unknown mismatch";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let bytes: Uint8Array;
    try {
      const response = await doFetch(url);
      if (!response.ok) {
        return { ok: false, message: `The bb Computer helper download failed with HTTP ${response.status}` };
      }
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (error) {
      return { ok: false, message: `The bb Computer helper download failed: ${errorMessage(error)}` };
    }
    const actual = sha256Hex(bytes);
    if (actual === pinned.sha256) return { ok: true, bytes };
    lastMismatch = `expected sha256 ${pinned.sha256}, received ${actual}`;
  }
  return { ok: false, message: `The bb Computer helper download failed verification after retry: ${lastMismatch}` };
}

export function installedComputerHelperPath(root: string): string {
  return join(root, COMPUTER_HELPER_EXECUTABLE);
}

export async function ensureProvisionedComputerHelper(
  args: EnsureProvisionedComputerHelperArgs,
): Promise<ComputerHelperProvisionState> {
  const pinned = (args.pins ?? COMPUTER_HELPER_PINS)[args.platformKey];
  if (pinned === undefined) return { status: "unpinned" };
  const key = `${args.dataDir}\0${args.platformKey}\0${pinned.version}`;
  const pending = pendingInstalls.get(key);
  if (pending !== undefined) return pending;
  const install = ensureProvisionedComputerHelperUnlocked(args, pinned).finally(() => {
    pendingInstalls.delete(key);
  });
  pendingInstalls.set(key, install);
  return install;
}

async function ensureProvisionedComputerHelperUnlocked(
  args: EnsureProvisionedComputerHelperArgs,
  pinned: ComputerHelperPin,
): Promise<ComputerHelperProvisionState> {
  const root = join(args.dataDir, "computer", "computer-app");
  const versionDir = join(root, pinned.version, args.platformKey);
  const binaryPath = installedComputerHelperPath(versionDir);

  if (await isExecutable(binaryPath)) {
    await pruneOtherVersions(root, pinned.version, args.logger);
    return { status: "installed", path: binaryPath };
  }

  args.logger.debug({ dataDir: args.dataDir, version: pinned.version, platformKey: args.platformKey }, "Downloading bb-computer-helper");

  const stagingDir = join(args.dataDir, "computer", "staging", randomUUID());
  try {
    await mkdir(stagingDir, { recursive: true });
    const downloaded = await downloadAndVerify(args, pinned);
    if (!downloaded.ok) return { status: "failed", message: downloaded.message };

    const archivePath = join(stagingDir, pinned.asset);
    await writeFile(archivePath, downloaded.bytes);

    const extractDir = join(stagingDir, "extracted");
    await mkdir(extractDir, { recursive: true });
    try {
      await extractArchive(archivePath, extractDir, args.spawnImpl ?? nodeSpawn);
    } catch (error) {
      return { status: "failed", message: `The bb Computer helper extraction failed: ${errorMessage(error)}` };
    }

    if (!(await pathExists(join(extractDir, COMPUTER_HELPER_EXECUTABLE)))) {
      return { status: "failed", message: `The bb Computer helper archive did not contain ${COMPUTER_HELPER_EXECUTABLE}` };
    }
    await chmod(join(extractDir, COMPUTER_HELPER_EXECUTABLE), 0o755).catch(() => {});

    await mkdir(join(root, pinned.version), { recursive: true });
    await rm(versionDir, { recursive: true, force: true });
    await rename(extractDir, versionDir);

    if (!(await isExecutable(binaryPath))) {
      return { status: "permissions-missing", path: binaryPath };
    }
    await pruneOtherVersions(root, pinned.version, args.logger);
    return { status: "installed", path: binaryPath };
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
  }
}
