import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  experimental_defineHostEntry,
  type ExperimentalHostRpcContext,
} from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contracts.js";
import { content, CuaError, cuaEnv, ProcessCuaTransport, type CuaTransport } from "./cua-transport.js";
import { LiveCaptureLoop } from "./live.js";
import { buildCapabilityManifest, WindowGrantSet } from "./manifest.js";
import { findWindow, TargetTable } from "./target-table.js";

const BINARY_PATH = process.env.CUA_DRIVER_PATH ?? "cua-driver";

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

async function runProbe(args: string[], stdin?: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(BINARY_PATH, args, { stdio: ["pipe", "pipe", "ignore"], env: daemonEnv() });
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(0, 200_000);
    });
    child.on("error", () => resolve({ code: 1, stdout: "" }));
    child.on("close", (code) => resolve({ code, stdout }));
    child.stdin.end(stdin ?? "");
  });
}

let daemonProcess: ChildProcess | null = null;
const windowGrants = new WindowGrantSet();

async function daemonRunning(): Promise<boolean> {
  const status = await runProbe(["status"]);
  return status.code === 0;
}

function manifestPath(dataDir: string): string {
  return join(dataDir, "capability-manifest.json");
}

async function writeManifestFile(dataDir: string): Promise<void> {
  const manifest = buildCapabilityManifest({
    writablePaths: [join(dataDir, "runs")],
    windows: windowGrants.list(),
  });
  await writeFile(manifestPath(dataDir), JSON.stringify(manifest, null, 2));
}

const PERMISSION_MODE = process.env.CUA_DRIVER_PERMISSION_MODE ?? "bounded";

async function spawnDaemon(dataDir: string): Promise<void> {
  const args =
    PERMISSION_MODE === "bounded"
      ? ["serve", "--permission-mode", "bounded", "--capability-manifest", manifestPath(dataDir), "--approve-capability-manifest"]
      : ["serve", "--permission-mode", PERMISSION_MODE];
  daemonProcess = spawn(BINARY_PATH, args, { stdio: "ignore", detached: true, env: daemonEnv() });
  daemonProcess.unref();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await daemonRunning()) return;
  }
  throw new CuaError("Cua Driver daemon did not start within 5 seconds", "setup-required");
}

async function stopDaemon(): Promise<void> {
  await runProbe(["stop"]);
  if (daemonProcess !== null && daemonProcess.exitCode === null) daemonProcess.kill("SIGTERM");
  daemonProcess = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!(await daemonRunning())) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

async function ensureDaemon(dataDir: string): Promise<void> {
  if (await daemonRunning()) return;
  if (daemonProcess !== null && daemonProcess.exitCode === null) return;
  await mkdir(dataDir, { recursive: true });
  await writeManifestFile(dataDir);
  await spawnDaemon(dataDir);
}

async function ensureWindowGranted(dataDir: string, pid: number, windowId: number): Promise<void> {
  await ensureDaemon(dataDir);
  if (PERMISSION_MODE !== "bounded") return;
  if (windowGrants.has(pid, windowId)) return;
  windowGrants.add(pid, windowId);
  await writeManifestFile(dataDir);
  await stopDaemon();
  await spawnDaemon(dataDir);
}

async function doctorReport() {
  const version = await runProbe(["--version"]);
  const running = await daemonRunning();
  const probes: { label: string; status: "ok" | "setup-required" | "unavailable"; message: string }[] = [
    {
      label: "binary",
      status: version.code === 0 ? "ok" : "unavailable",
      message: version.code === 0 ? version.stdout.trim().slice(0, 100) : "cua-driver was not found on PATH",
    },
    {
      label: "daemon",
      status: running ? "ok" : "setup-required",
      message: running ? "Cua Driver daemon is running" : "Cua Driver daemon is not running; call doctor/setup to start it",
    },
  ];
  if (running) {
    const windows = await runProbe(["call", "list_windows"], JSON.stringify({ on_screen_only: true }));
    const health = await runProbe(["call", "health_report"], "{}");
    probes.push({
      label: "health",
      status: health.code === 0 ? "ok" : "unavailable",
      message: health.code === 0 ? "End-to-end health probe passed" : "The health_report probe failed",
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
      label: "windows",
      status: windows.code === 0 && windowCount >= 0 ? "ok" : "unavailable",
      message:
        windows.code === 0 && windowCount >= 0
          ? `${windowCount} on-screen window(s) visible`
          : refusalMessage !== null
            ? `Could not list on-screen windows: ${refusalMessage}`
            : "Could not list on-screen windows",
    });
  }
  const state = probes.every((probe) => probe.status === "ok")
    ? "ready"
    : probes.some((probe) => probe.status === "unavailable")
      ? "unavailable"
      : "setup-required";
  return {
    state,
    version: version.code === 0 ? version.stdout.trim().slice(0, 100) : null,
    probes,
  } as const;
}

export function createHostEntry(transportFactory: () => CuaTransport = () => new ProcessCuaTransport({ binaryPath: BINARY_PATH, env: daemonEnv() })) {
  const transport = transportFactory();
  const table = new TargetTable();
  const liveLoop = new LiveCaptureLoop({
    thumbnailFps: 6,
    fullFps: 12,
    maxFrameBytes: 1_500_000,
    isProtected: () => false,
    capture: async (signal) => {
      const result = await transport.call("get_desktop_state", {}, signal);
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
  let liveController: AbortController | null = null;
  let liveLease: { dispose(): Promise<void> } | null = null;

  function ensureLiveLoop(context: ExperimentalHostRpcContext): void {
    if (liveController !== null) return;
    liveController = new AbortController();
    liveLease = context.experimental_retainWorker();
    const signal = AbortSignal.any([liveController.signal, context.lifecycle.signal]);
    void liveLoop.run(signal).finally(() => {
      void liveLease?.dispose();
      liveLease = null;
    });
  }

  return experimental_defineHostEntry({
    contract: hostContract,
    handlers: {
      async doctor(_input, context) {
        await ensureDaemon(context.experimental_paths.dataDir).catch(() => {});
        return doctorReport();
      },
      async observe({ appId }, context) {
        context.signal.throwIfAborted();
        const dataDir = context.experimental_paths.dataDir;
        await ensureDaemon(dataDir);
        const window = await findWindow(transport, context.signal, appId);
        await ensureWindowGranted(dataDir, window.pid, window.windowId);
        return table.observe(transport, context.signal, appId);
      },
      async act({ action }, context) {
        context.signal.throwIfAborted();
        await ensureDaemon(context.experimental_paths.dataDir);
        const outcome = await performAction(transport, table, action, context.signal);
        return outcome;
      },
      async capture({ kind, appId }, context) {
        context.signal.throwIfAborted();
        const dataDir = context.experimental_paths.dataDir;
        await ensureDaemon(dataDir);
        if (kind === "desktop") {
          const result = await transport.call("get_desktop_state", {}, context.signal);
          const data = content(result);
          return {
            mimeType: (data.screenshot_mime_type as "image/jpeg" | "image/png" | undefined) ?? "image/png",
            dataBase64: String(data.screenshot_png_b64 ?? ""),
            width: Number(data.screenshot_width ?? 0),
            height: Number(data.screenshot_height ?? 0),
          };
        }
        const window = await findWindow(transport, context.signal, appId);
        await ensureWindowGranted(dataDir, window.pid, window.windowId);
        const state = await transport.call(
          "get_window_state",
          { pid: window.pid, window_id: window.windowId, include_screenshot: false, max_elements: 1 },
          context.signal,
        );
        const bounds = (content(state).window_bounds as { x?: number; y?: number; width?: number; height?: number } | undefined) ?? {};
        const x1 = bounds.x ?? 0;
        const y1 = bounds.y ?? 0;
        const zoom = await transport.call(
          "zoom",
          { pid: window.pid, window_id: window.windowId, x1, y1, x2: x1 + (bounds.width ?? 800), y2: y1 + (bounds.height ?? 600) },
          context.signal,
        );
        const zoomData = content(zoom);
        return {
          mimeType: "image/jpeg" as const,
          dataBase64: String(zoomData.image_b64 ?? zoomData.data ?? ""),
          width: Number(zoomData.width ?? bounds.width ?? 0),
          height: Number(zoomData.height ?? bounds.height ?? 0),
        };
      },
      async recordStart({ runId }, context) {
        await ensureDaemon(context.experimental_paths.dataDir);
        const outputDir = join(context.experimental_paths.dataDir, "runs", runId);
        await mkdir(outputDir, { recursive: true });
        await transport.call("start_recording", { output_dir: outputDir, record_video: true }, context.signal);
        return { started: true };
      },
      async recordStop({ runId }, context) {
        const result = await transport.call("stop_recording", {}, context.signal);
        const data = content(result);
        const outputDir = join(context.experimental_paths.dataDir, "runs", runId);
        let videoPath: string | null = typeof data.last_video_path === "string" ? data.last_video_path : null;
        if (videoPath === null) {
          const candidate = join(outputDir, "recording.mp4");
          videoPath = (await stat(candidate).then(() => true, () => false)) ? candidate : null;
        }
        const trajectoryPath = (await readdir(outputDir).catch(() => [])).length > 0 ? outputDir : null;
        return { videoPath, trajectoryPath };
      },
      async previewTouch({ viewerId, size }, context) {
        ensureLiveLoop(context);
        liveLoop.touchViewer(viewerId, size);
        return { ok: true };
      },
      async previewLatest({ afterSequence }, context) {
        ensureLiveLoop(context);
        const frame = liveLoop.latest(afterSequence);
        if (frame === null) {
          return { sequence: afterSequence ?? 0, state: "none" as const, mimeType: null, dataBase64: null, width: 0, height: 0, capturedAt: null };
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
      },
    },
    async dispose() {
      liveController?.abort();
      if (daemonProcess !== null && daemonProcess.exitCode === null) daemonProcess.kill("SIGTERM");
    },
  });
}

async function performAction(transport: CuaTransport, table: TargetTable, action: import("./contracts.js").Operation, signal: AbortSignal) {
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

export default createHostEntry();
