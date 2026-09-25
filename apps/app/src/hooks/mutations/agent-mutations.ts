import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { UpdateAgentRequest } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  applyAgent,
  invalidateAgents,
  removeAgent,
} from "../cache-owners/agent-cache-owner";

export function useUpdateAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to update the agent." },
    mutationFn: ({
      agentId,
      update,
    }: {
      agentId: string;
      update: UpdateAgentRequest;
    }) => sdk.agents.update({ agent: agentId, ...update }),
    onSuccess: (agent) => {
      applyAgent({ queryClient, agent });
    },
    onSettled: () => {
      invalidateAgents({ queryClient });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to delete the agent." },
    mutationFn: ({ agentId }: { agentId: string }) =>
      sdk.agents.remove({ agent: agentId }),
    onSuccess: (_result, { agentId }) => {
      removeAgent({ queryClient, agentId });
    },
    onSettled: () => {
      invalidateAgents({ queryClient });
    },
  });
}
