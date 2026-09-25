import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getAgentDetailRoutePath } from "@bb/client-core";
import type { Agent } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceCollectionViewport,
  ResourceListState,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { useAgents } from "@/hooks/queries/agent-queries";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { agentExecutionLabel, agentRowSubtitle } from "./agent-display";

function agentHaystack(agent: Agent, executionLabel: string): string {
  return [
    agent.name,
    agent.description,
    executionLabel,
    agent.providerId,
    agent.model ?? "",
    ...agent.skills,
    ...agent.mcpServers,
  ]
    .join(" ")
    .toLowerCase();
}

export function AgentsList() {
  const navigate = useNavigate();
  const agentsQuery = useAgents();
  const providersQuery = useSystemProviders();
  const [query, setQuery] = useState("");
  const agents = agentsQuery.data ?? null;
  const providers = providersQuery.data;
  const defaultAgentId = agents?.[0]?.id ?? null;

  const filtered = useMemo(() => {
    if (!agents) return null;
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? agents
      : agents.filter((agent) =>
          agentHaystack(agent, agentExecutionLabel(agent, providers)).includes(
            needle,
          ),
        );
  }, [agents, providers, query]);

  return (
    <ResourceCollectionViewport
      scrollId="agents-results"
      bandClassName={TOOLS_PAGE_BAND_CLASSES}
      toolbar={
        <ResourceToolbar
          searchValue={query}
          searchPlaceholder="Search agents"
          onSearchChange={setQuery}
        />
      }
    >
      <div className={TOOLS_PAGE_BAND_CLASSES}>
        {agentsQuery.isError ? (
          <ResourceListState
            state="error"
            message="Couldn't load agents."
            onRetry={() => void agentsQuery.refetch()}
          />
        ) : agents === null || filtered === null ? (
          <div
            className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5"
            role="status"
            aria-label="Loading agents"
          >
            <div className="divide-y divide-border">
              {[0, 1, 2].map((row) => (
                <div
                  key={row}
                  className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  aria-hidden="true"
                >
                  <Skeleton className="size-6 rounded-md" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {agents.length === 0
              ? "No agents yet. Use New agent to create one in chat."
              : "No agents match this search."}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5">
            <ul className="divide-y divide-border">
              {filtered.map((agent) => (
                <li
                  key={agent.id}
                  className="group grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)] items-center gap-3 py-2.5 text-left first:pt-0 last:pb-0"
                  onClick={() => navigate(getAgentDetailRoutePath(agent.id))}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    <Icon
                      name="UserSmile"
                      className="size-4 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="min-w-0">
                    <span className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        onClick={(event) => {
                          event.stopPropagation();
                          navigate(getAgentDetailRoutePath(agent.id));
                        }}
                      >
                        {agent.name}
                      </button>
                      {agent.id === defaultAgentId ? (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          Default
                        </span>
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {agentRowSubtitle(agent, providers)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </ResourceCollectionViewport>
  );
}
