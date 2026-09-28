import { constants } from "node:fs";
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { access, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  ComputerActionOutcome,
  ComputerCaptureImage,
  ComputerDoctorProbe,
  ComputerDoctorReport,
  ComputerObservation,
  ComputerOperation,
  ComputerPreviewFrame,
  ComputerPreviewSize,
} from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "../logger.js";
import {
  content,
  CuaError,
  cuaEnv,
  ProcessCuaTransport,
  type CuaTransport,
} from "./computer-transport.js";
import { appBundlePathForBinary } from "./computer-driver-bundle.js";
import {
  MACOS_PRIVACY_PANES,
  parseComputerPermissionStatus,
  type ComputerPermissionState,
} from "./computer-permissions.js";
import { ensureProvisionedDriver } from "./computer-driver-provisioning.js";
import { LiveCaptureLoop } from "./computer-live.js";
import { buildCapabilityManifest, PathGrantSet, WindowGrantSet } from "./computer-manifest.js";
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
          : "Not verified yet; use Grant permissions and approve on the Mac",
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
  #restartRequired = false;

  constructor(
    spawnProcess: SpawnFn,
    logger: Pick<HostDaemonLogger, "debug" | "warn">,
    fetchImpl?: typeof fetch,
    platform: NodeJS.Platform = process.platform,
  ) {
    this.#spawnProcess = spawnProcess;
    this.#logger = logger;
    this.#fetchImpl = fetchImpl;
    this.#platform = platform;
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
          if (provisioned.changed === true) this.#restartRequired = true;
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

  async installDriver(dataDir: string): Promise<void> {
    this.#resolutionCache.delete(dataDir);
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
    const status = await this.runProbe(dataDir, ["status"]);
    return status.code === 0;
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
  }

  async #spawnDaemon(dataDir: string): Promise<void> {
    const resolution = await this.#resolveBinaryPath(dataDir);
    const args =
      PERMISSION_MODE === "bounded"
        ? ["serve", "--permission-mode", "bounded", "--capability-manifest", this.#manifestPath(dataDir), "--approve-capability-manifest"]
        : ["serve", "--permission-mode", PERMISSION_MODE];
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

  async #stopDaemon(dataDir: string): Promise<void> {
    await this.runProbe(dataDir, ["stop"]);
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

  async #permissionProbes(dataDir: string): Promise<ComputerDoctorProbe[]> {
    const status = await this.runProbe(dataDir, ["permissions", "status", "--json"]);
    const parsed = parseComputerPermissionStatus(status.stdout);
    if (parsed.accessibility === "unknown" || parsed.screenRecording === "unknown") {
      this.#logger.debug({ stdout: status.stdout.slice(0, 500), stderr: status.stderr.slice(0, 500) }, "Driver permission status not verified");
    }
    return [
      permissionProbe("accessibility", "Accessibility", parsed.accessibility),
      permissionProbe("screen-recording", "Screen recording", parsed.screenRecording),
    ];
  }

  async requestPermissions(dataDir: string): Promise<void> {
    if (this.#platform !== "darwin") return;
    await this.ensureDaemon(dataDir).catch(() => {});
    const resolution = await this.#resolveBinaryPath(dataDir);
    const usable = !resolution.missing && !resolution.permissionsMissing;
    if (usable) {
      const grant = this.#spawnProcess(resolution.path, ["permissions", "grant"], { stdio: "ignore", detached: true, env: daemonEnv() });
      grant.on("error", () => {});
      grant.unref();
    }
    const probes = usable && (await this.daemonRunning(dataDir)) ? await this.#permissionProbes(dataDir) : [];
    const missing = probes.find((probe) => probe.status !== "ok");
    const pane =
      missing === undefined && probes.length > 0
        ? null
        : missing?.id === "screen-recording"
          ? MACOS_PRIVACY_PANES.screenRecording
          : MACOS_PRIVACY_PANES.accessibility;
    if (pane === null) return;
    const opener = this.#spawnProcess("/usr/bin/open", [pane], { stdio: "ignore", env: daemonEnv() });
    opener.on("error", () => {});
    opener.unref();
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
      if (this.#platform === "darwin") probes.push(...(await this.#permissionProbes(dataDir)));
      const windows = await this.runProbe(dataDir, ["call", "list_windows"], JSON.stringify({ on_screen_only: true }));
      const health = await this.runProbe(dataDir, ["call", "health_report"], "{}");
      probes.push({
        id: "capture",
        label: "Screen capture",
        status: health.code === 0 ? "ok" : "unavailable",
        message:
          health.code === 0
            ? "Working"
            : this.#platform === "darwin"
              ? "Failed; usually the Screen Recording permission is missing"
              : "Failed; check that a display is available",
      });
      let windowCount = -1;
      let refusalMessage: string | null = null;
      try {
        const parsed = JSON.parse(windows.stdout) as { windows?: unknown[]; refusal?: { message?: string } };
        windowCount = (parsed.windows ?? []).length;
        refusalMessage = parsed.refusal?.message ?? null;
      } catch {
        windowCount = -1;
      }
      probes.push({
        id: "windows",
        label: "Windows",
        status: windows.code === 0 && windowCount >= 0 ? "ok" : "unavailable",
        message:
          windows.code === 0 && windowCount >= 0
            ? `${windowCount} on-screen window(s) visible`
            : refusalMessage !== null
              ? `Could not list windows: ${refusalMessage}`
              : this.#platform === "darwin"
                ? "Could not list windows; usually the Accessibility permission is missing"
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
  platform?: NodeJS.Platform;
}

export class ComputerHostService {
  readonly #dataDir: string;
  readonly #driver: DriverController;
  readonly #transport: CuaTransport;
  readonly #table = new TargetTable();
  readonly #liveLoop: LiveCaptureLoop;
  #liveController: AbortController | null = null;

  constructor(options: ComputerHostServiceOptions) {
    this.#dataDir = options.dataDir;
    this.#driver = new DriverController(
      options.spawnProcess ?? nodeSpawn,
      options.logger,
      options.driverFetchImpl,
      options.platform,
    );
    this.#transport =
      options.transportFactory?.() ??
      new ProcessCuaTransport({
        binaryPath: () => this.#driver.binaryPath(this.#dataDir),
        env: daemonEnv(),
      });
    this.#liveLoop = new LiveCaptureLoop({
      thumbnailFps: 6,
      fullFps: 12,
      maxFrameBytes: 1_500_000,
      isProtected: () => false,
      capture: async (signal) => {
        const result = await this.#transport.call("get_desktop_state", {}, signal);
        const data = content(result);
        const base64 = String(data.screenshot_png_b64 ?? "");
        return {
          bytes: Buffer.from(base64, "base64"),
          mimeType: (data.screenshot_mime_type as "image/jpeg" | "image/png" | undefined) ?? "image/png",
          width: Number(data.screenshot_width ?? 0),
          height: Number(data.screenshot_height ?? 0),
        };
      },
    });
  }

  #ensureLiveLoop(): void {
    if (this.#liveController !== null) return;
    this.#liveController = new AbortController();
    void this.#liveLoop.run(this.#liveController.signal);
  }

  async doctor(): Promise<ComputerDoctorReport> {
    await this.#driver.ensureDaemon(this.#dataDir).catch(() => {});
    return this.#driver.doctorReport(this.#dataDir);
  }

  async requestPermissions(): Promise<ComputerDoctorReport> {
    await this.#driver.requestPermissions(this.#dataDir);
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
    return performAction(this.#transport, this.#table, input.action, signal);
  }

  async capture(input: { kind: "desktop" | "window"; appId?: string }): Promise<ComputerCaptureImage> {
    const signal = new AbortController().signal;
    await this.#driver.ensureDaemon(this.#dataDir);
    if (input.kind === "desktop") {
      const result = await this.#transport.call("get_desktop_state", {}, signal);
      const data = content(result);
      return {
        mimeType: (data.screenshot_mime_type as "image/jpeg" | "image/png" | undefined) ?? "image/png",
        dataBase64: String(data.screenshot_png_b64 ?? ""),
        width: Number(data.screenshot_width ?? 0),
        height: Number(data.screenshot_height ?? 0),
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
    return {
      mimeType: "image/jpeg" as const,
      dataBase64: String(zoomData.image_b64 ?? zoomData.data ?? ""),
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

  previewTouch(input: { viewerId: string; size: ComputerPreviewSize }): { ok: boolean } {
    this.#ensureLiveLoop();
    this.#liveLoop.touchViewer(input.viewerId, input.size);
    return { ok: true };
  }

  previewLatest(input: { afterSequence: number | null }): ComputerPreviewFrame {
    this.#ensureLiveLoop();
    const frame = this.#liveLoop.latest(input.afterSequence);
    if (frame === null) {
      return { sequence: input.afterSequence ?? 0, state: "none" as const, mimeType: null, dataBase64: null, width: 0, height: 0, capturedAt: null };
    }
    return {
      sequence: frame.sequence,
      state: frame.state,
      mimeType: frame.bytes === null ? null : frame.mimeType,
      dataBase64: frame.bytes === null ? null : Buffer.from(frame.bytes).toString("base64"),
      width: frame.width,
      height: frame.height,
      capturedAt: frame.capturedAt,
    };
  }

  dispose(): void {
    this.#liveController?.abort();
    this.#driver.dispose();
  }
}

async function performAction(
  transport: CuaTransport,
  table: TargetTable,
  action: ComputerOperation,
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
