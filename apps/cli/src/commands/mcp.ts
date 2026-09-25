import { Command } from "commander";
import type {
  McpAddServerArgs,
  McpPolicyMode,
  McpRegistryHitResult,
  McpServerRecordResult,
  McpToolPolicyResult,
} from "@bb/sdk";
import { action } from "../action.js";
import { CliUsageError } from "../cli-usage-error.js";
import { createCliBbSdk } from "../client.js";
import { resolveContextThreadId } from "../context-env.js";
import { addProviderGuardCommand } from "./provider.js";
import { collectOption, outputJson, type JsonOutputOptions } from "./helpers.js";

const POLICY_MODES: readonly McpPolicyMode[] = [
  "inherit",
  "allow",
  "confirm",
  "deny",
];
const REGISTRY_LIMIT = 12;

interface McpListOptions extends JsonOutputOptions {
  details?: boolean;
}

interface McpAddOptions extends JsonOutputOptions {
  header: string[];
  sse?: boolean;
}

interface McpRegistryOptions extends JsonOutputOptions {
  http?: boolean;
}

interface McpToolsOptions extends JsonOutputOptions {
  server?: string;
}

interface McpHeaderOptions extends JsonOutputOptions {
  header: string[];
}

interface McpGuideOptions extends JsonOutputOptions {
  clear?: boolean;
}

function usageError(message: string, hint: string | null = null): never {
  throw new CliUsageError({ code: "invalid_value", hint, message });
}

function parseMcpHeaderLines(
  lines: readonly string[],
): Record<string, string> {
  const headers: Record<string, string> = {};
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const index = line.indexOf(":");
    const name = index > 0 ? line.slice(0, index).trim() : "";
    const value = index > 0 ? line.slice(index + 1).trim() : "";
    if (!name || !value)
      usageError(`invalid header (use Name: value): ${line}`);
    const lower = name.toLowerCase();
    if (seen.has(lower)) usageError(`duplicate header: ${name}`);
    seen.add(lower);
    headers[name] = value;
  }
  return headers;
}

function nonEmpty(
  headers: Record<string, string>,
): Record<string, string> | undefined {
  return Object.keys(headers).length > 0 ? headers : undefined;
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//iu.test(value);
}

interface BuildAddRequestArgs {
  operands: readonly string[];
  commandLength: number | null;
  headers: Record<string, string>;
  sse: boolean;
}

function buildMcpAddRequest(args: BuildAddRequestArgs): McpAddServerArgs {
  const headers = nonEmpty(args.headers);
  if (args.commandLength !== null) {
    const before = args.operands.slice(
      0,
      args.operands.length - args.commandLength,
    );
    const [command, ...commandArgs] = args.operands.slice(before.length);
    const name = before[0];
    if (before.length !== 1 || !name || !command)
      usageError("Usage: bb mcp add <name> -- <command> [args...]");
    if (headers || args.sse)
      usageError("--header and --sse apply to HTTP servers, not commands");
    return { kind: "stdio", name, command, args: commandArgs };
  }
  if (args.operands.length > 2)
    usageError(
      "Usage: bb mcp add <name> <url|registry-id>",
      "Put `--` before a local command: bb mcp add <name> -- <command> [args...]",
    );
  const [first, second] = args.operands;
  const source = second ?? first;
  if (!source) usageError("Usage: bb mcp add <name> <url|registry-id>");
  const name = second === undefined ? undefined : first;
  if (looksLikeUrl(source) || args.sse) {
    return {
      kind: "http",
      url: source,
      transport:
        args.sse || source.includes("/sse") ? "sse" : "streamable-http",
      ...(name ? { name } : {}),
      ...(headers ? { headers } : {}),
    };
  }
  return {
    kind: "registry",
    registryName: source,
    ...(name ? { name } : {}),
    ...(headers ? { headers } : {}),
  };
}

function commandLengthAfterTerminator(program: Command): number | null {
  const rawArgs = (program as Command & { rawArgs?: string[] }).rawArgs ?? [];
  const terminator = rawArgs.indexOf("--");
  return terminator < 0 ? null : rawArgs.length - terminator - 1;
}

function formatMcpServer(server: McpServerRecordResult): string {
  return [
    `id: ${server.id}`,
    `handle: ${server.handle}`,
    `name: ${server.name}`,
    `type: ${server.type}`,
    `status: ${server.status}`,
    `enabled: ${server.enabled}`,
    `auth: ${server.authStatus}`,
    server.sourceRef ? `source: ${server.sourceRef}` : null,
    server.registryName ? `registry: ${server.registryName}` : null,
    server.lastError ? `error: ${server.lastError}` : null,
    server.guide ? `guide: ${server.guide}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function formatRegistryHit(hit: McpRegistryHitResult): string {
  const kind = hit.remote ? "http" : (hit.type ?? "unsupported");
  const headers = hit.requiredHeaders.length
    ? `headers:${hit.requiredHeaders.join(",")}`
    : "";
  return `${kind}  ${hit.name}  ${headers}  ${hit.description}`
    .replace(/\s+/gu, " ")
    .trim();
}

function formatMcpPolicyRows(
  rows: readonly McpToolPolicyResult[],
): string {
  const width = Math.max(...rows.map((row) => row.tool.length));
  return rows
    .map(
      (row) =>
        `${row.tool.padEnd(width)}  ${row.risk.padEnd(11)}  ${row.policy}${row.mode === "inherit" ? " (default)" : ""}`,
    )
    .join("\n");
}

function parsePolicyMode(value: string): McpPolicyMode {
  const mode = POLICY_MODES.find((entry) => entry === value);
  if (!mode) usageError(`mode must be one of: ${POLICY_MODES.join(", ")}`);
  return mode;
}

function parseCallArgs(parts: readonly string[]): Record<string, unknown> {
  if (parts.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(parts.join(" "));
  } catch {
    usageError("call args must be JSON object");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    usageError("call args must be JSON object");
  return Object.fromEntries(Object.entries(parsed));
}

export function registerMcpCommands(
  program: Command,
  getUrl: () => string,
): void {
  const mcp = program
    .command("mcp")
    .description("Manage MCP servers for every provider");

  mcp
    .command("list")
    .description("List installed MCP servers")
    .option("--details", "Include full server records")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: McpListOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const servers = opts.details
          ? await sdk.mcp.list({ details: true })
          : await sdk.mcp.list();
        if (outputJson(opts, servers)) return;
        console.log(
          servers.length === 0
            ? "No MCP servers. Try: bb mcp registry notion"
            : servers
                .map(
                  (item) =>
                    `${item.id}  ${item.handle}  ${item.type}  ${item.status}`,
                )
                .join("\n"),
        );
      }),
    );

  mcp
    .command("show <server>")
    .description("Show one MCP server by ID or handle")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (server: string, opts: JsonOutputOptions) => {
        const record = await createCliBbSdk(getUrl()).mcp.get({ server });
        if (outputJson(opts, record)) return;
        console.log(formatMcpServer(record));
      }),
    );

  mcp
    .command("add <name> [source] [command...]")
    .description(
      "Add an HTTP URL, registry id, or local command (bb mcp add <name> -- <command> [args...])",
    )
    .option(
      "--header <line>",
      "HTTP header as 'Name: value'; repeat for more",
      collectOption,
      [],
    )
    .option("--sse", "Use the legacy SSE transport for an HTTP URL")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          name: string,
          source: string | undefined,
          command: string[],
          opts: McpAddOptions,
        ) => {
          const request = buildMcpAddRequest({
            operands: [name, ...(source ? [source] : []), ...command],
            commandLength: commandLengthAfterTerminator(program),
            headers: parseMcpHeaderLines(opts.header),
            sse: opts.sse === true,
          });
          const added = await createCliBbSdk(getUrl()).mcp.add(request);
          if (outputJson(opts, added)) return;
          console.log(`Added ${added.name} (${added.id})`);
        },
      ),
    );

  mcp
    .command("registry <query...>")
    .description("Search the official MCP Registry")
    .option("--http", "Only show servers with an HTTP remote")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (query: string[], opts: McpRegistryOptions) => {
        const hits = await createCliBbSdk(getUrl()).mcp.searchRegistry({
          query: query.join(" ").trim(),
          limit: REGISTRY_LIMIT,
          remoteOnly: opts.http === true,
        });
        if (outputJson(opts, hits)) return;
        console.log(
          hits.length === 0
            ? "No registry matches."
            : hits.map(formatRegistryHit).join("\n"),
        );
      }),
    );

  mcp
    .command("tools <query...>")
    .description("Search tools on enabled servers")
    .option("--server <server>", "Only search one server by ID or handle")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (query: string[], opts: McpToolsOptions) => {
        const result = await createCliBbSdk(getUrl()).mcp.searchTools({
          query: query.join(" ").trim(),
          ...(opts.server ? { server: opts.server } : {}),
        });
        if (outputJson(opts, result)) return;
        const lines = result.tools.map(
          (tool) => `${tool.id}  ${tool.name}  ${tool.description}`,
        );
        if (result.unavailable && result.unavailable.length > 0)
          lines.push(`unavailable: ${result.unavailable.join("; ")}`);
        console.log(
          lines.length === 0 ? "No matching tools." : lines.join("\n"),
        );
      }),
    );

  mcp
    .command("auth <server>")
    .description("Start or inspect OAuth for an HTTP server")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (server: string, opts: JsonOutputOptions) => {
        const result = await createCliBbSdk(getUrl()).mcp.authenticate({
          server,
        });
        if (outputJson(opts, result)) return;
        console.log(
          result.url ? `${result.status}\n${result.url}` : result.status,
        );
      }),
    );

  mcp
    .command("header <server> [line...]")
    .description("Set HTTP headers on a cloud server ('Name: value')")
    .option(
      "--header <line>",
      "Another header as 'Name: value'; repeat for more",
      collectOption,
      [],
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (server: string, line: string[], opts: McpHeaderOptions) => {
          const inline = line.join(" ").trim();
          const lines = inline ? [...opts.header, inline] : opts.header;
          if (lines.length === 0)
            usageError("Pass a header as 'Name: value'");
          const record = await createCliBbSdk(getUrl()).mcp.setHeaders({
            server,
            headers: parseMcpHeaderLines(lines),
          });
          if (outputJson(opts, { updated: true, id: record.id })) return;
          console.log(`Updated headers for ${server}`);
        },
      ),
    );

  for (const [name, enabled] of [
    ["enable", true],
    ["disable", false],
  ] as const) {
    mcp
      .command(`${name} <server>`)
      .description(`${enabled ? "Enable" : "Disable"} a server`)
      .option("--json", "Print machine-readable JSON output")
      .action(
        action(async (server: string, opts: JsonOutputOptions) => {
          const result = await createCliBbSdk(getUrl()).mcp.setEnabled({
            server,
            enabled,
          });
          if (outputJson(opts, result)) return;
          console.log(`${name}d ${server}`);
        }),
      );
  }

  mcp
    .command("remove <server>")
    .description("Remove a server")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (server: string, opts: JsonOutputOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const record = await sdk.mcp.get({ server });
        const result = await sdk.mcp.remove({ server: record.id });
        if (outputJson(opts, result)) return;
        console.log(`Removed ${record.name}`);
      }),
    );

  mcp
    .command("call <id> [args...]")
    .description("Call one MCP tool by tool ID with a JSON object of arguments")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (id: string, args: string[], opts: JsonOutputOptions) => {
        const result = await createCliBbSdk(getUrl()).mcp.callTool({
          id,
          args: parseCallArgs(args),
          threadId: resolveContextThreadId() ?? null,
        });
        if (outputJson(opts, result)) return;
        console.log(JSON.stringify(result, null, 2));
      }),
    );

  mcp
    .command("guide <server> [text...]")
    .description("Show, set, or clear the agent guide for a server")
    .option("--clear", "Remove the guide")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (server: string, text: string[], opts: McpGuideOptions) => {
        const guide = text.join(" ").trim();
        if (opts.clear && guide)
          usageError("Pass guide text or --clear, not both");
        const sdk = createCliBbSdk(getUrl());
        if (!opts.clear && !guide) {
          const record = await sdk.mcp.get({ server });
          const view = {
            id: record.id,
            handle: record.handle,
            guide: record.guide,
          };
          if (outputJson(opts, view)) return;
          console.log(record.guide ?? `No guide for ${record.handle}.`);
          return;
        }
        const result = await sdk.mcp.setGuide({
          server,
          guide: opts.clear ? null : guide,
        });
        if (outputJson(opts, result)) return;
        console.log(
          result.guide === null
            ? `Cleared guide for ${result.handle}`
            : `Updated guide for ${result.handle}`,
        );
      }),
    );

  mcp
    .command("policy <server> [tool] [mode]")
    .description(
      "List or set per-tool call policies (allow, confirm, deny, inherit)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          server: string,
          tool: string | undefined,
          mode: string | undefined,
          opts: JsonOutputOptions,
        ) => {
          const sdk = createCliBbSdk(getUrl());
          if (tool === undefined) {
            const rows = await sdk.mcp.listPolicies({ server });
            if (outputJson(opts, rows)) return;
            console.log(
              rows.length === 0
                ? "No tools reported yet."
                : formatMcpPolicyRows(rows),
            );
            return;
          }
          if (mode === undefined) {
            const rows = await sdk.mcp.listPolicies({ server });
            const row = rows.find((item) => item.tool === tool);
            if (!row)
              throw new CliUsageError({
                code: "not_found",
                hint: `List the tools with: bb mcp policy ${server}`,
                message: `Tool not found on ${server}: ${tool}`,
              });
            if (outputJson(opts, row)) return;
            console.log(formatMcpPolicyRows([row]));
            return;
          }
          const row = await sdk.mcp.setPolicy({
            server,
            tool,
            mode: parsePolicyMode(mode),
          });
          if (outputJson(opts, row)) return;
          console.log(formatMcpPolicyRows([row]));
        },
      ),
    );

  addProviderGuardCommand(mcp.command("providers"), getUrl).description(
    "Alias for bb provider guard",
  );
}
