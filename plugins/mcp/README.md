# MCPs

Built-in BB plugin that is the MCP registry for every provider: official registry plus
manual stdio/HTTP servers, exposed as a small lazy catalog (`mcp_search` with
compact input maps, then `mcp_call`; `mcp_schema` when more detail is needed)
instead of dumping every schema into context.

Source: `plugins/mcp` in the BB monorepo. The plugin ID is `mcp`;
settings, OAuth credentials, and server data live under that ID.

Storage is the plugin's SQLite database with two tables: `sources` (one row
per server: `id`, unique `handle`, name, transport `type`, `configJson`,
`status`, `lastError`, `enabled`, `guide`, and registry provenance) and
`tool_policies` (`sourceId`, `toolName`, `risk`, `mode`, deleted with their
source). OAuth credentials are one BB secret keyed by source ID, and stdio
working directories live under `plugins/mcp/servers/<id>/`.

```
pnpm exec turbo run typecheck --filter=bb-plugin-mcp
pnpm exec turbo run test --filter=bb-plugin-mcp
bb plugin install builtin:mcp --yes
```

CLI: `bb mcp list`, `bb mcp registry <query>`, `bb mcp add <name> <url|registry-id>`,
`bb mcp auth <id>`, `bb mcp guide <id> [text] [--clear]`, `bb mcp remove <id>`,
`bb mcp policy <id> [tool] [allow|confirm|deny|inherit]`,
`bb mcp providers [--fix] [--machine <id>] [--path <dir>]`. Adding a server
enables it; enabled is the only gate on connecting and calling. `<id>`
accepts the server's `mcp_` ID, handle, or name.

The MCPs page lists installed servers and opens a detail page for each (enable,
authenticate, remove, agent guide, tools). It has no registry browser or add
forms: **New MCP** opens chat with a prompt that has the agent run `bb mcp
registry`/`bb mcp add`, and **Edit in chat** prefills a prompt with the server's
`bb mcp` commands. Core BB renders the Skills | MCPs tabs above the panel; the
plugin page starts with its list. Registry search and manual adds are CLI-only.

The detail page's tool list shows each tool's risk and a policy select (see
Policies and approvals below).

Agent instructions list enabled servers with their descriptions and guides; see
`PLUGIN_OVERVIEW.md` for the format and the `servers` thread-metadata key.

## Policies and approvals

Every tool has a risk from its MCP annotations: `readOnlyHint` is `read`,
`destructiveHint` is `destructive`, anything else is `write`. The first catalog
load seeds a `tool_policies` row per tool with mode `inherit`; later loads
update the risk and keep the mode. The effective policy is the explicit mode,
or for `inherit`, `allow` for read tools and `confirm` for write and
destructive tools.

`mcp_call` and `bb mcp call` enforce it before contacting the server:

- `allow` runs the tool.
- `deny` returns an error naming the policy; the tool is not run.
- `confirm` opens a BB interaction in the calling thread
  (`bb.ui.requestInput`, renderer `mcp-approval`) showing the server, tool,
  risk, and arguments (first 4,000 characters). Approve runs the tool; Deny,
  dismissal, stopping the thread, or 10 minutes without an answer return an
  error and nothing runs. While it waits, the agent gets BB's waiting notice
  and the result arrives later as a message. Approvals are logged with the
  thread ID. A `bb mcp call` without a thread context has nowhere to ask and
  returns an error.

`bb mcp policy <id>` lists tools with risk and effective policy (`(default)`
marks `inherit`); `bb mcp policy <id> <tool>` shows one; adding a mode sets it.
The same data is available over RPC as `listToolPolicies({ id })` and
`setToolPolicy({ id, tool, mode })`. `mcp_search` rows carry `policy` when it
is not `allow`, next to `risk` when it is not `read`.

## Warmup and elicitation

Catalogs for enabled servers load in the background one second after the
plugin starts and 250 ms after any server change (add, enable, auth, headers,
policy, guide), so the first `mcp_search` in a thread is usually warm. Warmup
never blocks startup, skips servers whose catalog is cached, and reuses the
five-second failure backoff; results are logged at info.

HTTP servers that send `elicitation/create` (form mode) during a tool call get
a BB interaction in the thread that made the call: one field per string,
number, integer, boolean, or enum property. Submitted values are type-checked
against the requested schema before they are returned. Decline, invalid
answers, a form with an unsupported required field, URL-mode requests, calls
without a thread, and the 10-minute timeout all answer `decline`; dismissing
the form answers `cancel`. Host-isolated stdio servers do not advertise
elicitation. Sampling and roots stay off.

## Provider guard

Claude Code and Codex should use only these MCPs. The host RPC
`providerMcpStatus` reads, on the target machine:

- `~/.claude/settings.json` (`disableClaudeAiConnectors`),
- `~/.claude.json` top-level `mcpServers` and `projects.*.mcpServers`
  (`$CLAUDE_CONFIG_DIR` replaces `~/.claude` and holds `.claude.json` when set),
- `<path>/.mcp.json` when a path is given,
- `$CODEX_HOME/config.toml` (default `~/.codex`) `mcp_servers` tables, dotted
  keys, and inline tables, found with a line scan rather than a TOML parser.

`providerMcpFix` sets `"disableClaudeAiConnectors": true` in
`~/.claude/settings.json`, creating it if missing and keeping every other key;
the write goes through a temporary file and a rename. MCP entries are never
removed automatically.

`bb mcp providers` prints the status for the primary machine (or `--machine
<id>`), checking `.mcp.json` in `--path` or, without `--machine`, the CLI's
working directory. Each entry names its file and how to remove it by hand.
`--fix` applies `providerMcpFix` and prints the new status. The command exits
0 either way; `--json` includes an `issues` list. The MCPs page shows the same
issues with a button to disable the connectors, and plugin start logs each
issue as a warning.

The guard is not wired into `bb.providers.experimental_contributeEnvHealth`.
That resolver runs only when a provider reports `unauthenticated` or
`expired`, and a non-null result marks the provider ready. It cannot warn
about a signed-in provider, and it would hide a real sign-in failure.

## Reliability checks

Run the typecheck and test tasks above. `tests/reliability.test.ts` exercises the real
MCP client against deterministic HTTP responses: 200 tool calls in five expiry
waves, rotating refresh tokens, delayed 401s, paginated catalogs, fresh credential
store reloads, OAuth outages, expired MCP sessions, missing credentials, and
concurrent credential writes.

Concurrent 401 responses share one OAuth exchange. Temporary OAuth network,
429, and 5xx failures preserve credentials for the next attempt. Failed secret
writes retry up to five times with exponential backoff (1–16 seconds); retries
stop when the plugin is disposed. A failed catalog refresh reports the server
as unavailable and retries after the existing five-second backoff. An expired
MCP session is discarded so the next request reconnects; failed tool calls are
not automatically replayed after session or network errors.

Providers can still revoke authorization or require renewed consent. Stress
fixtures do not expire real account tokens or simulate every provider policy.

## IDs and context

Each server has an `mcp_` ID and a readable `handle` derived from its name
(a random suffix keeps handles unique). Tools, prompts, resources and resource
templates get `mcpt_`, `mcpp_`, `mcpr_` and `mcprt_` IDs hashed from the
server ID and the capability name, so they stay stable across restarts until
the server is removed. Agent tools take a single `id` field; any other field is
rejected, and an ID in another format fails with `Invalid MCP <kind> id` before
any server is contacted.

`mcp_servers` returns 20 entries by default, with a cursor for more. Known zero
tool counts are retained; unknown counts are omitted. Installation metadata,
empty descriptions and prompt/resource counts are available via `details:true`.
The management UI and `bb mcp show <id-or-handle>` retain full diagnostics.
`bb mcp list --json` is compact; `--details` adds diagnostic metadata.

Search emits one input map instead of overlapping shape/field/example objects.
`?` marks optional fields; dots represent nested argument objects. Common value
constraints remain visible, and complex or truncated schemas are explicitly
marked `schemaRequired`. Use the `server` filter on tool, prompt and resource
discovery to avoid unrelated connections. Tool search works directly across
enabled servers, so agents do not need to list servers first. Its optional
result limit is capped at 12 instead of rejecting oversized requests. JSON
responses are compact, empty availability lists are omitted, and oversized
discovery responses remain valid JSON with a full-data artifact link. Agent
output defaults to 8,000 characters.
