import { spawn } from "node:child_process";

export interface CuaToolResult {
  readonly structuredContent?: Record<string, unknown>;
  readonly content?: ReadonlyArray<{
    readonly type?: string;
    readonly text?: string;
    readonly data?: string;
    readonly mimeType?: string;
  }>;
  readonly isError?: boolean;
}

export interface CuaTransport {
  call(tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CuaToolResult>;
}

export interface ProcessCuaTransportOptions {
  readonly binaryPath: string | (() => Promise<string>);
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export class CuaError extends Error {
  constructor(
    message: string,
    readonly code:
      | "provider-unavailable"
      | "policy-denied"
      | "stale-observation"
      | "cancelled"
      | "setup-required"
      | "limit-exceeded",
    readonly retryable = false,
  ) {
    super(message);
  }
}

export function parseCuaResult(stdout: string): CuaToolResult {
  const parsed = JSON.parse(stdout) as Record<string, unknown>;
  const candidate =
    parsed.result !== null && typeof parsed.result === "object"
      ? (parsed.result as Record<string, unknown>)
      : parsed;
  const structured = candidate.structuredContent ?? candidate.structured_content;
  const refusal =
    candidate.refusal !== null && typeof candidate.refusal === "object"
      ? (candidate.refusal as Record<string, unknown>)
      : null;
  const direct =
    structured === undefined && !Array.isArray(candidate.content) && refusal === null
      ? candidate
      : null;
  return {
    ...(structured !== null && typeof structured === "object"
      ? { structuredContent: structured as Record<string, unknown> }
      : direct !== null
        ? { structuredContent: direct }
        : {}),
    ...(refusal !== null
      ? {
          content: [
            {
              type: "text",
              text: String(refusal.message ?? "Cua capability manifest refused the operation"),
            },
          ],
        }
      : Array.isArray(candidate.content)
        ? { content: candidate.content as CuaToolResult["content"] }
        : {}),
    ...(refusal !== null
      ? { isError: true }
      : typeof candidate.isError === "boolean"
        ? { isError: candidate.isError }
        : {}),
  };
}

export function cuaResultError(tool: string, result: CuaToolResult): CuaError | null {
  if (result.isError !== true) return null;
  const message =
    result.content?.find((part) => part.type === "text")?.text ?? `Cua tool ${tool} returned an error`;
  const stale = /stale|no longer visible|not found/iu.test(message);
  return new CuaError(message.slice(0, 1_000), stale ? "stale-observation" : "provider-unavailable", stale);
}

export class ProcessCuaTransport implements CuaTransport {
  readonly #options: Required<ProcessCuaTransportOptions>;

  constructor(options: ProcessCuaTransportOptions) {
    this.#options = {
      ...options,
      timeoutMs: options.timeoutMs ?? 15_000,
      maxOutputBytes: options.maxOutputBytes ?? 4_000_000,
    };
  }

  async call(tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CuaToolResult> {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(tool)) {
      throw new CuaError(`Invalid Cua tool name: ${tool}`, "policy-denied");
    }
    const binaryPath =
      typeof this.#options.binaryPath === "string"
        ? this.#options.binaryPath
        : await this.#options.binaryPath();
    return new Promise((resolve, reject) => {
      const child = spawn(binaryPath, ["call", tool], {
        stdio: ["pipe", "pipe", "pipe"],
        env: this.#options.env,
      });
      let stdout = "";
      let settled = false;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        fn();
      };
      const abort = () => {
        child.kill("SIGTERM");
        finish(() => reject(new CuaError("Cua call cancelled", "cancelled")));
      };
      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        finish(() => reject(new CuaError(`Cua call to ${tool} timed out`, "provider-unavailable", true)));
      }, this.#options.timeoutMs);
      signal.addEventListener("abort", abort, { once: true });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        if (Buffer.byteLength(stdout) > this.#options.maxOutputBytes) child.kill("SIGTERM");
      });
      child.stderr.on("data", () => {});
      child.on("error", (error) =>
        finish(() =>
          reject(new CuaError(`Cua driver unavailable: ${error.message}`, "setup-required")),
        ),
      );
      child.on("close", (code) =>
        finish(() => {
          if (Buffer.byteLength(stdout) > this.#options.maxOutputBytes) {
            reject(new CuaError(`Cua response for ${tool} exceeded the output limit`, "limit-exceeded"));
            return;
          }
          if (code !== 0) {
            reject(
              new CuaError(`Cua tool ${tool} exited with ${code ?? "signal"}`, "provider-unavailable", true),
            );
            return;
          }
          try {
            const result = parseCuaResult(stdout);
            const error = cuaResultError(tool, result);
            if (error !== null) reject(error);
            else resolve(result);
          } catch (error) {
            reject(
              new CuaError(
                `Invalid Cua response for ${tool}: ${error instanceof Error ? error.message : String(error)}`,
                "provider-unavailable",
              ),
            );
          }
        }),
      );
      child.stdin.end(JSON.stringify(input));
    });
  }
}

const LAPSED_MANIFEST_PATTERN = /capability manifest[\s\S]{0,80}(idle timeout exceeded|expired|lapsed)/iu;

export function isLapsedManifestError(error: unknown): boolean {
  return error instanceof Error && LAPSED_MANIFEST_PATTERN.test(error.message);
}

export interface ManifestRenewalHooks {
  ensureFresh(): Promise<void>;
  renewAfterLapse(): Promise<void>;
  noteSuccess(): void;
}

export class RenewingCuaTransport implements CuaTransport {
  readonly #inner: CuaTransport;
  readonly #hooks: ManifestRenewalHooks;

  constructor(inner: CuaTransport, hooks: ManifestRenewalHooks) {
    this.#inner = inner;
    this.#hooks = hooks;
  }

  async call(tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CuaToolResult> {
    await this.#hooks.ensureFresh();
    try {
      const result = await this.#inner.call(tool, input, signal);
      this.#hooks.noteSuccess();
      return result;
    } catch (error) {
      if (!isLapsedManifestError(error)) throw error;
      await this.#hooks.renewAfterLapse();
      const result = await this.#inner.call(tool, input, signal);
      this.#hooks.noteSuccess();
      return result;
    }
  }

  close(): void {
    const closable = this.#inner as { close?: () => void };
    closable.close?.();
  }
}

export function content(result: CuaToolResult): Record<string, unknown> {
  return result.structuredContent ?? {};
}

export interface McpImage {
  readonly base64: string;
  readonly mimeType: "image/png" | "image/jpeg";
}

export function extractMcpImage(result: CuaToolResult): McpImage | null {
  const image = result.content?.find((part) => part.type === "image" && typeof part.data === "string");
  if (image?.data === undefined) return null;
  return { base64: image.data, mimeType: image.mimeType === "image/jpeg" ? "image/jpeg" : "image/png" };
}

export interface DesktopImage {
  readonly base64: string;
  readonly mimeType: "image/png" | "image/jpeg";
  readonly width: number;
  readonly height: number;
  readonly originalWidth: number;
  readonly originalHeight: number;
}

export function extractDesktopImage(result: CuaToolResult): DesktopImage | null {
  const data = content(result);
  const mcpImage = extractMcpImage(result);
  const base64 = mcpImage?.base64 ?? (typeof data.screenshot_png_b64 === "string" ? data.screenshot_png_b64 : "");
  const width = Number(data.screenshot_width ?? 0);
  const height = Number(data.screenshot_height ?? 0);
  if (base64.length === 0 || !(width > 0) || !(height > 0)) return null;
  const mimeType = mcpImage?.mimeType ?? (data.screenshot_mime_type === "image/jpeg" ? "image/jpeg" : "image/png");
  return {
    base64,
    mimeType,
    width,
    height,
    originalWidth: Number(data.screenshot_original_width ?? width),
    originalHeight: Number(data.screenshot_original_height ?? height),
  };
}

export function cuaEnv(base: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return {
    PATH: base.PATH ?? "/usr/bin:/bin",
    HOME: base.HOME ?? "",
    DISPLAY: base.DISPLAY ?? "",
    WAYLAND_DISPLAY: base.WAYLAND_DISPLAY ?? "",
    XDG_RUNTIME_DIR: base.XDG_RUNTIME_DIR ?? "",
    DBUS_SESSION_BUS_ADDRESS: base.DBUS_SESSION_BUS_ADDRESS ?? "",
    XAUTHORITY: base.XAUTHORITY ?? "",
  };
}
