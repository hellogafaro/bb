import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { CuaError, cuaResultError, type CuaToolResult, type CuaTransport } from "./computer-transport.js";

export interface DriverSessionLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface PersistentCuaTransportOptions {
  readonly launch: () => Promise<DriverSessionLaunch>;
  readonly timeoutMs?: number;
}

const CLIENT_INFO = { name: "bb-computer-live", version: "1.0.0" };

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

export class PersistentCuaTransport implements CuaTransport {
  readonly #options: PersistentCuaTransportOptions;
  #client: Promise<Client> | null = null;

  constructor(options: PersistentCuaTransportOptions) {
    this.#options = options;
  }

  async call(tool: string, input: Record<string, unknown>, signal: AbortSignal): Promise<CuaToolResult> {
    const client = await this.#connect();
    let raw: unknown;
    try {
      raw = await client.callTool(
        { name: tool, arguments: input },
        { signal, timeout: this.#options.timeoutMs ?? 15_000 },
      );
    } catch (error) {
      if (signal.aborted) throw new CuaError("Cua call cancelled", "cancelled");
      throw new CuaError(
        `Cua tool ${tool} failed: ${error instanceof Error ? error.message : String(error)}`,
        "provider-unavailable",
        true,
      );
    }
    const result = toolResult(raw);
    const error = cuaResultError(tool, result);
    if (error !== null) throw error;
    return result;
  }

  close(): void {
    const pending = this.#client;
    this.#client = null;
    void pending?.then((client) => client.close()).catch(() => {});
  }

  #connect(): Promise<Client> {
    if (this.#client !== null) return this.#client;
    const connecting = (async () => {
      const launch = await this.#options.launch();
      const transport = new StdioClientTransport({
        command: launch.command,
        args: [...launch.args],
        env: { ...launch.env },
        stderr: "ignore",
      });
      const client = new Client(CLIENT_INFO);
      client.onclose = () => {
        if (this.#client === connecting) this.#client = null;
      };
      await client.connect(transport, { timeout: this.#options.timeoutMs ?? 15_000 });
      return client;
    })();
    this.#client = connecting;
    connecting.catch(() => {
      if (this.#client === connecting) this.#client = null;
    });
    return connecting.catch((error: unknown) => {
      throw new CuaError(
        `Could not open a driver session: ${error instanceof Error ? error.message : String(error)}`,
        "setup-required",
        true,
      );
    });
  }
}
