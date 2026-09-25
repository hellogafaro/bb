import type { AgentResult, BbSdk } from "@bb/sdk";

export function resolveThreadAgentFromList(
  agents: readonly AgentResult[],
  agentId: string | null,
): AgentResult | null {
  const agent =
    agentId === null ? undefined : agents.find((entry) => entry.id === agentId);
  return agent ?? agents[0] ?? null;
}

export async function fetchThreadAgentName(args: {
  agentId: string | null;
  sdk: Pick<BbSdk, "agents">;
}): Promise<string | null> {
  try {
    const agents = await args.sdk.agents.list();
    return resolveThreadAgentFromList(agents, args.agentId)?.name ?? null;
  } catch {
    return null;
  }
}
