import { getThread, patchThreadPluginMetadata } from "@bb/db";
import type { Agent } from "@bb/domain";
import type { HostDaemonContributedEnvEntry } from "@bb/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { AGENT_HOME_ENV_NAME, commitAgentHomeAfterTurn } from "./agent-home.js";
import { resolveThreadAgent } from "./agents.js";

export const AGENT_MCP_METADATA_KEY = "mcp";

export function agentHomeEnvEntry(
  agent: Agent,
  homePath: string,
): HostDaemonContributedEnvEntry {
  return {
    name: AGENT_HOME_ENV_NAME,
    value: homePath,
    source: { core: "agent-home" },
    reason: `Home folder of the BB agent "${agent.name}"`,
  };
}

export function syncThreadAgentMcpScope(
  deps: Pick<AppDeps, "db">,
  args: { agent: Agent | null; threadId: string },
): void {
  if (args.agent === null) return;
  patchThreadPluginMetadata(deps.db, {
    threadId: args.threadId,
    pluginId: AGENT_MCP_METADATA_KEY,
    set:
      args.agent.mcpServers.length > 0
        ? { servers: args.agent.mcpServers }
        : {},
    remove: args.agent.mcpServers.length > 0 ? [] : ["servers"],
  });
}

export async function commitThreadAgentHome(
  deps: Pick<AppDeps, "config" | "db">,
  threadId: string,
): Promise<boolean> {
  const thread = getThread(deps.db, threadId);
  if (thread === null) return false;
  const agent = resolveThreadAgent(deps, thread);
  if (agent === null) return false;
  return commitAgentHomeAfterTurn(deps.config.dataDir, {
    agent,
    threadId: thread.id,
    threadTitle: thread.title,
  });
}
