import { constants } from "node:fs";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ComputerActionOutcome,
  ComputerCaptureImage,
  ComputerDoctorProbe,
  ComputerDoctorReport,
  ComputerObservation,
  ComputerFrame,
  ComputerHumanInput,
  ComputerKeyModifier,
  ComputerLiveProfile,
  ComputerLiveState,
  ComputerOperation,
} from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "../logger.js";
import {
  content,
  CuaError,
  cuaEnv,
  extractDesktopImage,
  extractMcpImage,
  RenewingCuaTransport,
  type CuaTransport,
} from "./computer-transport.js";
import { appBundlePathForBinary, COMPUTER_APP_BUNDLE_ID } from "./computer-driver-bundle.js";
import { COMPUTER_APP_HELPER_BUNDLE_ID } from "./computer-app-bundle.js";
import {
  MACOS_PRIVACY_PANES,
  MACOS_TCC_SERVICES,
  parseComputerPermissionStatus,
  parseHealthPermissionStatus,
  type ComputerPermissionState,
  type ComputerPermissionStatus,
} from "./computer-permissions.js";
import { computerDriverPlatformKey, ensureProvisionedDriver } from "./computer-driver-provisioning.js";
import { ensureProvisionedComputerApp, type ComputerAppState } from "./computer-app-provisioning.js";
import { PersistentCuaTransport } from "./computer-driver-session.js";
import { DriverCaptureFrameSource, desktopCapture, LiveStream, type ComputerFrameSource } from "./computer-live.js";
import {
  buildCapabilityManifest,
  MANIFEST_EXPIRES_AFTER_MS,
  MANIFEST_IDLE_TIMEOUT_MS,
  PathGrantSet,
  WindowGrantSet,
} from "./computer-manifest.js";
import { findWindow, TargetTable } from "./computer-target-table.js";

export type SpawnFn = typeof nodeSpawn;

function daemonEnv(): Record<string, string> {
  return cuaEnv({
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DISPLAY: process.env.DISPLAY ?? ":99",
    WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY,
    XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    DBUS_SESSION_BUS_ADDRESS:
      process.env.DBUS_SESSION_BUS_ADDRESS ?? `unix:path=${homedir()}/.cache/at-spi/bus`,
    XAUTHORITY: process.env.XAUTHORITY ?? "/run/bb-xvfb/Xauthority",
  });
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function candidateBinaryPaths(dataDir: string): string[] {
  return [
    join(homedir(), ".local", "bin", "cua-driver"),
    "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
    "/opt/homebrew/bin/cua-driver",
    "/usr/local/bin/cua-driver",
    join(dataDir, "runtime", "cua-driver"),
  ];
}

interface BinaryResolution {
  readonly path: string;
  readonly tried: readonly string[];
  readonly missing: boolean;
  readonly permissionsMissing: boolean;
}

const PERMISSION_MODE = process.env.CUA_DRIVER_PERMISSION_MODE ?? "bounded";

function permissionProbe(
  id: "accessibility" | "screen-recording",
  label: string,
  state: ComputerPermissionState,
): ComputerDoctorProbe {
  return {
    id,
    label,
    status: state === "granted" ? "ok" : "setup-required",
    message:
      state === "granted"
        ? "Granted"
        : state === "denied"
          ? "Not granted"
          : "Not granted",
  };
}

export interface ManifestRenewalOptions {
  readonly expiresAfterMs?: number;
  readonly idleTimeoutMs?: number;
  readonly marginMs?: number;
  readonly now?: () => number;
}

interface ResolvedManifestRenewalOptions {
  readonly expiresAfterMs: number;
  readonly idleTimeoutMs: number;
  readonly marginMs: number;
  readonly now: () => number;
}

const DEFAULT_RENEWAL_MARGIN_MS = 5 * 60 * 1000;

function resolveManifestRenewal(options: ManifestRenewalOptions | undefined): ResolvedManifestRenewalOptions {
  return {
    expiresAfterMs: options?.expiresAfterMs ?? MANIFEST_EXPIRES_AFTER_MS,
    idleTimeoutMs: options?.idleTimeoutMs ?? MANIFEST_IDLE_TIMEOUT_MS,
    marginMs: options?.marginMs ?? DEFAULT_RENEWAL_MARGIN_MS,
    now: options?.now ?? Date.now,
  };
}

class DriverController {
  #spawnProcess: SpawnFn;
  #logger: Pick<HostDaemonLogger, "debug" | "warn">;
  #fetchImpl: typeof fetch | undefined;
  #platform: NodeJS.Platform;
  #daemonProcess: ChildProcess | null = null;
  #windowGrants = new WindowGrantSet();
  #runDirGrants = new PathGrantSet();
  #resolutionCache = new Map<string, Promise<BinaryResolution>>();
  #computerAppCache = new Map<string, Promise<ComputerAppState>>();
  #restartRequired = true;
  #stoppedListeners = new Set<() => void>();
  #renewal: ResolvedManifestRenewalOptions;
  #manifestWrittenAt: number | null = null;
  #lastCallAt: number | null = null;
  #renewalInFlight: Promise<void> | null = null;
  #computerAppFactory: ((dataDir: string) => Promise<ComputerAppState>) | undefined;

  constructor(
    spawnProcess: SpawnFn,
    logger: Pick<HostDaemonLogger, "debug" | "warn">,
    fetchImpl?: typeof fetch,
    platform: NodeJS.Platform = process.platform,
    manifestRenewal?: ManifestRenewalOptions,
    computerAppFactory?: (dataDir: string) => Promise<ComputerAppState>,
  ) {
    this.#spawnProcess = spawnProcess;
    this.#logger = logger;
    this.#fetchImpl = fetchImpl;
    this.#platform = platform;
    this.#renewal = resolveManifestRenewal(manifestRenewal);
    this.#computerAppFactory = computerAppFactory;
  }

  get windowGrants(): WindowGrantSet {
    return this.#windowGrants;
  }

  get runDirGrants(): PathGrantSet {
    return this.#runDirGrants;
  }

  async #resolveBinaryPath(dataDir: string): Promise<BinaryResolution> {
    const override = process.env.CUA_DRIVER_PATH;
    if (override !== undefined && override.length > 0) {
      return { path: override, tried: [override], missing: false, permissionsMissing: false };
    }
    let cached = this.#resolutionCache.get(dataDir);
    if (cached === undefined) {
      cached = (async () => {
        const provisioned = await ensureProvisionedDriver({
          dataDir,
          logger: this.#logger,
          fetchImpl: this.#fetchImpl,
        });
        if (provisioned.status === "installed") {
          if (provisioned.changed === true) {
            this.#restartRequired = true;
            if (this.#platform === "darwin") {
              for (const service of Object.values(MACOS_TCC_SERVICES)) {
                await this.#runQuiet("/usr/bin/tccutil", ["reset", service, COMPUTER_APP_BUNDLE_ID]);
              }
            }
          }
          return { path: provisioned.path, tried: [provisioned.path], missing: false, permissionsMissing: false };
        }
        if (provisioned.status === "permissions-missing") {
          return { path: provisioned.path, tried: [provisioned.path], missing: false, permissionsMissing: true };
        }
        const candidates = candidateBinaryPaths(dataDir);
        for (const candidate of candidates) {
          try {
            await access(candidate, constants.X_OK);
            return { path: candidate, tried: candidates, missing: false, permissionsMissing: false };
          } catch {}
        }
        return { path: "cua-driver", tried: candidates, missing: true, permissionsMissing: false };
      })();
      this.#resolutionCache.set(dataDir, cached);
    }
    return cached;
  }

  async binaryPath(dataDir: string): Promise<string> {
    return (await this.#resolveBinaryPath(dataDir)).path;
  }

  /**
   * Resolves whether darwin has a pinned bb-computer-helper release available
   * (see computer-app-provisioning.ts): when it does, the daemon spawns the
   * embedded-driver bb Computer.app so cua-driver inherits the helper's TCC
   * grants; otherwise it falls back to the existing cua-driver-only bundle.
   * A no-op ("legacy") on every non-darwin platform.
   */
  async #resolveComputerApp(dataDir: string): Promise<ComputerAppState> {
    if (this.#platform !== "darwin") return { kind: "legacy", driverPath: await this.binaryPath(dataDir) };
    let cached = this.#computerAppCache.get(dataDir);
    if (cached === undefined) {
      cached =
        this.#computerAppFactory?.(dataDir) ??
        ensureProvisionedComputerApp({
          dataDir,
          logger: this.#logger,
          platformKey: computerDriverPlatformKey(this.#platform),
          fetchImpl: this.#fetchImpl,
        });
      this.#computerAppCache.set(dataDir, cached);
    }
    return cached;
  }

  #embeddedDriverSocketPath(dataDir: string): string {
    return join(dataDir, "computer", "driver.sock");
  }

  #embeddedVideoSocketPath(dataDir: string): string {
    return join(dataDir, "computer", "video.sock");
  }

  async installDriver(dataDir: string): Promise<void> {
    this.#resolutionCache.delete(dataDir);
    this.#computerAppCache.delete(dataDir);
    await this.#resolveBinaryPath(dataDir);
  }

  async runProbe(dataDir: string, args: string[], stdin?: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    const resolution = await this.#resolveBinaryPath(dataDir);
    return new Promise((resolve) => {
      const child = this.#spawnProcess(resolution.path, args, { stdio: ["pipe", "pipe", "pipe"], env: daemonEnv() });
      let stdout = "";
      let stderr = "";
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        stdout = (stdout + chunk).slice(0, 200_000);
      });
      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (chunk: string) => {
        stderr = (stderr + chunk).slice(0, 4_000);
      });
      child.on("error", () => resolve({ code: null, stdout: "", stderr: "" }));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin?.end(stdin ?? "");
    });
  }

  async daemonRunning(dataDir: string): Promise<boolean> {
    const appState = await this.#resolveComputerApp(dataDir);
    if (appState.kind === "embedded") {
      return pathExists(this.#embeddedDriverSocketPath(dataDir));
    }
    const status = await this.runProbe(dataDir, ["status"]);
    return status.code === 0;
  }

  /** Extra CLI args needed to address the embedded daemon's private socket; empty on the legacy path. */
  async #daemonAddressArgs(dataDir: string): Promise<string[]> {
    const appState = await this.#resolveComputerApp(dataDir);
    return appState.kind === "embedded" ? ["--socket", this.#embeddedDriverSocketPath(dataDir), "--embedded"] : [];
  }

  #manifestPath(dataDir: string): string {
    return join(dataDir, "capability-manifest.json");
  }

  async #writeManifestFile(dataDir: string): Promise<void> {
    const manifest = buildCapabilityManifest({
      writablePaths: this.#runDirGrants.list(),
      windows: this.#windowGrants.list(),
    });
    await writeFile(this.#manifestPath(dataDir), JSON.stringify(manifest, null, 2));
    this.#manifestWrittenAt = this.#renewal.now();
    this.#lastCallAt = this.#manifestWrittenAt;
  }

  async ensureManifestFresh(dataDir: string): Promise<void> {
    if (this.#manifestWrittenAt === null) return;
    const now = this.#renewal.now();
    const age = now - this.#manifestWrittenAt;
    const idleSince = this.#lastCallAt ?? this.#manifestWrittenAt;
    const idle = now - idleSince;
    const ageLimit = this.#renewal.expiresAfterMs - this.#renewal.marginMs;
    const idleLimit = this.#renewal.idleTimeoutMs - this.#renewal.marginMs;
    if (age >= ageLimit || idle >= idleLimit) {
      await this.renewManifestAfterLapse(dataDir);
    }
  }

  async renewManifestAfterLapse(dataDir: string): Promise<void> {
    if (this.#renewalInFlight !== null) return this.#renewalInFlight;
    const renewing = (async () => {
      await this.#writeManifestFile(dataDir);
      await this.#stopDaemon(dataDir);
      await this.#spawnDaemon(dataDir);
    })();
    this.#renewalInFlight = renewing;
    try {
      await renewing;
    } finally {
      if (this.#renewalInFlight === renewing) this.#renewalInFlight = null;
    }
  }

  noteDriverCallSucceeded(): void {
    this.#lastCallAt = this.#renewal.now();
  }

  async #spawnDaemon(dataDir: string): Promise<void> {
    const appState = await this.#resolveComputerApp(dataDir);
    if (appState.kind === "embedded") {
      return this.#spawnEmbeddedDaemon(dataDir, appState);
    }
    const resolution = await this.#resolveBinaryPath(dataDir);
    const baseArgs =
      PERMISSION_MODE === "bounded"
        ? ["serve", "--permission-mode", "bounded", "--capability-manifest", this.#manifestPath(dataDir), "--approve-capability-manifest"]
        : ["serve", "--permission-mode", PERMISSION_MODE];
    const args = this.#platform === "darwin" ? [...baseArgs, "--no-permissions-gate"] : baseArgs;
    const spawnState: { failure: Error | null } = { failure: null };
    const bundle = appBundlePathForBinary(resolution.path);
    const child =
      bundle === null
        ? this.#spawnProcess(resolution.path, args, { stdio: "ignore", detached: true, env: daemonEnv() })
        : this.#spawnProcess("/usr/bin/open", ["-n", "-g", "-a", bundle, "--args", ...args], { stdio: "ignore", env: daemonEnv() });
    child.on("error", (error) => {
      spawnState.failure = error;
      if (this.#daemonProcess === child) this.#daemonProcess = null;
    });
    if (bundle !== null) {
      child.on("close", (code) => {
        if (code !== 0) spawnState.failure = new Error(`open exited with code ${code ?? "signal"} launching ${bundle}`);
      });
    }
    this.#daemonProcess = child;
    child.unref();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (spawnState.failure !== null) {
        const detail = resolution.missing
          ? `tried: ${resolution.tried.join(", ")}`
          : spawnState.failure.message;
        throw new CuaError(`The bb computer driver is unavailable: ${detail}`, "setup-required");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (await this.daemonRunning(dataDir)) return;
    }
    throw new CuaError("The bb computer driver did not start within 5 seconds", "setup-required");
  }

  /**
   * Spawns the embedded-driver bb Computer.app via LaunchServices, same as the
   * legacy path, so the HELPER (not the daemon) is the responsible process
   * LaunchServices attributes TCC grants to. The helper then spawns
   * `cua-driver serve --embedded` itself as a direct child, inheriting those
   * grants without a second prompt (see EMBEDDING.md in the vendor cua-driver
   * skill pack, and apps/computer-macos/Sources/BBComputerHelper).
   */
  async #spawnEmbeddedDaemon(dataDir: string, appState: Extract<ComputerAppState, { kind: "embedded" }>): Promise<void> {
    const driverSocket = this.#embeddedDriverSocketPath(dataDir);
    const videoSocket = this.#embeddedVideoSocketPath(dataDir);
    await mkdir(join(dataDir, "computer"), { recursive: true });
    await rm(driverSocket, { force: true }).catch(() => {});
    await rm(videoSocket, { force: true }).catch(() => {});
    const args = ["serve", "--socket", driverSocket, "--video-socket", videoSocket];
    if (PERMISSION_MODE === "bounded") {
      args.push("--capability-manifest", this.#manifestPath(dataDir));
    }
    const spawnState: { failure: Error | null } = { failure: null };
    const child = this.#spawnProcess("/usr/bin/open", ["-n", "-g", "-a", appState.bundleDir, "--args", ...args], {
      stdio: "ignore",
      env: daemonEnv(),
    });
    child.on("error", (error) => {
      spawnState.failure = error;
      if (this.#daemonProcess === child) this.#daemonProcess = null;
    });
    child.on("close", (code) => {
      if (code !== 0) spawnState.failure = new Error(`open exited with code ${code ?? "signal"} launching ${appState.bundleDir}`);
    });
    this.#daemonProcess = child;
    child.unref();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (spawnState.failure !== null) {
        throw new CuaError(`The bb Computer helper is unavailable: ${spawnState.failure.message}`, "setup-required");
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (await pathExists(driverSocket)) return;
    }
    throw new CuaError("The bb Computer helper did not open its driver socket within 5 seconds", "setup-required");
  }

  onStopped(listener: () => void): void {
    this.#stoppedListeners.add(listener);
  }

  /** Builds the `cua-driver mcp` launch descriptor the persistent MCP session connects with. */
  async mcpLaunch(dataDir: string): Promise<{ command: string; args: string[]; env: Record<string, string> }> {
    const appState = await this.#resolveComputerApp(dataDir);
    const command = await this.binaryPath(dataDir);
    if (appState.kind === "embedded") {
      return {
        command,
        args: ["mcp", "--embedded", "--socket", this.#embeddedDriverSocketPath(dataDir)],
        env: { ...daemonEnv(), CUA_DRIVER_EMBEDDED: "1", CUA_DRIVER_HOST_BUNDLE_ID: COMPUTER_APP_HELPER_BUNDLE_ID },
      };
    }
    return { command, args: ["mcp", "--socket", await this.socketPath(dataDir)], env: daemonEnv() };
  }

  embeddedVideoSocketPathIfActive(dataDir: string): Promise<string | null> {
    return this.#resolveComputerApp(dataDir).then((appState) =>
      appState.kind === "embedded" ? this.#embeddedVideoSocketPath(dataDir) : null,
    );
  }

  async socketPath(dataDir: string): Promise<string> {
    const status = await this.runProbe(dataDir, ["status"]);
    const match = /^\s*socket:\s*(\S.*?)\s*$/mu.exec(status.stdout);
    if (status.code !== 0 || match?.[1] === undefined) {
      throw new CuaError("The bb computer driver service is not running", "setup-required", true);
    }
    return match[1];
  }

  async #stopDaemon(dataDir: string): Promise<void> {
    for (const listener of this.#stoppedListeners) listener();
    const appState = await this.#resolveComputerApp(dataDir);
    if (appState.kind === "embedded") {
      // The embedded daemon isn't "installed" in cua-driver's own registry (it
      // runs at our private socket path), so `cua-driver stop` can't find it;
      // signal the helper app directly, identified by its unique socket arg.
      await this.#runQuiet("/usr/bin/pkill", ["-f", this.#embeddedDriverSocketPath(dataDir)]);
    } else {
      await this.runProbe(dataDir, ["stop"]);
    }
    if (this.#daemonProcess !== null && this.#daemonProcess.exitCode === null) this.#daemonProcess.kill("SIGTERM");
    this.#daemonProcess = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!(await this.daemonRunning(dataDir))) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  async ensureDaemon(dataDir: string): Promise<void> {
    if (this.#restartRequired) {
      this.#restartRequired = false;
      await this.#stopDaemon(dataDir).catch(() => {});
    }
    if (await this.daemonRunning(dataDir)) return;
    if (this.#daemonProcess !== null && this.#daemonProcess.exitCode === null) return;
    await mkdir(dataDir, { recursive: true });
    await this.#writeManifestFile(dataDir);
    await this.#spawnDaemon(dataDir);
  }

  async ensureWindowGranted(dataDir: string, pid: number, windowId: number): Promise<void> {
    await this.ensureDaemon(dataDir);
    if (PERMISSION_MODE !== "bounded") return;
    if (this.#windowGrants.has(pid, windowId)) return;
    this.#windowGrants.add(pid, windowId);
    await this.#writeManifestFile(dataDir);
    await this.#stopDaemon(dataDir);
    await this.#spawnDaemon(dataDir);
  }

  async ensureRunDirGranted(dataDir: string, outputDir: string): Promise<void> {
    await this.ensureDaemon(dataDir);
    if (PERMISSION_MODE !== "bounded") return;
    if (this.#runDirGrants.has(outputDir)) return;
    this.#runDirGrants.add(outputDir);
    await this.#writeManifestFile(dataDir);
    await this.#stopDaemon(dataDir);
    await this.#spawnDaemon(dataDir);
  }

  async #permissionStatus(dataDir: string, healthStdout: string | null): Promise<ComputerPermissionStatus> {
    const addressArgs = await this.#daemonAddressArgs(dataDir);
    const health = healthStdout ?? (await this.runProbe(dataDir, ["call", "health_report", ...addressArgs], "{}")).stdout;
    const fromHealth = parseHealthPermissionStatus(health);
    if (fromHealth.accessibility !== "unknown" && fromHealth.screenRecording !== "unknown") return fromHealth;
    // Embedded mode's `permissions status` still answers with the standalone
    // com.trycua.driver identity (see EMBEDDING.md), so it's only useful here
    // as the legacy-path fallback; health_report above already covers embedded.
    const status = await this.runProbe(dataDir, ["permissions", "status", "--json"]);
    const fromStatus = parseComputerPermissionStatus(status.stdout);
    return {
      accessibility: fromHealth.accessibility === "unknown" ? fromStatus.accessibility : fromHealth.accessibility,
      screenRecording: fromHealth.screenRecording === "unknown" ? fromStatus.screenRecording : fromHealth.screenRecording,
    };
  }

  #runQuiet(command: string, args: string[]): Promise<number | null> {
    return new Promise((resolve) => {
      const child = this.#spawnProcess(command, args, { stdio: "ignore", env: daemonEnv() });
      child.on("error", () => resolve(null));
      child.on("close", (code) => resolve(code));
    });
  }

  async requestPermissions(dataDir: string, permission: "accessibility" | "screen-recording" | undefined): Promise<void> {
    if (this.#platform !== "darwin") return;
    await this.ensureDaemon(dataDir).catch(() => {});
    const resolution = await this.#resolveBinaryPath(dataDir);
    const usable = !resolution.missing && !resolution.permissionsMissing;
    const status = usable && (await this.daemonRunning(dataDir)) ? await this.#permissionStatus(dataDir, null) : null;
    const target =
      permission ??
      (status === null || status.accessibility !== "granted"
        ? "accessibility"
        : status.screenRecording !== "granted"
          ? "screen-recording"
          : null);
    if (target === null) return;
    const appState = await this.#resolveComputerApp(dataDir);
    if (appState.kind === "embedded") {
      // Ask the helper itself to request the grant: it calls
      // AXIsProcessTrustedWithOptions/CGRequestScreenCaptureAccess as the
      // responsible process, which is what actually raises (and attributes)
      // the system prompt. See apps/computer-macos Permissions.swift.
      await this.#runQuiet("/usr/bin/open", ["-n", "-g", "-a", appState.bundleDir, "--args", "permissions", "request", target]);
    }
    const pane = target === "screen-recording" ? MACOS_PRIVACY_PANES.screenRecording : MACOS_PRIVACY_PANES.accessibility;
    await this.#runQuiet("/usr/bin/open", [pane]);
    const bundle =
      appState.kind === "embedded" ? appState.bundleDir : usable ? appBundlePathForBinary(resolution.path) : null;
    if (bundle !== null) await this.#runQuiet("/usr/bin/open", ["-R", bundle]);
  }

  async restartDaemon(dataDir: string): Promise<void> {
    await this.#stopDaemon(dataDir).catch(() => {});
    await this.#spawnDaemon(dataDir);
  }

  async doctorReport(dataDir: string): Promise<ComputerDoctorReport> {
    const resolution = await this.#resolveBinaryPath(dataDir);
    const binaryUnusable = resolution.missing || resolution.permissionsMissing;
    const version = binaryUnusable
      ? { code: null as number | null, stdout: "" }
      : await this.runProbe(dataDir, ["--version"]);
    const installed = version.code === 0;
    const versionText = installed ? version.stdout.trim().replace(/^cua-driver\s+/i, "").slice(0, 100) : null;
    const running = installed ? await this.daemonRunning(dataDir) : false;
    const probes: ComputerDoctorProbe[] = [
      {
        id: "driver",
        label: "Driver",
        status: resolution.permissionsMissing ? "unavailable" : installed ? "ok" : resolution.missing ? "setup-required" : "unavailable",
        message: resolution.permissionsMissing
          ? `Downloaded to ${resolution.path} but not executable; check its file permissions`
          : installed
            ? `Installed (${versionText})`
            : resolution.missing
              ? `Not installed; looked in ${resolution.tried.join(", ")}`
              : `Installed at ${resolution.path} but it could not run`,
      },
      {
        id: "service",
        label: "Driver service",
        status: running ? "ok" : "setup-required",
        message: running ? "Running" : installed ? "Not running; re-check to start it" : "Waiting for the driver",
      },
    ];
    if (running) {
      const addressArgs = await this.#daemonAddressArgs(dataDir);
      const windows = await this.runProbe(dataDir, ["call", "list_windows", ...addressArgs], JSON.stringify({ on_screen_only: true }));
      const health = await this.runProbe(dataDir, ["call", "health_report", ...addressArgs], "{}");
      let windowCount = -1;
      let refusalMessage: string | null = null;
      try {
        const parsed = JSON.parse(windows.stdout) as { windows?: unknown[]; refusal?: { message?: string } };
        windowCount = (parsed.windows ?? []).length;
        refusalMessage = parsed.refusal?.message ?? null;
      } catch {
        windowCount = -1;
      }
      const windowsOk = windows.code === 0 && windowCount >= 0;
      if (this.#platform === "darwin") {
        const permissions = await this.#permissionStatus(dataDir, health.stdout);
        probes.push(
          permissionProbe("accessibility", "Accessibility", permissions.accessibility),
          permissionProbe("screen-recording", "Screen recording", permissions.screenRecording),
        );
      }
      probes.push({
        id: "windows",
        label: "Windows",
        status: windowsOk ? "ok" : "unavailable",
        message:
          windowsOk
            ? `${windowCount} on-screen window(s) visible`
            : refusalMessage !== null
              ? `Could not list windows: ${refusalMessage}`
              : this.#platform === "darwin"
                ? "Could not list windows until Accessibility is granted"
                : "Could not list windows",
      });
    }
    const state = probes.every((probe) => probe.status === "ok")
      ? "ready"
      : probes.some((probe) => probe.status === "unavailable")
        ? "unavailable"
        : "setup-required";
    return {
      state,
      platform: this.#platform,
      version: versionText,
      driverPath: resolution.missing ? null : resolution.path,
      probes,
    };
  }

  dispose(): void {
    if (this.#daemonProcess !== null && this.#daemonProcess.exitCode === null) this.#daemonProcess.kill("SIGTERM");
  }
}

export interface ComputerHostServiceOptions {
  readonly dataDir: string;
  readonly logger: Pick<HostDaemonLogger, "debug" | "warn">;
  readonly spawnProcess?: SpawnFn;
  readonly transportFactory?: () => CuaTransport;
  readonly driverFetchImpl?: typeof fetch;
  readonly liveTransportFactory?: () => CuaTransport & { close(): void };
  readonly liveFrameSourceFactory?: (transport: CuaTransport) => ComputerFrameSource;
  readonly live: {
    readonly sendFrame: (frame: ComputerFrame) => void;
    readonly sendStatus: (state: ComputerLiveState, message: string | null) => void;
  };
  platform?: NodeJS.Platform;
  manifestRenewal?: ManifestRenewalOptions;
  computerAppFactory?: (dataDir: string) => Promise<ComputerAppState>;
}

const HUMAN_INPUT_SESSION = "bb-human";

interface DesktopSize {
  readonly width: number;
  readonly height: number;
}

export class ComputerHostService {
  readonly #dataDir: string;
  readonly #driver: DriverController;
  readonly #transport: CuaTransport;
  readonly #table = new TargetTable();
  readonly #platform: NodeJS.Platform;
  readonly #liveTransport: CuaTransport & { close(): void };
  readonly #live: LiveStream;
  #desktopSize: DesktopSize | null = null;
  #inputQueue: Promise<unknown> = Promise.resolve();

  constructor(options: ComputerHostServiceOptions) {
    this.#dataDir = options.dataDir;
    this.#platform = options.platform ?? process.platform;
    this.#driver = new DriverController(
      options.spawnProcess ?? nodeSpawn,
      options.logger,
      options.driverFetchImpl,
      options.platform,
      options.manifestRenewal,
      options.computerAppFactory,
    );
    const renewalHooks = {
      ensureFresh: () => this.#driver.ensureManifestFresh(this.#dataDir),
      renewAfterLapse: () => this.#driver.renewManifestAfterLapse(this.#dataDir),
      noteSuccess: () => this.#driver.noteDriverCallSucceeded(),
    };
    const rawLiveTransport =
      options.liveTransportFactory?.() ??
      new PersistentCuaTransport({
        launch: async () => {
          await this.#driver.ensureDaemon(this.#dataDir);
          return this.#driver.mcpLaunch(this.#dataDir);
        },
      });
    this.#liveTransport = new RenewingCuaTransport(rawLiveTransport, renewalHooks);
    this.#driver.onStopped(() => rawLiveTransport.close());
    this.#transport = options.transportFactory
      ? new RenewingCuaTransport(options.transportFactory(), renewalHooks)
      : this.#liveTransport;
    this.#live = new LiveStream({
      source: options.liveFrameSourceFactory?.(this.#liveTransport) ?? new DriverCaptureFrameSource({ transport: this.#liveTransport }),
      prepare: () => this.#driver.ensureDaemon(this.#dataDir),
      sendFrame: options.live.sendFrame,
      sendStatus: options.live.sendStatus,
      onFrame: (frame) => {
        this.#desktopSize = { width: frame.originalWidth, height: frame.originalHeight };
      },
    });
  }

  setLiveDemand(profile: ComputerLiveProfile | null, options?: { resync?: boolean }): void {
    this.#live.setDemand(profile, options);
  }

  input(input: { input: ComputerHumanInput }): Promise<{ summary: string }> {
    const run = this.#inputQueue.then(() => this.#performInput(input.input));
    this.#inputQueue = run.catch(() => {});
    return run;
  }

  async clipboardRead(): Promise<{ text: string | null }> {
    const signal = AbortSignal.timeout(15_000);
    const result = await this.#liveTransport.call(
      "clipboard_read",
      { include_text: true, session: HUMAN_INPUT_SESSION },
      signal,
    );
    const text = content(result).text;
    return { text: typeof text === "string" ? text : null };
  }

  async clipboardWrite(input: { text: string; paste: boolean }): Promise<{ written: boolean }> {
    const signal = AbortSignal.timeout(15_000);
    await this.#liveTransport.call("clipboard_write", { text: input.text, session: HUMAN_INPUT_SESSION }, signal);
    if (input.paste) {
      await this.#liveTransport.call(
        "press_key",
        { scope: "desktop", key: "v", modifiers: [this.#platform === "darwin" ? "cmd" : "ctrl"], session: HUMAN_INPUT_SESSION },
        signal,
      );
    }
    return { written: true };
  }

  async #performInput(input: ComputerHumanInput): Promise<{ summary: string }> {
    const signal = AbortSignal.timeout(15_000);
    const call = async (tool: string, args: Record<string, unknown>) => {
      const result = await this.#liveTransport.call(
        tool,
        { ...args, scope: "desktop", session: HUMAN_INPUT_SESSION },
        signal,
      );
      const text = result.content?.find((part) => part.type === "text")?.text;
      return { summary: (text ?? `Sent ${input.kind}`).slice(0, 2_000) };
    };
    switch (input.kind) {
      case "click": {
        const point = await this.#toDesktop(input.frame, input.x, input.y, signal);
        return call("click", {
          ...point,
          button: input.button,
          count: input.count,
          ...(input.modifiers.length > 0 ? { modifier: input.modifiers.map((modifier) => this.#modifierName(modifier)) } : {}),
        });
      }
      case "drag": {
        const from = await this.#toDesktop(input.frame, input.fromX, input.fromY, signal);
        const to = await this.#toDesktop(input.frame, input.toX, input.toY, signal);
        return call("drag", {
          from_x: from.x,
          from_y: from.y,
          to_x: to.x,
          to_y: to.y,
          button: input.button,
          duration_ms: input.durationMs,
        });
      }
      case "scroll": {
        const point = await this.#toDesktop(input.frame, input.x, input.y, signal);
        return call("scroll", { ...point, direction: input.direction, amount: input.amount });
      }
      case "move": {
        const point = await this.#toDesktop(input.frame, input.x, input.y, signal);
        return call("move_cursor", point);
      }
      case "type":
        return call("type_text", { text: input.text });
      case "key":
        return call("press_key", {
          key: input.key,
          ...(input.modifiers.length > 0 ? { modifiers: input.modifiers.map((modifier) => this.#modifierName(modifier)) } : {}),
        });
    }
  }

  #modifierName(modifier: ComputerKeyModifier): string {
    if (modifier !== "meta") return modifier;
    return this.#platform === "darwin" ? "cmd" : "super";
  }

  async #toDesktop(
    frame: { width: number; height: number },
    x: number,
    y: number,
    signal: AbortSignal,
  ): Promise<{ x: number; y: number }> {
    const desktop = this.#desktopSize ?? (await this.#probeDesktopSize(signal));
    return mapFramePoint(frame, desktop, x, y);
  }

  async #probeDesktopSize(signal: AbortSignal): Promise<DesktopSize> {
    await this.#driver.ensureDaemon(this.#dataDir);
    const capture = desktopCapture(
      await this.#liveTransport.call("get_desktop_state", { max_image_dimension: 64, session: HUMAN_INPUT_SESSION }, signal),
      Date.now(),
    );
    this.#desktopSize = { width: capture.originalWidth, height: capture.originalHeight };
    return this.#desktopSize;
  }

  async warmUp(): Promise<void> {
    try {
      await this.#driver.ensureDaemon(this.#dataDir);
      await this.#liveTransport.call("health_report", {}, AbortSignal.timeout(15_000));
    } catch {
      // Best-effort: observe()/act() establish the session themselves if this did not finish in time.
    }
  }

  async doctor(): Promise<ComputerDoctorReport> {
    await this.#driver.ensureDaemon(this.#dataDir).catch(() => {});
    void this.warmUp();
    let report = await this.#driver.doctorReport(this.#dataDir);
    const screen = report.probes.find((probe) => probe.id === "screen-recording");
    if (screen !== undefined && screen.status !== "ok") {
      await this.#driver.restartDaemon(this.#dataDir).catch(() => {});
      report = await this.#driver.doctorReport(this.#dataDir);
    }
    return this.#withCaptureProbe(report);
  }

  async #withCaptureProbe(report: ComputerDoctorReport): Promise<ComputerDoctorReport> {
    const running = report.probes.some((probe) => probe.id === "service" && probe.status === "ok");
    if (!running) return report;
    const captureProbe = await this.#captureProbe();
    const windowsIndex = report.probes.findIndex((probe) => probe.id === "windows");
    const probes =
      windowsIndex === -1
        ? [...report.probes, captureProbe]
        : [...report.probes.slice(0, windowsIndex), captureProbe, ...report.probes.slice(windowsIndex)];
    const state = probes.every((probe) => probe.status === "ok")
      ? "ready"
      : probes.some((probe) => probe.status === "unavailable")
        ? "unavailable"
        : "setup-required";
    return { ...report, probes, state };
  }

  async #captureProbe(): Promise<ComputerDoctorProbe> {
    try {
      const result = await this.#transport.call(
        "get_desktop_state",
        { max_image_dimension: 64 },
        AbortSignal.timeout(15_000),
      );
      const image = extractDesktopImage(result);
      if (image === null) {
        return {
          id: "capture",
          label: "Screen capture",
          status: "unavailable",
          message: "The driver returned a capture without a decodable image",
        };
      }
      return { id: "capture", label: "Screen capture", status: "ok", message: "Working" };
    } catch (error) {
      return {
        id: "capture",
        label: "Screen capture",
        status: "unavailable",
        message: error instanceof Error ? error.message.slice(0, 200) : "Failed to capture the screen",
      };
    }
  }

  async requestPermissions(input: { permission?: "accessibility" | "screen-recording" }): Promise<ComputerDoctorReport> {
    await this.#driver.requestPermissions(this.#dataDir, input.permission);
    return this.#driver.doctorReport(this.#dataDir);
  }

  async installDriver(): Promise<ComputerDoctorReport> {
    await this.#driver.installDriver(this.#dataDir);
    await this.#driver.ensureDaemon(this.#dataDir).catch(() => {});
    return this.#driver.doctorReport(this.#dataDir);
  }

  async observe(input: { appId?: string }): Promise<ComputerObservation> {
    const signal = new AbortController().signal;
    await this.#driver.ensureDaemon(this.#dataDir);
    const window = await findWindow(this.#transport, signal, input.appId);
    await this.#driver.ensureWindowGranted(this.#dataDir, window.pid, window.windowId);
    return this.#table.observe(this.#transport, signal, input.appId);
  }

  async act(input: { action: ComputerOperation }): Promise<ComputerActionOutcome> {
    const signal = new AbortController().signal;
    await this.#driver.ensureDaemon(this.#dataDir);
    return performAction(this.#transport, this.#table, input.action, this.#platform, signal);
  }

  async capture(input: { kind: "desktop" | "window"; appId?: string }): Promise<ComputerCaptureImage> {
    const signal = new AbortController().signal;
    await this.#driver.ensureDaemon(this.#dataDir);
    if (input.kind === "desktop") {
      const result = await this.#transport.call("get_desktop_state", {}, signal);
      const image = extractDesktopImage(result);
      if (image === null) {
        throw new CuaError("The driver returned a desktop capture without an image", "provider-unavailable", true);
      }
      return {
        mimeType: image.mimeType,
        dataBase64: image.base64,
        width: image.width,
        height: image.height,
      };
    }
    const window = await findWindow(this.#transport, signal, input.appId);
    await this.#driver.ensureWindowGranted(this.#dataDir, window.pid, window.windowId);
    const state = await this.#transport.call(
      "get_window_state",
      { pid: window.pid, window_id: window.windowId, include_screenshot: false, max_elements: 1 },
      signal,
    );
    const bounds = (content(state).window_bounds as { x?: number; y?: number; width?: number; height?: number } | undefined) ?? {};
    const x1 = bounds.x ?? 0;
    const y1 = bounds.y ?? 0;
    const zoom = await this.#transport.call(
      "zoom",
      { pid: window.pid, window_id: window.windowId, x1, y1, x2: x1 + (bounds.width ?? 800), y2: y1 + (bounds.height ?? 600) },
      signal,
    );
    const zoomData = content(zoom);
    const zoomImage = extractMcpImage(zoom);
    return {
      mimeType: zoomImage?.mimeType ?? "image/jpeg",
      dataBase64: zoomImage?.base64 ?? String(zoomData.image_b64 ?? zoomData.data ?? ""),
      width: Number(zoomData.width ?? bounds.width ?? 0),
      height: Number(zoomData.height ?? bounds.height ?? 0),
    };
  }

  async recordStart(input: { runId: string }): Promise<{ started: boolean }> {
    const signal = new AbortController().signal;
    const outputDir = join(this.#dataDir, "runs", input.runId);
    await mkdir(outputDir, { recursive: true });
    await this.#driver.ensureRunDirGranted(this.#dataDir, outputDir);
    await this.#transport.call("start_recording", { output_dir: outputDir, record_video: true }, signal);
    return { started: true };
  }

  async recordStop(
    input: { runId: string },
  ): Promise<{ videoPath: string | null; trajectoryPath: string | null }> {
    const signal = new AbortController().signal;
    const result = await this.#transport.call("stop_recording", {}, signal);
    const data = content(result);
    const outputDir = join(this.#dataDir, "runs", input.runId);
    let videoPath: string | null = typeof data.last_video_path === "string" ? data.last_video_path : null;
    if (videoPath === null) {
      const candidate = join(outputDir, "recording.mp4");
      videoPath = (await stat(candidate).then(() => true, () => false)) ? candidate : null;
    }
    const trajectoryPath = (await readdir(outputDir).catch(() => [])).length > 0 ? outputDir : null;
    return { videoPath, trajectoryPath };
  }

  dispose(): void {
    this.#live.dispose();
    this.#liveTransport.close();
    this.#driver.dispose();
  }
}

export function mapFramePoint(
  frame: { width: number; height: number },
  desktop: DesktopSize,
  x: number,
  y: number,
): { x: number; y: number } {
  const clamp = (value: number, max: number) => Math.min(Math.max(Math.round(value), 0), max - 1);
  return {
    x: clamp((x * desktop.width) / frame.width, desktop.width),
    y: clamp((y * desktop.height) / frame.height, desktop.height),
  };
}

const MODIFIER_COMBO_LETTER: Record<string, string> = {
  "mod+a": "a",
  "mod+c": "c",
  "mod+v": "v",
};

async function performAction(
  transport: CuaTransport,
  table: TargetTable,
  action: ComputerOperation,
  platform: NodeJS.Platform,
  signal: AbortSignal,
): Promise<ComputerActionOutcome> {
  try {
    switch (action.kind) {
      case "click": {
        await transport.call("click", table.resolveTarget(action.targetId, action.snapshotId), signal);
        break;
      }
      case "double_click": {
        await transport.call("double_click", table.resolveTarget(action.targetId, action.snapshotId), signal);
        break;
      }
      case "type": {
        await transport.call(
          "type_text",
          { ...table.resolveTarget(action.targetId, action.snapshotId), text: action.text, delivery_mode: "background" },
          signal,
        );
        break;
      }
      case "set_value": {
        await transport.call(
          "set_value",
          { ...table.resolveTarget(action.targetId, action.snapshotId), value: action.value },
          signal,
        );
        break;
      }
      case "select": {
        await transport.call(
          "set_value",
          { ...table.resolveTarget(action.targetId, action.snapshotId), value: action.value },
          signal,
        );
        break;
      }
      case "scroll": {
        const target = action.targetId === null ? table.windowArgs() : table.resolveTarget(action.targetId, action.snapshotId);
        await transport.call("scroll", { ...target, direction: action.direction, by: action.amount === "page" ? "page" : "line" }, signal);
        break;
      }
      case "hotkey": {
        await transport.call("hotkey", { ...table.windowArgs(), keys: action.keys, delivery_mode: "background" }, signal);
        break;
      }
      case "type_window": {
        await transport.call(
          "type_text",
          { ...table.windowArgs(), text: action.text, delivery_mode: "background" },
          signal,
        );
        break;
      }
      case "press_key": {
        const comboLetter = MODIFIER_COMBO_LETTER[action.key];
        if (comboLetter === undefined) {
          await transport.call("press_key", { ...table.windowArgs(), key: action.key, delivery_mode: "foreground" }, signal);
        } else {
          const modifier = platform === "darwin" ? "cmd" : "ctrl";
          await transport.call(
            "hotkey",
            { ...table.windowArgs(), keys: [modifier, comboLetter], delivery_mode: "foreground" },
            signal,
          );
        }
        break;
      }
      case "focus_window": {
        await transport.call("bring_to_front", table.windowArgs(), signal);
        break;
      }
      case "done":
        return { state: "completed" as const, summary: action.summary, observation: null };
      case "blocked":
        return { state: "blocked" as const, summary: action.reason, observation: null };
      case "wait":
        await new Promise((resolve) => setTimeout(resolve, action.ms));
        break;
    }
  } catch (error) {
    if (error instanceof CuaError && error.code === "stale-observation") {
      return { state: "stale" as const, summary: error.message, observation: null };
    }
    return {
      state: "error" as const,
      summary: error instanceof Error ? error.message : String(error),
      observation: null,
    };
  }
  const observation = table.window === null ? null : await table.reobserve(transport, signal);
  return { state: "completed" as const, summary: `Executed ${action.kind}`, observation };
}
