import { useCallback } from "react";
import { Link } from "react-router-dom";
import {
  getAgentDetailRoutePath,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import type { Thread, ThreadListEntry } from "@bb/domain";
import { DetailRow, DetailRowIconLabel } from "@/components/ui/detail-card.js";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useSidebarNavigationThreadSelection } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { agentOptionDetail } from "./agent-display";
import { AgentMascot } from "./mascots/AgentMascot";
import { ThreadStatusMascot } from "./ThreadStatusMascot";

export function ThreadAgentRow({
  thread,
}: {
  thread: Pick<Thread, "id" | "agentId">;
}) {
  const agentsQuery = useAgents();
  const providersQuery = useSystemProviders();
  const selectEntry = useCallback(
    (threads: ThreadListEntry[]) =>
      threads.find((entry) => entry.id === thread.id) ?? null,
    [thread.id],
  );
  const entry = useSidebarNavigationThreadSelection(selectEntry).data ?? null;
  const agent = resolveThreadAgent(agentsQuery.data ?? [], thread.agentId);
  if (agent === null) return null;
  return (
    <DetailRow
      label={<DetailRowIconLabel icon="UserSmile">Agent</DetailRowIconLabel>}
      align="start"
      valueClassName="min-w-0"
    >
      <span
        data-thread-agent-row=""
        className="flex h-5 min-w-0 items-center gap-1.5"
      >
        {entry === null ? (
          <AgentMascot
            mascot={agent.mascot}
            color={agent.color}
            className="size-4"
          />
        ) : (
          <ThreadStatusMascot
            {...threadListIndicatorStateForThread(entry, false)}
            agent={agent}
            archived={entry.archivedAt !== null}
            decorative
          />
        )}
        <Link
          to={getAgentDetailRoutePath(agent.id)}
          className="shrink-0 truncate hover:underline"
        >
          {agent.name}
        </Link>
        <span className="min-w-0 truncate text-muted-foreground">
          · {agentOptionDetail(agent, providersQuery.data)}
        </span>
      </span>
    </DetailRow>
  );
}
