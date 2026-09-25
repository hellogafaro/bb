import { Link } from "react-router-dom";
import { getAgentDetailRoutePath } from "@bb/client-core";
import type { Thread } from "@bb/domain";
import { DetailRow, DetailRowIconLabel } from "@/components/ui/detail-card.js";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { agentExecutionLabel } from "./agent-display";
import { AgentIcon } from "./AgentIcon";

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
        <AgentIcon providerId={agent.providerId} className="mt-0.5 size-4" />
        <span className="flex min-w-0 flex-col">
          <Link
            to={getAgentDetailRoutePath(agent.id)}
            className="truncate hover:underline"
          >
            {agent.name}
          </Link>
          <span className="truncate text-xs text-muted-foreground">
            {agentExecutionLabel(agent, providersQuery.data)}
          </span>
        </span>
      </span>
    </DetailRow>
  );
}
