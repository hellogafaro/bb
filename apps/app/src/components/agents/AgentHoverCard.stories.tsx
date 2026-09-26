import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID, type Agent } from "@bb/domain";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { DetailCard } from "@/components/ui/detail-card.js";
import {
  agentsQueryKey,
  sidebarNavigationQueryKey,
  systemProvidersQueryKey,
} from "@/hooks/queries/query-keys";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import {
  AgentHoverCardContent,
  AgentHoverCardFrame,
  type AgentHoverCardThread,
} from "./AgentHoverCard";
import { ThreadAgentRow } from "./ThreadAgentRow";

export default {
  title: "agents/Hover card",
};

const bb: Agent = {
  id: "agent_default01",
  name: "bb",
  description: "",
  providerId: "codex",
  model: null,
  reasoningLevel: "medium",
  skills: [],
  mcpServers: [],
  instructions: "",
  mascot: "robot",
  color: 1,
  createdAt: 1,
  updatedAt: 1,
};

const coder: Agent = {
  ...bb,
  id: "agent_coder0001",
  name: "Frontend implementation specialist",
  providerId: "claude-code",
  model: "claude-opus-5-5",
  reasoningLevel: "high",
  skills: ["research", "git-operations", "verify-bb"],
  mcpServers: ["notion"],
  mascot: "frog",
  color: 4,
};

const providers = [
  makeProviderInfo({ id: "codex", displayName: "Codex" }),
  makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
];

const workingThread: AgentHoverCardThread = {
  title: "Agent hover cards for the sidebar and composer",
  projectName: "BB",
  projectColor: 3,
  environmentLabel: "hover-cards · feature/agent-hover-cards",
  statusLabel: "Thread working",
  lastActivityAt: Date.now() - 4 * 60_000,
};

const idlePersonalThread: AgentHoverCardThread = {
  title: "Weekly review",
  projectName: "Personal",
  projectColor: null,
  environmentLabel: null,
  statusLabel: "Idle",
  lastActivityAt: Date.now() - 26 * 60 * 60_000,
};

export function Content() {
  return (
    <StoryCard>
      <StoryRow label="agent only">
        <AgentHoverCardFrame>
          <AgentHoverCardContent agent={bb} providers={providers} />
        </AgentHoverCardFrame>
      </StoryRow>
      <StoryRow label="active agent, long name">
        <AgentHoverCardFrame>
          <AgentHoverCardContent agent={coder} providers={providers} active />
        </AgentHoverCardFrame>
      </StoryRow>
      <StoryRow label="with working thread">
        <AgentHoverCardFrame>
          <AgentHoverCardContent
            agent={coder}
            providers={providers}
            thread={workingThread}
            active
          />
        </AgentHoverCardFrame>
      </StoryRow>
      <StoryRow label="with idle personal thread">
        <AgentHoverCardFrame>
          <AgentHoverCardContent
            agent={bb}
            providers={providers}
            thread={idlePersonalThread}
          />
        </AgentHoverCardFrame>
      </StoryRow>
    </StoryCard>
  );
}

function SeededQueries({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    });
    client.setQueryData(agentsQueryKey(), [bb, coder]);
    client.setQueryData(systemProvidersQueryKey(), providers);
    client.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarBootstrapResponse({
        personalProject: makeProjectWithThreadsResponse({
          id: PERSONAL_PROJECT_ID,
          kind: "personal",
          name: "Personal",
          threads: [
            makeThreadListEntry({
              id: "thr_waiting",
              projectId: PERSONAL_PROJECT_ID,
              agentId: coder.id,
              hasPendingInteraction: true,
            }),
            makeThreadListEntry({
              id: "thr_working",
              projectId: PERSONAL_PROJECT_ID,
              agentId: coder.id,
              runtime: { displayStatus: "active" },
            }),
          ],
        }),
      }),
    );
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

function NarrowPanel({ children }: { children: ReactNode }) {
  return (
    <div className="w-[260px] rounded-md border border-border bg-background px-3 py-2">
      <DetailCard appearance="flat">{children}</DetailCard>
    </div>
  );
}

export function ContextTabRow() {
  return (
    <SeededQueries>
      <StoryCard>
        <StoryRow label="thread not in sidebar cache">
          <NarrowPanel>
            <ThreadAgentRow thread={{ id: "thr_unknown", agentId: bb.id }} />
          </NarrowPanel>
        </StoryRow>
        <StoryRow label="waiting for input, long agent name">
          <NarrowPanel>
            <ThreadAgentRow thread={{ id: "thr_waiting", agentId: coder.id }} />
          </NarrowPanel>
        </StoryRow>
        <StoryRow label="working">
          <NarrowPanel>
            <ThreadAgentRow thread={{ id: "thr_working", agentId: coder.id }} />
          </NarrowPanel>
        </StoryRow>
      </StoryCard>
    </SeededQueries>
  );
}
