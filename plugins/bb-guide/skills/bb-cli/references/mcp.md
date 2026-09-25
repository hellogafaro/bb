# MCP servers

BB connects MCP servers once for every provider. Run `bb guide mcp` for the
full chapter and `bb mcp <command> --help` for current flags.

## Find and add servers

- `bb mcp list --json` lists servers as `[{id, handle, type, status, tools}]`.
  Commands take the stable ID (`mcp_...`) or the handle.
- `bb mcp registry <query> [--http]` searches the official MCP Registry.
- `bb mcp add <name> <url> [--header 'Name: value']... [--sse]` adds an HTTP
  server; a URL path with `/sse` or `--sse` selects the legacy SSE transport.
- `bb mcp add <name> <registry-id> [--header 'Name: value']...` installs a
  registry entry.
- `bb mcp add <name> -- <command> [args...]` adds a local stdio server run by
  the host daemon. Everything after `--` belongs to the command.
- `bb mcp auth <server>` prints the OAuth URL to open, or the auth status.
  `bb mcp header <server> 'Name: value'` replaces an HTTP server's headers.
- `bb mcp enable|disable|remove <server>` change or delete a server.

## Tools, policies, and guides

- `bb mcp tools <query> [--server <server>]` searches tools on enabled servers
  and prints tool IDs. `bb mcp call <tool-id> '<json-object>'` calls one; inside
  a thread the call runs as that thread.
- `bb mcp policy <server> [tool] [allow|confirm|deny|inherit]` lists or sets
  per-tool policies. `inherit` allows read-only tools and confirms the rest.
- `bb mcp guide <server> [text] [--clear]` shows, sets, or clears the guide
  that agents see for that server.

## Approvals and questions

A confirm policy raises an `mcp-approval` interaction in the thread; an MCP
server asking for input raises an `mcp-question`. Inspect them with
`bb thread interactions show <interactionId> <threadId>`.

- Approve or deny a tool call: `bb thread interactions approve|deny
  <interactionId> <threadId>`.
- Answer a question: `bb thread interactions respond <interactionId>
  <threadId> --value '{"action":"accept","content":{"field":"value"}}'`.
  Decline it with `bb thread interactions deny`.

## Provider guard

`bb mcp providers` is an alias of `bb provider guard [--fix] [--machine <id>]
[--path <dir>]`. It reports every MCP server, skill, and plugin source that
Claude Code or Codex would load on their own. `--fix` writes the lockdown
settings for both providers and deletes plugin marketplace clones and caches;
remove the listed MCP servers and skills by hand. See `bb guide providers`.
