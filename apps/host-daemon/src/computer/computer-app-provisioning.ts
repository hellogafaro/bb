import { dirname } from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import type { HostDaemonLogger } from "../logger.js";
import { ensureProvisionedDriver, type ComputerDriverPin } from "./computer-driver-provisioning.js";
import { bundledComputerIconPath, isDarwinPlatformKey } from "./computer-driver-bundle.js";
import { ensureProvisionedComputerHelper, type ComputerHelperPin } from "./computer-helper-provisioning.js";
import { assembleComputerAppBundle, computerAppHelperExecutablePath } from "./computer-app-bundle.js";

export type ComputerAppState =
  | { readonly kind: "legacy"; readonly driverPath: string }
  | {
      readonly kind: "embedded";
      readonly driverPath: string;
      readonly bundleDir: string;
      readonly helperExecutablePath: string;
      readonly changed: boolean;
    }
  | { readonly kind: "failed"; readonly message: string };

interface EnsureProvisionedComputerAppArgs {
  readonly dataDir: string;
  readonly logger: Pick<HostDaemonLogger, "debug" | "warn">;
  readonly platformKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly driverPins?: Partial<Record<string, ComputerDriverPin>>;
  readonly helperPins?: Partial<Record<string, ComputerHelperPin>>;
  readonly signBundle?: boolean;
}

export async function ensureProvisionedComputerApp(args: EnsureProvisionedComputerAppArgs): Promise<ComputerAppState> {
  const driver = await ensureProvisionedDriver({
    dataDir: args.dataDir,
    logger: args.logger,
    platformKey: args.platformKey,
    fetchImpl: args.fetchImpl,
    pins: args.driverPins,
  });
  if (driver.status !== "installed") {
    return driver.status === "failed"
      ? { kind: "failed", message: driver.message }
      : { kind: "failed", message: `The bb computer driver is not installed (${driver.status})` };
  }

  if (!isDarwinPlatformKey(args.platformKey)) {
    return { kind: "legacy", driverPath: driver.path };
  }

  const helper = await ensureProvisionedComputerHelper({
    dataDir: args.dataDir,
    logger: args.logger,
    platformKey: args.platformKey,
    fetchImpl: args.fetchImpl,
    pins: args.helperPins,
  });
  if (helper.status !== "installed") {
    return { kind: "legacy", driverPath: driver.path };
  }

  const helperVersionRoot = dirname(helper.path);
  const helperVersion = dirname(helperVersionRoot).split("/").pop() ?? "0";

  const { changed } = await assembleComputerAppBundle({
    root: helperVersionRoot,
    helperVersion,
    helperBinaryPath: helper.path,
    driverBinaryDir: dirname(driver.path),
    iconPath: await bundledComputerIconPath(),
    spawnImpl: nodeSpawn,
    logger: args.logger,
    sign: args.signBundle,
  });

  const bundleRoot = helperVersionRoot;
  return {
    kind: "embedded",
    driverPath: driver.path,
    bundleDir: `${bundleRoot}/bb Computer.app`,
    helperExecutablePath: computerAppHelperExecutablePath(bundleRoot),
    changed,
  };
}
