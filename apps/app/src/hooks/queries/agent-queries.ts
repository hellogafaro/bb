import { useQuery } from "@tanstack/react-query";
import type { Agent } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import { agentsQueryKey } from "@/hooks/queries/query-keys";
import { useSystemRealtimeSubscription } from "@/hooks/useRealtimeSubscription";

export function useAgents() {
  useSystemRealtimeSubscription();
  return useQuery({
    queryKey: agentsQueryKey(),
    queryFn: ({ signal }) => sdk.agents.list({ signal }),
  });
}

export function findAgentByRef(
  agents: readonly Agent[],
  ref: string,
): Agent | null {
  const lowered = ref.trim().toLowerCase();
  return (
    agents.find((agent) => agent.id === ref) ??
    agents.find((agent) => agent.name.toLowerCase() === lowered) ??
    null
  );
}

export function defaultAgent(agents: readonly Agent[]): Agent | null {
  return agents[0] ?? null;
}

export function resolveThreadAgent(
  agents: readonly Agent[],
  agentId: string | null,
): Agent | null {
  const agent =
    agentId === null ? null : agents.find((entry) => entry.id === agentId);
  return agent ?? defaultAgent(agents);
}

export function useAgent(ref: string) {
  const query = useAgents();
  return {
    ...query,
    agent: query.data === undefined ? null : findAgentByRef(query.data, ref),
  };
}
