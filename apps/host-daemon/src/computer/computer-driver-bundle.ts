import { access, copyFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ArchiveSpawnFn } from "./computer-driver-archive.js";
import type { HostDaemonLogger } from "../logger.js";

export const COMPUTER_APP_BUNDLE_ID = "com.trycua.driver";
export const COMPUTER_APP_BUNDLE_NAME = "bb.app";
export const COMPUTER_APP_ICON_FILE = "bb-computer.icns";
const BUNDLE_EXECUTABLE = "cua-driver";

export function isDarwinPlatformKey(platformKey: string): boolean {
  return platformKey.startsWith("darwin-");
}

export function darwinBundleBinaryPath(root: string): string {
  return join(root, COMPUTER_APP_BUNDLE_NAME, "Contents", "MacOS", BUNDLE_EXECUTABLE);
}

export function appBundlePathForBinary(binaryPath: string): string | null {
  const marker = `${sep}Contents${sep}MacOS${sep}`;
  const index = binaryPath.lastIndexOf(marker);
  if (index === -1) return null;
  const bundle = binaryPath.slice(0, index);
  return bundle.endsWith(".app") ? bundle : null;
}

export function computerAppInfoPlist(version: string): string {
  const entries: [string, string][] = [
    ["CFBundleDevelopmentRegion", "<string>en</string>"],
    ["CFBundleDisplayName", "<string>bb</string>"],
    ["CFBundleExecutable", `<string>${BUNDLE_EXECUTABLE}</string>`],
    ["CFBundleIconFile", "<string>bb</string>"],
    ["CFBundleIdentifier", `<string>${COMPUTER_APP_BUNDLE_ID}</string>`],
    ["CFBundleInfoDictionaryVersion", "<string>6.0</string>"],
    ["CFBundleName", "<string>bb</string>"],
    ["CFBundlePackageType", "<string>APPL</string>"],
    ["CFBundleShortVersionString", `<string>${version}</string>`],
    ["CFBundleVersion", `<string>${version}</string>`],
    ["LSMinimumSystemVersion", "<string>12.0</string>"],
    ["LSUIElement", "<true/>"],
    ["NSHighResolutionCapable", "<true/>"],
  ];
  const body = entries.map(([key, value]) => `\t<key>${key}</key>\n\t${value}`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
}

export async function bundledComputerIconPath(): Promise<string | null> {
  const candidate = join(dirname(fileURLToPath(import.meta.url)), COMPUTER_APP_ICON_FILE);
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

function runCommand(spawnImpl: ArchiveSpawnFn, command: string, args: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawnImpl(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(0, 2_000);
    });
    child.on("error", (error) => resolve({ code: null, stderr: error.message }));
    child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
  });
}

export async function repairDarwinBundle(args: {
  readonly binaryPath: string;
  readonly version: string;
  readonly iconPath: string | null;
  readonly spawnImpl: ArchiveSpawnFn;
  readonly logger: Pick<HostDaemonLogger, "warn">;
  readonly sign?: boolean;
}): Promise<boolean> {
  const bundleDir = appBundlePathForBinary(args.binaryPath);
  if (bundleDir === null) return false;
  let changed = false;
  const plistPath = join(bundleDir, "Contents", "Info.plist");
  const expectedPlist = computerAppInfoPlist(args.version);
  const currentPlist = await readFile(plistPath, "utf8").catch(() => null);
  if (currentPlist !== expectedPlist) {
    await writeFile(plistPath, expectedPlist);
    changed = true;
  }
  if (args.iconPath !== null) {
    const iconTarget = join(bundleDir, "Contents", "Resources", "bb.icns");
    const hasIcon = await access(iconTarget).then(() => true, () => false);
    if (!hasIcon) {
      await mkdir(dirname(iconTarget), { recursive: true });
      await copyFile(args.iconPath, iconTarget);
      changed = true;
    }
  }
  if (changed && (args.sign ?? true)) {
    const signed = await runCommand(args.spawnImpl, "codesign", ["--force", "--deep", "--sign", "-", bundleDir]);
    if (signed.code !== 0) {
      args.logger.warn({ code: signed.code, stderr: signed.stderr }, "Ad-hoc signing of the computer driver bundle failed");
    }
  }
  return changed;
}

export async function assembleDarwinAppBundle(args: {
  readonly extractDir: string;
  readonly version: string;
  readonly iconPath: string | null;
  readonly spawnImpl: ArchiveSpawnFn;
  readonly logger: Pick<HostDaemonLogger, "warn">;
  readonly sign?: boolean;
}): Promise<string> {
  const bundleDir = join(args.extractDir, COMPUTER_APP_BUNDLE_NAME);
  const contentsDir = join(bundleDir, "Contents");
  const macosDir = join(contentsDir, "MacOS");
  const resourcesDir = join(contentsDir, "Resources");
  await mkdir(macosDir, { recursive: true });
  await mkdir(resourcesDir, { recursive: true });
  for (const entry of await readdir(args.extractDir)) {
    if (entry === COMPUTER_APP_BUNDLE_NAME) continue;
    await rename(join(args.extractDir, entry), join(macosDir, entry));
  }
  await writeFile(join(contentsDir, "Info.plist"), computerAppInfoPlist(args.version));
  await writeFile(join(contentsDir, "PkgInfo"), "APPL????");
  if (args.iconPath !== null) {
    await copyFile(args.iconPath, join(resourcesDir, "bb.icns")).catch((error: unknown) => {
      args.logger.warn({ err: error }, "Could not copy the bb icon into the computer driver bundle");
    });
  }
  if (args.sign ?? true) {
    const signed = await runCommand(args.spawnImpl, "codesign", ["--force", "--deep", "--sign", "-", bundleDir]);
    if (signed.code !== 0) {
      args.logger.warn({ code: signed.code, stderr: signed.stderr }, "Ad-hoc signing of the computer driver bundle failed");
    }
  }
  return join(macosDir, BUNDLE_EXECUTABLE);
}
