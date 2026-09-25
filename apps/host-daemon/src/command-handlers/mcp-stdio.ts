import {
  Client,
  type ClientOptions,
  type Prompt,
  type Resource,
  type ResourceTemplateType,
  type Tool,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type {
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcResult,
  McpCatalogChangedMessage,
  McpConnectionChangedMessage,
  McpStdioCatalog,
} from "@bb/host-daemon-contract";
import type { HostDaemonLogger } from "../logger.js";

export const MCP_STDIO_CONNECT_TIMEOUT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 2_000;
const MCP_CLIENT_INFO = { name: "bb-mcp-stdio", version: "0.1.0" };

type McpCommand<TType extends HostDaemonOnlineRpcCommand["type"]> = Extract<
  HostDaemonOnlineRpcCommand,
  { type: TType }
>;

type CatalogKind = McpCatalogChangedMessage["kind"];

interface StdioConnection {
  client: Client;
  catalog: McpStdioCatalog;
  expectedClose: boolean;
}

const BASE_ENV_NAMES = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TMPDIR",
];

export interface McpStdioManagerOptions {
  connectTimeoutMs: number;
  logger: Pick<HostDaemonLogger, "warn">;
  shellEnv(): Readonly<Record<string, string | undefined>>;
  emit(message: McpCatalogChangedMessage | McpConnectionChangedMessage): void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function records(values: readonly unknown[]): Array<Record<string, unknown>> {
  return values.flatMap((value) => {
    const record = asRecord(value);
    return record === null ? [] : [record];
  });
}

function isMethodNotFound(error: unknown): boolean {
  const record = asRecord(error);
  const data = asRecord(record?.data);
  if (record?.code === -32601 || data?.code === -32601) return true;
  return /\bmethod not found\b/i.test(errorText(error));
}

async function optionalCall<T>(
  operation: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (isMethodNotFound(error)) return fallback;
    throw error;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function catalogFrom(values: {
  tools: Tool[];
  prompts: Prompt[];
  resources: Resource[];
  resourceTemplates: ResourceTemplateType[];
}): McpStdioCatalog {
  return {
    tools: records(values.tools),
    prompts: records(values.prompts),
    resources: records(values.resources),
    resourceTemplates: records(values.resourceTemplates),
  };
}

function toolDefinition(
  value: Record<string, unknown> | null,
): Tool | undefined {
  if (value === null || typeof value.name !== "string") return undefined;
  const inputSchema = asRecord(value.inputSchema);
  if (inputSchema === null || inputSchema.type !== "object") return undefined;
  return {
    ...value,
    name: value.name,
    inputSchema: { ...inputSchema, type: "object" },
  };
}

export class McpStdioManager {
  private readonly connections = new Map<string, StdioConnection>();

  constructor(private readonly options: McpStdioManagerOptions) {}

  async start(
    command: McpCommand<"mcp.stdio.start">,
  ): Promise<McpStdioCatalog> {
    const existing = this.connections.get(command.id);
    if (existing) return existing.catalog;
    const client = this.createClient(command.id);
    const transport = new StdioClientTransport({
      command: command.command,
      args: command.args,
      cwd: command.cwd,
      env: { ...this.baseEnv(), ...command.env },
      stderr: "pipe",
    });
    transport.stderr?.on("data", (chunk: Buffer) => {
      const message = chunk.toString("utf8").trim();
      if (message) {
        this.options.logger.warn(
          { mcpServerId: command.id, stderr: message.slice(0, 2000) },
          "MCP stdio stderr",
        );
      }
    });
    const connection: StdioConnection = {
      client,
      catalog: { tools: [], prompts: [], resources: [], resourceTemplates: [] },
      expectedClose: false,
    };
    this.connections.set(command.id, connection);
    transport.onclose = () => {
      if (
        connection.expectedClose ||
        this.connections.get(command.id) !== connection
      )
        return;
      this.connections.delete(command.id);
      this.options.emit({
        type: "mcp.connection-changed",
        id: command.id,
        status: "closed",
        error: "MCP stdio transport closed unexpectedly",
      });
    };
    transport.onerror = (error) => {
      this.options.emit({
        type: "mcp.connection-changed",
        id: command.id,
        status: "error",
        error: errorText(error),
      });
    };
    try {
      const timeoutMs = this.options.connectTimeoutMs;
      await withTimeout(
        client.connect(transport, { timeout: timeoutMs }),
        timeoutMs,
        `connect MCP ${command.id}`,
      );
      return await this.refreshConnection(connection);
    } catch (error) {
      if (this.connections.get(command.id) === connection)
        this.connections.delete(command.id);
      await this.closeConnection(connection);
      throw new Error(errorText(error));
    }
  }

  async refresh(
    command: McpCommand<"mcp.stdio.refresh">,
  ): Promise<McpStdioCatalog> {
    return this.refreshConnection(this.require(command.id));
  }

  async close(
    command: McpCommand<"mcp.stdio.close">,
  ): Promise<HostDaemonOnlineRpcResult<"mcp.stdio.close">> {
    const connection = this.connections.get(command.id);
    if (!connection) return { closed: false };
    this.connections.delete(command.id);
    await this.closeConnection(connection);
    return { closed: true };
  }

  async callTool(
    command: McpCommand<"mcp.stdio.callTool">,
  ): Promise<Record<string, unknown>> {
    const connection = this.require(command.id);
    const definition = toolDefinition(command.toolDefinition);
    const result = await connection.client.callTool(
      { name: command.name, arguments: command.args },
      {
        timeout: REQUEST_TIMEOUT_MS,
        ...(definition ? { toolDefinition: definition } : {}),
      },
    );
    return asRecord(result) ?? {};
  }

  async getPrompt(
    command: McpCommand<"mcp.stdio.getPrompt">,
  ): Promise<Record<string, unknown>> {
    const result = await this.require(command.id).client.getPrompt(
      { name: command.name, arguments: command.args },
      { timeout: REQUEST_TIMEOUT_MS },
    );
    return asRecord(result) ?? {};
  }

  async readResource(
    command: McpCommand<"mcp.stdio.readResource">,
  ): Promise<Record<string, unknown>> {
    const result = await this.require(command.id).client.readResource(
      { uri: command.uri },
      { timeout: REQUEST_TIMEOUT_MS, cacheMode: "bypass" },
    );
    return asRecord(result) ?? {};
  }

  async closeAll(): Promise<void> {
    const values = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(
      values.map((connection) => this.closeConnection(connection)),
    );
  }

  private baseEnv(): Record<string, string> {
    const shellEnv = this.options.shellEnv();
    const env: Record<string, string> = {};
    for (const name of BASE_ENV_NAMES) {
      const value = shellEnv[name];
      if (value) env[name] = value;
    }
    return env;
  }

  private require(id: string): StdioConnection {
    const connection = this.connections.get(id);
    if (!connection) throw new Error(`MCP stdio connection not found: ${id}`);
    return connection;
  }

  private createClient(id: string): Client {
    const onChanged = (kind: CatalogKind) => (error: Error | null) => {
      this.options.emit({
        type: "mcp.catalog-changed",
        id,
        kind,
        error: error ? errorText(error) : null,
      });
    };
    const clientOptions: ClientOptions = {
      capabilities: {},
      versionNegotiation: { mode: "auto" },
      listChanged: {
        tools: { autoRefresh: true, onChanged: onChanged("tools") },
        prompts: { autoRefresh: true, onChanged: onChanged("prompts") },
        resources: { autoRefresh: true, onChanged: onChanged("resources") },
      },
    };
    return new Client(MCP_CLIENT_INFO, clientOptions);
  }

  private async refreshConnection(
    connection: StdioConnection,
  ): Promise<McpStdioCatalog> {
    const options = {
      timeout: REQUEST_TIMEOUT_MS,
      cacheMode: "refresh" as const,
    };
    const [tools, prompts, resources, resourceTemplates] = await Promise.all([
      optionalCall(() => connection.client.listTools(undefined, options), {
        tools: [],
      }),
      optionalCall(() => connection.client.listPrompts(undefined, options), {
        prompts: [],
      }),
      optionalCall(() => connection.client.listResources(undefined, options), {
        resources: [],
      }),
      optionalCall(
        () => connection.client.listResourceTemplates(undefined, options),
        { resourceTemplates: [] },
      ),
    ]);
    connection.catalog = catalogFrom({
      tools: tools.tools,
      prompts: prompts.prompts,
      resources: resources.resources,
      resourceTemplates: resourceTemplates.resourceTemplates,
    });
    return connection.catalog;
  }

  private async closeConnection(connection: StdioConnection): Promise<void> {
    connection.expectedClose = true;
    await withTimeout(
      connection.client.close(),
      CLOSE_TIMEOUT_MS,
      "close MCP stdio",
    ).catch(() => undefined);
  }
}
