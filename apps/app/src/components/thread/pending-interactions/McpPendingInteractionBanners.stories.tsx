import type { CorePendingInteraction } from "@bb/domain";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "thread/Pending Interaction/MCP",
};

function baseInteraction(
  id: string,
): Omit<CorePendingInteraction, "payload" | "resolution"> {
  return {
    id,
    threadId: "thr_demo",
    turnId: "turn_demo",
    origin: { kind: "core" },
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
  };
}

const writeApproval: CorePendingInteraction = {
  ...baseInteraction("pi_mcp_write"),
  resolution: null,
  payload: {
    kind: "mcp_approval",
    title: "Run Notion / create-pages?",
    server: "notion",
    tool: "create-pages",
    risk: "write",
    args: JSON.stringify(
      {
        parent: { database_id: "3b1f…" },
        properties: { Name: "Q4 planning notes" },
      },
      null,
      2,
    ),
    truncated: false,
  },
};

const destructiveApproval: CorePendingInteraction = {
  ...baseInteraction("pi_mcp_destructive"),
  resolution: null,
  payload: {
    kind: "mcp_approval",
    title: "Run Infisical / delete-secret?",
    server: "infisical",
    tool: "delete-secret",
    risk: "destructive",
    args: JSON.stringify(
      { projectId: "prj_9f2", environment: "prod", secretName: "STRIPE_KEY" },
      null,
      2,
    ),
    truncated: false,
  },
};

const elicitation: CorePendingInteraction = {
  ...baseInteraction("pi_mcp_elicitation"),
  resolution: null,
  payload: {
    kind: "mcp_elicitation",
    title: "Notion asks: Which workspace should this search use?",
    server: "notion",
    message: "Which workspace should this search use?",
    fields: [
      {
        name: "workspace",
        title: "Workspace",
        description: null,
        type: "string",
        options: [
          { value: "hello-gafaro", label: "Hello Gafaro" },
          { value: "clients", label: "Clients" },
        ],
        required: true,
        defaultValue: "hello-gafaro",
      },
      {
        name: "includeArchived",
        title: "Include archived pages",
        description: null,
        type: "boolean",
        options: null,
        required: false,
        defaultValue: false,
      },
    ],
  },
};

function Stage({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        className="grid-cols-1 gap-y-2 px-0 md:grid-cols-[210px_minmax(0,1fr)]"
        label="write tool, ask first"
        hint="a tool whose group policy is Ask first pauses the turn until you allow or deny it"
      >
        <Stage>
          <ThreadPendingInteractionBanner
            interaction={writeApproval}
            threadId={writeApproval.threadId}
          />
        </Stage>
      </StoryRow>
      <StoryRow
        className="grid-cols-1 gap-y-2 px-0 md:grid-cols-[210px_minmax(0,1fr)]"
        label="destructive tool"
        hint="destructive tools are write tools; the policy comes from the Write tools group"
      >
        <Stage>
          <ThreadPendingInteractionBanner
            interaction={destructiveApproval}
            threadId={destructiveApproval.threadId}
          />
        </Stage>
      </StoryRow>
      <StoryRow
        className="grid-cols-1 gap-y-2 px-0 md:grid-cols-[210px_minmax(0,1fr)]"
        label="server asks for input"
        hint="an MCP server can ask the user for values before it runs a tool"
      >
        <Stage>
          <ThreadPendingInteractionBanner
            interaction={elicitation}
            threadId={elicitation.threadId}
          />
        </Stage>
      </StoryRow>
    </StoryCard>
  );
}
