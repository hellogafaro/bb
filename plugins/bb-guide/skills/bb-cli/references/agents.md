# Agents

Every thread runs as an agent. An agent sets the provider, model, reasoning
level, skills, MCP servers, and extra instructions of the threads it runs;
permissions are always full. A thread's agent is fixed at spawn.

- `bb agent list [--json]` lists agents. The first one is the default agent;
  threads without an agent, or whose agent was deleted, run as it. BB creates
  "bb" on first start from the current default provider and model.
- `bb agent show <agent> [--json]` accepts a name (case-insensitive) or an ID
  (`agent_...`).
- `bb agent create <name> [--provider <id>] [--model <model>] [--reasoning
  <level>] [--skill <name>]... [--mcp <handle>]... [--description <text>]
  [--instructions <text> | --instructions-file <path>]` fills omitted fields
  from the default agent's provider and model, medium reasoning, all skills,
  and all MCPs. Use `--instructions-file` for multi-line text.
- `bb agent set <agent> <field> <value>` changes one field: name, description,
  provider, model, reasoning, skills, mcp, or instructions. `skills` and `mcp`
  take comma lists. `--clear` resets model (provider default), skills and mcp
  (all), description, or instructions. `bb agent set <agent> instructions
  --instructions-file <path>` reads instructions from a file. Renaming keeps
  the ID; changing the provider without a model clears the model.
- `bb agent remove <agent>` deletes an agent; its threads fall back to the
  default agent. The last agent cannot be deleted.
- `bb thread spawn --project <id> --agent <agent> --prompt "..."` runs the
  thread as that agent; omit `--agent` for the default. `--provider`,
  `--model`, `--reasoning-level`, and `--permission-mode` are rejected.
- `bb thread show <id>` prints `Agent: <name>`.

Empty `skills` means every BB skill; empty `mcp` lists every enabled MCP
server. Agent instructions are appended after workspace instructions.

SDK: `sdk.agents.list|get|create|update|remove` and
`sdk.threads.spawn({ agent })`. Routes live under `/api/v1/agents`. Run
`bb guide agents` for the full chapter.
