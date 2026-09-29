import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import {
  CuaError,
  cuaResultError,
  isRecoverableSessionError,
  type CuaToolResult,
  type CuaTransport,
} from "./computer-transport.js";

export interface DriverSessionLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface DriverSession {
  call(tool: string, input: Record<string, unknown>, signal: AbortSignal, timeoutMs: number): Promise<unknown>;
  close(): void;
  onClose(listener: () => void): void;
}

export type DriverSessionFactory = (launch: DriverSessionLaunch, connectTimeoutMs: number) => Promise<DriverSession>;

export interface PersistentCuaTransportOptions {
  readonly launch: () => Promise<DriverSessionLaunch>;
  readonly timeoutMs?: number;
  readonly sessionFactory?: DriverSessionFactory;
}

const CLIENT_INFO = { name: "bb-computer-live", version: "1.0.0" };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toolResult(value: unknown): CuaToolResult {
  if (value === null || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const structured = record.structuredContent;
  return {
    ...(structured !== null && typeof structured === "object" && !Array.isArray(structured)
      ? { structuredContent: structured as Record<string, unknown> }
      : {}),
    ...(Array.isArray(record.content) ? { content: record.content as CuaToolResult["content"] } : {}),
    ...(typeof record.isError === "boolean" ? { isError: record.isError } : {}),
  };
}

async function defaultSessionFactory(launch: DriverSessionLaunch, connectTimeoutMs: number): Promise<DriverSession> {
  const transport = new StdioClientTransport({
    command: launch.command,
    args: [...launch.args],
    env: { ...launch.env },
    stderr: "ignore",
  });
  const client = new Client(CLIENT_INFO);
  await client.connect(transport, { timeout: connectTimeoutMs });
  let onCloseListener: (() => void) | null = null;
  client.onclose = () => onCloseListener?.();
  return {
    call: (tool, input, signal, timeoutMs) => client.callTool({ name: tool, arguments: input }, { signal, timeout: timeoutMs }),
    close: () => client.close(),
    onClose: (listener) => {
      onCloseListener = listener;
    },
  };
}

/**
 * Keeps a single `cua-driver mcp` session open across calls. Every call that fails because the
 * driver-side session ended (restarted daemon, crashed process, broken pipe) discards the session
 * and retries exactly once against a freshly opened one; a second failure is not retried again.
 */
export class PersistentCuaTransport implements CuaTransport {
  readonly #options: PersistentCuaTransportOptions;
  readonly #sessionFactory: DriverSessionFactory;
  #session: Promise<DriverSession> | null = null;

  constructor(options: PersistentCuaTransportOptions) {
    this.#options = options;
    this.#sessionFactory = options.sessionFactory ?? defaultSessionFactory;
  }

  async call(tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CuaToolResult> {
    return this.#attempt(tool, input, signal, true);
  }

  async #attempt(
    tool: string,
    input: Record<string, unknown>,
    signal: AbortSignal,
    allowReconnect: boolean,
  ): Promise<CuaToolResult> {
    const session = await this.#connect();
    const timeoutMs = this.#options.timeoutMs ?? 15_000;
    let raw: unknown;
    try {
      raw = await session.call(tool, input, signal, timeoutMs);
    } catch (error) {
      if (signal.aborted) throw new CuaError("Cua call cancelled", "cancelled");
      if (allowReconnect && isRecoverableSessionError(error)) {
        this.#discardSession();
        return this.#attempt(tool, input, signal, false);
      }
      throw new CuaError(`Cua tool ${tool} failed: ${errorMessage(error)}`, "provider-unavailable", true);
    }
    const result = toolResult(raw);
    const error = cuaResultError(tool, result);
    if (error !== null) {
      if (allowReconnect && isRecoverableSessionError(error)) {
        this.#discardSession();
        return this.#attempt(tool, input, signal, false);
      }
      throw error;
    }
    return result;
  }

  close(): void {
    this.#discardSession();
  }

  #discardSession(): void {
    const pending = this.#session;
    this.#session = null;
    void pending?.then((session) => session.close()).catch(() => {});
  }

  #connect(): Promise<DriverSession> {
    if (this.#session !== null) return this.#session;
    const connectTimeoutMs = this.#options.timeoutMs ?? 15_000;
    const connecting = (async () => {
      const launch = await this.#options.launch();
      const session = await this.#sessionFactory(launch, connectTimeoutMs);
      session.onClose(() => {
        if (this.#session === connecting) this.#session = null;
      });
      return session;
    })();
    this.#session = connecting;
    connecting.catch(() => {
      if (this.#session === connecting) this.#session = null;
    });
    return connecting.catch((error: unknown) => {
      throw new CuaError(`Could not open a driver session: ${errorMessage(error)}`, "setup-required", true);
    });
  }
}
