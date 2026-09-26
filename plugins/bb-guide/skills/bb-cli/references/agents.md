# Agents

Every thread runs as an agent. An agent sets the provider, model, reasoning
level, skills, MCP servers, and extra instructions of the threads it runs;
permissions are always full. A thread's agent is fixed at spawn.

- `bb agent list [--json]` lists agents. The first one is the default agent;
  threads without an agent, or whose agent was deleted, run as it. BB creates
  "bb" on first start from the current default provider and model.
- `bb agent show <handle> [--json]` accepts the handle (lowercase name, e.g. `dexter`), the name, or the ID
  (`agent_...`).
- `bb agent create <name> [--provider <id>] [--model <model>] [--reasoning
  <level>] [--skill <name>]... [--mcp <handle>]... [--description <text>]
  [--instructions <text> | --instructions-file <path>] [--mascot <name>]
  [--color <1-8>]` fills omitted fields from the default agent's provider and
  model, medium reasoning, all skills, and all MCPs, and picks the mascot and
  color from a stable hash of the name. Use `--instructions-file` for
  multi-line text.
- `bb agent set <handle> <field> <value>` changes one field: name, description,
  provider, model, reasoning, skills, mcp, instructions, mascot, or color.
  `skills` and `mcp` take comma lists; `mascot` is one of invader, ghost,
  robot, cat, skull, crab, mushroom, rocket, dino, frog; `color` is 1-8. `--clear` resets model (provider default), skills and mcp
  (all), description, or instructions. `bb agent set <handle> instructions
  --instructions-file <path>` reads instructions from a file. Renaming keeps
  the ID; changing the provider without a model clears the model.
- `bb agent home <handle> [--json]` prints the agent's home folder,
  `<data-dir>/agents/<slug>/` (slug: lowercased name, other characters `-`).
  `bb agent show` prints it as `Home:`; the DTO field is `homePath`.
- `bb agent remove <handle>` deletes an agent; its threads fall back to the
  default agent. The last agent cannot be deleted. Its home moves to
  `<data-dir>/agents/.deleted/<slug>-<timestamp>/`.
- `bb thread spawn --project <id> --agent <handle> --prompt "..."` runs the
  thread as that agent; omit `--agent` for the default. `--provider`,
  `--model`, `--reasoning-level`, and `--permission-mode` are rejected.
- `bb thread show <id>` prints `Agent: <name>`. `bb agent show` prints the
  mascot and color (0 is neutral gray, settable only through the API). App
  thread lists show the mascot as the thread's status: animated while work
  runs, red after an unread failure, amber while waiting on the user, with a
  green dot when unread.

Empty `skills` means every BB skill; empty `mcp` lists every enabled MCP
server. Agent instructions are appended after workspace instructions.

The home folder persists across threads and projects: keep notes,
inventories, scripts, and reference files there. Threads on the server's
machine get `BB_AGENT_HOME` and a line pointing at it. `<home>/skills/` holds
private skills injected only into that agent's threads. `<data-dir>/agents/`
is a git repo; BB commits an agent's folder after each turn that changed it
(`<agent>: <thread title> (<thread id>)`, no push). The app's agent page has a
Files section for the folder.

SDK: `sdk.agents.list|get|create|update|remove` and
`sdk.threads.spawn({ agent })`. Routes live under `/api/v1/agents`. Run
`bb guide agents` for the full chapter.
