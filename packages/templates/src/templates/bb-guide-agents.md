---
kind: instruction
title: bb Agents Guide
summary: Creating and editing agents, the profiles threads run as, and spawning threads as an agent.
intent: Help agents and users pick or shape the agent a thread runs as instead of choosing a provider and model per thread.
editingNotes: Keep commands and flags aligned with bb agent --help, apps/cli/src/commands/agent.ts, and bb thread spawn --agent.
---
Agents

Every thread runs as an agent. An agent names the provider, model, reasoning
level, skills, MCP servers, and extra instructions its threads use.
Permissions are always full. A thread's agent is set when the thread is
spawned and never changes.

Fields:

- name — unique, case-insensitive; commands accept the name or the ID
  (`agent_...`). Renaming keeps the ID.
- description — one line shown in lists.
- provider, model — the provider ID and model ID. An empty model uses the
  provider's default model (remembered project default, then the provider
  catalog default).
- reasoning — low, medium, high, xhigh, or max (provider-dependent).
- skills — BB skill names the agent may use. Empty means every skill.
- mcp — MCP server handles listed to the agent. Empty means every enabled
  server.
- instructions — text appended to every thread's instructions under
  "The following instructions come from the BB agent ...".

The default agent is the first agent (the oldest). BB creates one named "bb"
on first start from the current default provider and model. Threads without
an agent, or whose agent was deleted, run as the default agent. The last agent
cannot be deleted.

Manage agents:

  bb agent list [--json]
  bb agent show <agent> [--json]
  bb agent create <name> [--provider <id>] [--model <model>]
      [--reasoning <level>] [--skill <name>]... [--mcp <handle>]...
      [--description <text>] [--instructions <text> | --instructions-file <path>]
      [--json]
  bb agent set <agent> <field> <value> [--json]
  bb agent set <agent> <field> --clear [--json]
  bb agent set <agent> instructions --instructions-file <path> [--json]
  bb agent remove <agent> [--json]

  create fills omitted fields from the default agent's provider and model,
  medium reasoning, all skills, and all MCPs. set fields are name,
  description, provider, model, reasoning, skills, mcp, and instructions;
  skills and mcp take comma lists (`bb agent set Coder skills bb-cli,notion`).
  --clear resets model (provider default), skills and mcp (all), description,
  or instructions. Changing the provider without a model clears the model.

Spawn as an agent:

  bb thread spawn --project <id> --agent <agent> --prompt "..."

  Omit --agent for the default agent. bb thread spawn rejects --provider,
  --model, --reasoning-level, and --permission-mode: pick an agent instead.
  bb thread show prints the thread's agent.

SDK and API:

  sdk.agents.list(), get({ agent }), create({ name, ... }),
  update({ agent, ...fields }), remove({ agent })
  sdk.threads.spawn({ agent: "Coder", ... }) or { agentId }
  REST: GET/POST /api/v1/agents, GET/PATCH/DELETE /api/v1/agents/<agent>
  Realtime: `changed` messages with entity "agent" (agent-changed,
  agent-deleted).

API callers that pass providerId or model without an agent still get those
for that thread; the default agent supplies everything else.
