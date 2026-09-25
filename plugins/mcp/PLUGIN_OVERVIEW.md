BB's built-in MCP registry: the official MCP Registry plus manual stdio and
HTTP servers, normalized into one catalog that every provider sees. Install it
with `bb plugin install builtin:mcp`.

## What you get

- Add servers in chat: **New MCP** on the MCPs page opens a prefilled prompt
  (with Notion, GitHub, and Slack examples) and the agent adds the server with
  `bb mcp registry` and `bb mcp add`.
- Enable, disable, authenticate, remove, and edit a server's agent guide from
  the MCPs page (under Customize, next to Skills) or `bb mcp`. **Edit in chat**
  prefills a prompt with the server's `bb mcp` commands.
- Agent tools that search and call one tool at a time. They do not dump full
  schemas into the thread.
- Per-tool policies: read-only tools run, write and destructive tools ask
  first in the thread, and any tool can be set to allow, ask first, or block
  from its server's page or `bb mcp policy <id> [tool] [mode]`.
- Answers for servers that ask a question mid-call (MCP elicitation), shown as
  a form in the thread.
- A guard that checks Claude Code and Codex load no MCPs of their own:
  `bb mcp providers [--fix]`, a notice on the MCPs page, and warnings in the
  plugin log.

## How it works

Installed servers live in this plugin's storage. Isolated stdio workers run on
the BB host. Codex, Claude, and other providers all receive the same `mcp_*`
tools — BB has no Anthropic `mcp_toolset`, so discovery is search, not a
catalog dump.

## For agents

Use `mcp_search`, then `mcp_call` with the hit's `id` and input arguments. Use `mcp_schema` when full descriptions or constraints are needed. Prefer these over `agent_plugins_list_tools`.

Search rows include `policy` when a tool is not freely allowed: `confirm` means
the call waits for the user's approval in the thread, and `deny` means it
returns an error without running. Prefer tools without a `policy` field when
several fit.

Each thread's instructions include a `<connected_mcps>` section naming the
enabled servers:

```xml
<connected_mcps>
  <mcp handle="notion" description="Notion pages and databases">
    Search the Engineering space first.
  </mcp>
  <mcp handle="slack" />
  <more count="3" />
</connected_mcps>
Use mcp_search to find tools on connected MCPs, then mcp_call.
```

`description` appears only when the server has one (whitespace collapsed,
clipped to 160 characters). A server's guide (`bb mcp guide <id> [text]`, or
the Agent guide field on its page) is the element's body, clipped to 600
characters with each line indented four spaces; servers without a guide use a
self-closing `<mcp />`. Attribute values escape `&`, `<`, `>`, and `"`; guide
text escapes `&` and `<`. The whole section, including the final sentence,
stays under 4,096 characters: servers that do not fit are dropped with their
guides and counted in `<more count="N" />`. With no servers listed, the
section is omitted.

## Thread metadata

Set `servers` in this plugin's thread metadata (plugin id `mcp`) to an array
of server IDs or handles to limit that thread's `<connected_mcps>` section, for
example `{ "servers": ["notion", "mcp_abc123def4"] }`. An empty array lists
none. Without the key, every enabled server is listed. Search and call scope
are not restricted by this key yet.
