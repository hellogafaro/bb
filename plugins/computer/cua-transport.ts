import { spawn } from "node:child_process";

export interface CuaToolResult {
  readonly structuredContent?: Record<string, unknown>;
  readonly content?: ReadonlyArray<{ readonly type?: string; readonly text?: string }>;
  readonly isError?: boolean;
}

export interface CuaTransport {
  call(tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CuaToolResult>;
}

export interface ProcessCuaTransportOptions {
  readonly binaryPath: string;
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

export class ProcessCuaTransport implements CuaTransport {
  readonly #options: Required<ProcessCuaTransportOptions>;

  constructor(options: ProcessCuaTransportOptions) {
    this.#options = {
      ...options,
      timeoutMs: options.timeoutMs ?? 15_000,
      maxOutputBytes: options.maxOutputBytes ?? 4_000_000,
    };
  }

  call(tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CuaToolResult> {
    if (!/^[a-z][a-z0-9_]{0,63}$/u.test(tool)) {
      return Promise.reject(new CuaError(`Invalid Cua tool name: ${tool}`, "policy-denied"));
    }
    return new Promise((resolve, reject) => {
      const child = spawn(this.#options.binaryPath, ["call", tool], {
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
            if (result.isError === true) {
              const message =
                result.content?.find((part) => part.type === "text")?.text ??
                `Cua tool ${tool} returned an error`;
              const stale = /stale|no longer visible|not found/iu.test(message);
              reject(new CuaError(message.slice(0, 1_000), stale ? "stale-observation" : "provider-unavailable", stale));
            } else resolve(result);
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

export function content(result: CuaToolResult): Record<string, unknown> {
  return result.structuredContent ?? {};
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
