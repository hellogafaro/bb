---
kind: instruction
title: bb MCP Guide
summary: Installing and managing MCP servers, tool policies, guides, and the provider guard, and how agents call MCP tools.
intent: Help agents and users connect MCP servers once for every provider and call their tools through BB.
editingNotes: Keep commands and flags aligned with bb mcp --help and apps/cli/src/commands/mcp.ts.
---
MCP servers

BB connects MCP servers once for every provider. The server keeps the list,
credentials, and per-tool policies; agents reach every enabled server through
BB's built-in mcp_* tools instead of provider-specific MCP config.

Concepts:

- Server — one MCP connection: an HTTP URL (streamable HTTP or legacy SSE),
  an entry from the official MCP Registry, or a local stdio command run by the
  host daemon.
- ID and handle — every server has a stable ID (`mcp_...`) and a short unique
  handle derived from its name (for example `notion`). Commands accept either.
- Tool ID — `bb mcp tools` and the agent's mcp_search return an ID per tool;
  `bb mcp call` and mcp_call take that ID.
- Policy — each tool runs as allow, confirm, or deny. `inherit` (the default)
  allows read-only tools and asks for confirmation on write or destructive ones.
  A confirmation appears in the thread as a pending interaction.
- Guide — optional per-server text (up to 4000 characters) added to agent
  instructions to say when and how to use that server.
- Provider guard — BB should be the only MCP path. Claude Code and Codex must not
  load MCP servers of their own, and claude.ai connectors must be disabled.

Manage servers:

  bb mcp list [--details] [--json]
  bb mcp show <server> [--json]
  bb mcp registry <query> [--http] [--json]
  bb mcp add <name> <url> [--header 'Name: value']... [--sse] [--json]
  bb mcp add <name> <registry-id> [--header 'Name: value']... [--json]
  bb mcp add <name> -- <command> [args...]
  bb mcp auth <server> [--json]
  bb mcp header <server> 'Name: value' [--header 'Name: value']... [--json]
  bb mcp enable <server> [--json]
  bb mcp disable <server> [--json]
  bb mcp remove <server> [--json]

`bb mcp registry` searches the official MCP Registry; `--http` keeps servers
with a hosted remote. `bb mcp add` takes a URL (a path containing `/sse` or
`--sse` selects SSE), a registry name from `bb mcp registry`, or, after `--`,
a local command and its arguments. `bb mcp auth` starts OAuth for an HTTP
server and prints the authorization URL to open, or the current auth status.
`bb mcp header` replaces the server's HTTP headers, for API-key servers.

Tools, guides, and policies:

  bb mcp tools <query> [--server <server>] [--json]
  bb mcp call <tool-id> [json-args] [--json]
  bb mcp guide <server> [text] [--clear] [--json]
  bb mcp policy <server> [--json]
  bb mcp policy <server> <tool> [--json]
  bb mcp policy <server> <tool> allow|confirm|deny|inherit [--json]

`bb mcp call` takes the arguments as one JSON object, for example
`bb mcp call <tool-id> '{"query":"roadmap"}'`. Inside a thread it runs as that
thread, so a confirm policy raises an approval there; outside a thread a
confirm tool is not run.

Answer an MCP approval with `bb thread interactions approve|deny
<interactionId> <threadId>`. An MCP question (a server asking for input) is
answered with `bb thread interactions respond <interactionId> <threadId>
--value '{"action":"accept","content":{...}}'` or declined with
`bb thread interactions deny`. `bb thread interactions show` prints the
requested fields.

Provider guard:

  bb mcp providers [--fix] [--machine <id>] [--path <dir>] [--json]

Checks Claude Code settings, `~/.claude.json`, the project's `.mcp.json`, and
Codex `config.toml` on a machine (default: the primary machine; the current
directory is the project unless `--machine` is given). `--fix` sets
`"disableClaudeAiConnectors": true`; remove other listed servers by hand.

How agents use MCP:

When at least one server is enabled, threads get the built-in tools
mcp_servers, mcp_search, mcp_schema, mcp_call, mcp_prompts, mcp_get_prompt,
mcp_resources, and mcp_read_resource, and a `<connected_mcps>` instructions
section listing each server's handle, description, and guide. Search first with
a short capability phrase (`mcp_search {"query": "create issue"}`), optionally
limited to a server handle, then call the returned ID with `mcp_call {"id":
"<tool-id>", "args": {...}}`. Use mcp_schema only when the search result marks
`schemaRequired` or the input fields are not enough.
