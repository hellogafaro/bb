import { Link } from "react-router-dom";
import { getAgentDetailRoutePath } from "@bb/client-core";
import type { Thread } from "@bb/domain";
import { DetailRow, DetailRowIconLabel } from "@/components/ui/detail-card.js";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { agentExecutionLabel } from "./agent-display";
import { AgentMascot } from "./mascots/AgentMascot";
import { ProviderMark } from "./ProviderMark";

export function ThreadAgentRow({
  thread,
}: {
  thread: Pick<Thread, "agentId">;
}) {
  const agentsQuery = useAgents();
  const providersQuery = useSystemProviders();
  const agent = resolveThreadAgent(agentsQuery.data ?? [], thread.agentId);
  if (agent === null) return null;
  return (
    <DetailRow
      label={<DetailRowIconLabel icon="UserSmile">Agent</DetailRowIconLabel>}
      valueClassName="min-w-0"
    >
      <span className="flex min-w-0 items-start gap-2">
        <AgentMascot
          mascot={agent.mascot}
          color={agent.color}
          className="mt-0.5 size-4"
        />
        <span className="flex min-w-0 flex-col">
          <Link
            to={getAgentDetailRoutePath(agent.id)}
            className="truncate hover:underline"
          >
            {agent.name}
          </Link>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <ProviderMark providerId={agent.providerId} className="size-3" />
            <span className="truncate">
              {agentExecutionLabel(agent, providersQuery.data)}
            </span>
          </span>
        </span>
      </span>
    </DetailRow>
  );
}
