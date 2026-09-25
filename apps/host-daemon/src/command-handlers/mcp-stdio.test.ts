import { afterEach, describe, expect, it } from "vitest";
import type {
  McpCatalogChangedMessage,
  McpConnectionChangedMessage,
} from "@bb/host-daemon-contract";
import { McpStdioManager } from "./mcp-stdio.js";

const FIXTURE = String.raw`
let buffer = "";
function send(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function handle(message) {
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send(message.id, { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "host-fixture", version: "1" } });
    return;
  }
  if (message.method === "tools/list") {
    send(message.id, { tools: [{ name: "echo", description: "Echo", inputSchema: { type: "object" } }] });
    return;
  }
  if (message.method === "tools/call") {
    send(message.id, { content: [{ type: "text", text: "host " + process.env.FIXTURE_TOKEN + " " + JSON.stringify(message.params.arguments) }] });
    if (message.params.arguments.exit) setTimeout(() => process.exit(0), 20);
    return;
  }
  send(message.id, {});
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) handle(JSON.parse(line));
  }
});
`;

const managers: McpStdioManager[] = [];

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.closeAll()));
});

function createManager(connectTimeoutMs = 15_000) {
  const messages: Array<
    McpCatalogChangedMessage | McpConnectionChangedMessage
  > = [];
  const manager = new McpStdioManager({
    connectTimeoutMs,
    logger: { warn() {} },
    shellEnv: () => ({
      PATH: process.env.PATH ?? "",
      HOME: "/tmp",
      SECRET: "not-forwarded",
    }),
    emit: (message) => messages.push(message),
  });
  managers.push(manager);
  return { manager, messages };
}

function startCommand(id: string, args: string[]) {
  return {
    type: "mcp.stdio.start" as const,
    id,
    command: process.execPath,
    args,
    cwd: "/tmp",
    env: { FIXTURE_TOKEN: "tok" },
  };
}

describe("MCP stdio manager", () => {
  it("owns stdio MCP connections and exposes their catalog and calls", async () => {
    const { manager } = createManager();
    const catalog = await manager.start(
      startCommand("mcp_fixture000", ["-e", FIXTURE]),
    );
    expect(catalog.tools).toEqual([expect.objectContaining({ name: "echo" })]);
    expect(
      await manager.start(startCommand("mcp_fixture000", ["-e", FIXTURE])),
    ).toEqual(catalog);
    const result = await manager.callTool({
      type: "mcp.stdio.callTool",
      id: "mcp_fixture000",
      name: "echo",
      args: { a: 1 },
      toolDefinition: null,
    });
    expect(result).toEqual(
      expect.objectContaining({
        content: [{ type: "text", text: 'host tok {"a":1}' }],
      }),
    );
    await expect(
      manager.close({ type: "mcp.stdio.close", id: "mcp_fixture000" }),
    ).resolves.toEqual({ closed: true });
    await expect(
      manager.refresh({ type: "mcp.stdio.refresh", id: "mcp_fixture000" }),
    ).rejects.toThrow("connection not found");
  }, 15_000);

  it("gives up on a stalled handshake and leaves no live connection", async () => {
    const { manager } = createManager(200);
    await expect(
      manager.start(
        startCommand("mcp_stalled000", ["-e", "process.stdin.resume()"]),
      ),
    ).rejects.toThrow();
    await expect(
      manager.close({ type: "mcp.stdio.close", id: "mcp_stalled000" }),
    ).resolves.toEqual({ closed: false });
  }, 5_000);

  it("reports an unexpected process exit to the server", async () => {
    const { manager, messages } = createManager();
    await manager.start(startCommand("mcp_exiting00", ["-e", FIXTURE]));
    await manager.callTool({
      type: "mcp.stdio.callTool",
      id: "mcp_exiting00",
      name: "echo",
      args: { exit: true },
      toolDefinition: null,
    });
    await expect
      .poll(() => messages)
      .toContainEqual(
        expect.objectContaining({
          type: "mcp.connection-changed",
          id: "mcp_exiting00",
          status: "closed",
        }),
      );
    await expect(
      manager.close({ type: "mcp.stdio.close", id: "mcp_exiting00" }),
    ).resolves.toEqual({ closed: false });
  }, 15_000);
});
