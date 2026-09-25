import type { Agent, AgentChangeKind } from "@bb/domain";
import type { QueryClientArg } from "../cache-effect-types";
import { agentsQueryKey } from "../queries/query-keys";
import { invalidateQueryKeys } from "./cache-effect-utils";

interface AgentRealtimeChangeArg extends QueryClientArg {
  changes: readonly AgentChangeKind[];
}

interface AgentArg extends QueryClientArg {
  agent: Agent;
}

interface AgentIdArg extends QueryClientArg {
  agentId: string;
}

export function invalidateAgentRealtimeChange({
  queryClient,
  changes,
}: AgentRealtimeChangeArg): void {
  if (changes.length === 0) return;
  invalidateQueryKeys({ queryClient, queryKeys: [agentsQueryKey()] });
}

export function applyAgent({ queryClient, agent }: AgentArg): void {
  queryClient.setQueryData<Agent[]>(agentsQueryKey(), (current) => {
    if (current === undefined) return current;
    const index = current.findIndex((entry) => entry.id === agent.id);
    if (index === -1) return [...current, agent];
    return current.map((entry) => (entry.id === agent.id ? agent : entry));
  });
}

export function removeAgent({ queryClient, agentId }: AgentIdArg): void {
  queryClient.setQueryData<Agent[]>(agentsQueryKey(), (current) =>
    current?.filter((entry) => entry.id !== agentId),
  );
}

export function invalidateAgents({ queryClient }: QueryClientArg): void {
  invalidateQueryKeys({ queryClient, queryKeys: [agentsQueryKey()] });
}
