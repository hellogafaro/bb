import { patchThreadPluginMetadata } from "@bb/db";
import type { Agent } from "@bb/domain";
import type { AppDeps } from "../../types.js";

export const AGENT_MCP_METADATA_KEY = "mcp";

export function agentInstructionSection(agent: Agent): string[] {
  const instructions = agent.instructions.trim();
  if (instructions.length === 0) return [];
  return [
    `The following instructions come from the BB agent "${agent.name}":`,
    instructions,
  ];
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
