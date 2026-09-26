import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getAgentDetailRoutePath } from "@bb/client-core";
import type { Agent } from "@bb/domain";
import {
  ResourceCollectionViewport,
  ResourceListState,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import {
  CustomizeCard,
  CustomizeCardGrid,
  CustomizeCardSkeletonGrid,
} from "@/components/customize/CustomizeCards";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { useAgents } from "@/hooks/queries/agent-queries";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { agentExecutionLabel, agentRowSubtitle } from "./agent-display";
import { AgentMascot, agentAvatarStyle } from "./mascots/AgentMascot";

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

export function AgentsList({ action }: { action?: ReactNode }) {
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
          action={action}
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
          <CustomizeCardSkeletonGrid label="Loading agents" />
        ) : filtered.length === 0 ? (
          <ResourceListState
            state="empty"
            message={
              agents.length === 0
                ? "No agents yet. Use New agent to create one in chat."
                : "No agents match this search."
            }
          />
        ) : (
          <CustomizeCardGrid>
            {filtered.map((agent) => (
              <div key={agent.id} data-testid={`agent-card-${agent.id}`}>
                <CustomizeCard
                  leading={
                    <AgentMascot
                      mascot={agent.mascot}
                      color={agent.color}
                      className="size-4"
                    />
                  }
                  leadingStyle={agentAvatarStyle(agent.color)}
                  title={agent.name}
                  headerAction={
                    agent.id === defaultAgentId ? (
                      <ProvenancePill label="Default" />
                    ) : undefined
                  }
                  description={
                    agent.description || agentRowSubtitle(agent, providers)
                  }
                  openLabel={agent.name}
                  onOpen={() => navigate(getAgentDetailRoutePath(agent.id))}
                />
              </div>
            ))}
          </CustomizeCardGrid>
        )}
      </div>
    </ResourceCollectionViewport>
  );
}
