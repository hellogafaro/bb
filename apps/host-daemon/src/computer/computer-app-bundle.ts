import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ArchiveSpawnFn } from "./computer-driver-archive.js";
import type { HostDaemonLogger } from "../logger.js";
import { COMPUTER_APP_DISPLAY_NAME, COMPUTER_APP_ICON_FILE } from "./computer-driver-bundle.js";
import { COMPUTER_HELPER_EXECUTABLE } from "./computer-helper-provisioning.js";

export const COMPUTER_APP_HELPER_BUNDLE_ID = "app.getbb.computer";
const BUNDLE_NAME = `${COMPUTER_APP_DISPLAY_NAME}.app`;
const DRIVER_EXECUTABLE = "cua-driver";

export function computerAppHelperInfoPlist(version: string): string {
  const entries: [string, string][] = [
    ["CFBundleDevelopmentRegion", "<string>en</string>"],
    ["CFBundleDisplayName", `<string>${COMPUTER_APP_DISPLAY_NAME}</string>`],
    ["CFBundleExecutable", `<string>${COMPUTER_HELPER_EXECUTABLE}</string>`],
    ["CFBundleIconFile", "<string>bb</string>"],
    ["CFBundleIdentifier", `<string>${COMPUTER_APP_HELPER_BUNDLE_ID}</string>`],
    ["CFBundleInfoDictionaryVersion", "<string>6.0</string>"],
    ["CFBundleName", `<string>${COMPUTER_APP_DISPLAY_NAME}</string>`],
    ["CFBundlePackageType", "<string>APPL</string>"],
    ["CFBundleShortVersionString", `<string>${version}</string>`],
    ["CFBundleVersion", `<string>${version}</string>`],
    ["LSMinimumSystemVersion", "<string>13.0</string>"],
    ["LSUIElement", "<true/>"],
    ["NSHighResolutionCapable", "<true/>"],
  ];
  const body = entries.map(([key, value]) => `\t<key>${key}</key>\n\t${value}`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
}

export function computerAppHelperExecutablePath(root: string): string {
  return join(root, BUNDLE_NAME, "Contents", "MacOS", COMPUTER_HELPER_EXECUTABLE);
}

export function computerAppDriverExecutablePath(root: string): string {
  return join(root, BUNDLE_NAME, "Contents", "MacOS", DRIVER_EXECUTABLE);
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

export interface AssembleComputerAppBundleArgs {
  readonly root: string;
  readonly helperVersion: string;
  readonly helperBinaryPath: string;
  readonly driverBinaryDir: string;
  readonly iconPath: string | null;
  readonly spawnImpl: ArchiveSpawnFn;
  readonly logger: Pick<HostDaemonLogger, "warn">;
  readonly sign?: boolean;
}

export async function assembleComputerAppBundle(args: AssembleComputerAppBundleArgs): Promise<{ changed: boolean }> {
  const bundleDir = join(args.root, BUNDLE_NAME);
  const contentsDir = join(bundleDir, "Contents");
  const macosDir = join(contentsDir, "MacOS");
  const resourcesDir = join(contentsDir, "Resources");
  await mkdir(macosDir, { recursive: true });
  await mkdir(resourcesDir, { recursive: true });

  let changed = false;

  const plistPath = join(contentsDir, "Info.plist");
  const expectedPlist = computerAppHelperInfoPlist(args.helperVersion);
  const currentPlist = await readFile(plistPath, "utf8").catch(() => null);
  if (currentPlist !== expectedPlist) {
    await writeFile(plistPath, expectedPlist);
    await writeFile(join(contentsDir, "PkgInfo"), "APPL????");
    changed = true;
  }

  if (await copyIfDifferent(args.helperBinaryPath, join(macosDir, COMPUTER_HELPER_EXECUTABLE))) changed = true;

  for (const entry of await readdir(args.driverBinaryDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (await copyIfDifferent(join(args.driverBinaryDir, entry.name), join(macosDir, entry.name))) changed = true;
  }

  if (args.iconPath !== null) {
    const iconTarget = join(resourcesDir, "bb.icns");
    const hasIcon = await access(iconTarget).then(() => true, () => false);
    if (!hasIcon) {
      await copyFile(args.iconPath, iconTarget);
      changed = true;
    }
  }

  if (changed && (args.sign ?? true)) {
    const signed = await runCommand(args.spawnImpl, "codesign", ["--force", "--deep", "--sign", "-", bundleDir]);
    if (signed.code !== 0) {
      args.logger.warn({ code: signed.code, stderr: signed.stderr }, "Ad-hoc signing of the bb Computer app bundle failed");
    }
  }

  return { changed };
}

async function copyIfDifferent(source: string, target: string): Promise<boolean> {
  const sourceStat = await stat(source).catch(() => null);
  if (sourceStat === null) return false;
  const targetStat = await stat(target).catch(() => null);
  if (targetStat !== null && targetStat.size === sourceStat.size) return false;
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  return true;
}

export { COMPUTER_APP_ICON_FILE };
