// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalProviderIconProps } from "@get-bb/plugin-sdk/app";
import type {
  AgentExecutionUpdate,
  AutomationDetailResponse,
} from "./rpc-types.js";

const agents = [
  {
    id: "agent_default01",
    name: "BB",
    description: "",
    providerId: "codex",
    model: null,
    reasoningLevel: "medium",
    skills: [],
    mcpServers: [],
    instructions: "",
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: "agent_coder0001",
    name: "Coder",
    description: "",
    providerId: "claude-code",
    model: "opus",
    reasoningLevel: "high",
    skills: [],
    mcpServers: [],
    instructions: "",
    createdAt: 2,
    updatedAt: 2,
  },
];

const sdk = { agents: { list: vi.fn(async () => agents) } };

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_ProviderIcon: ({ provider }: ExperimentalProviderIconProps) => (
    <span data-provider-icon={provider.id} />
  ),
  useSdk: () => sdk,
}));

import { AutomationDetailView } from "../detail-view.js";

afterEach(cleanup);

const automation: AutomationDetailResponse = {
  id: "auto_test",
  projectId: "proj_test",
  name: "Digest",
  enabled: true,
  trigger: { triggerType: "schedule", cron: "0 9 * * *", timezone: "UTC" },
  execution: {
    mode: "agent",
    prompt: "Summarize the inbox",
    reasoningLevel: "medium",
    environment: { type: "reuse", environmentId: "env_test" },
  },
  origin: "human",
  createdByThreadId: null,
  nextRunAt: Date.now() + 60_000,
  lastRunAt: null,
  runCount: 0,
  lastRunStatus: null,
  lastRunThreadId: null,
  lastError: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function renderDetail(
  detail: AutomationDetailResponse,
  onUpdate: (update: AgentExecutionUpdate) => Promise<void>,
) {
  render(
    <AutomationDetailView
      automation={detail}
      projectLabel="Test project"
      runsState={{
        runs: [],
        nextCursor: null,
        loading: false,
        loadingMore: false,
        error: null,
        loadMore: vi.fn(),
        retry: vi.fn(),
      }}
      actionPending={false}
      editing
      onToggle={vi.fn()}
      onEdit={vi.fn()}
      onCancelEdit={vi.fn()}
      onUpdateAgent={onUpdate}
      onRunNow={vi.fn()}
      onDelete={vi.fn()}
      onOpenThread={vi.fn()}
    />,
  );
}

describe("automation agent picker", () => {
  it("uses the standard editor to complete an automation with a missing prompt", () => {
    if (automation.execution.mode !== "agent") {
      throw new Error("Expected an agent automation fixture");
    }
    const onUpdate = vi.fn(async (_update: AgentExecutionUpdate) => {});
    renderDetail(
      {
        ...automation,
        execution: { ...automation.execution, prompt: "" },
      },
      onUpdate,
    );

    expect(
      (screen.getByRole("button", { name: "Edit prompt" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    const save = screen.getByRole("button", { name: "Save Prompt" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Automation prompt"), {
      target: { value: "Review the failed build" },
    });
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    expect(onUpdate).toHaveBeenCalledWith({
      prompt: "Review the failed build",
    });
  });

  it("shows the default agent for old automations and saves a picked agent", async () => {
    const onUpdate = vi.fn(async (_update: AgentExecutionUpdate) => {});
    renderDetail(automation, onUpdate);

    const trigger = screen.getByRole("button", { name: "Agent" });
    await waitFor(() => expect(trigger.textContent).toBe("BB (default)"));
    expect(screen.queryByText("Permission mode")).toBeNull();
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(await screen.findByText("claude-code · opus")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Coder/ }));
    await waitFor(() => expect(trigger.textContent).toBe("Coder"));
    fireEvent.click(screen.getByText("Save Prompt"));

    expect(onUpdate).toHaveBeenCalledWith({ agentId: "agent_coder0001" });
  });

  it("clears the agent back to the default", async () => {
    if (automation.execution.mode !== "agent") {
      throw new Error("Expected an agent automation fixture");
    }
    const onUpdate = vi.fn(async (_update: AgentExecutionUpdate) => {});
    renderDetail(
      {
        ...automation,
        execution: { ...automation.execution, agentId: "agent_coder0001" },
      },
      onUpdate,
    );
    const trigger = screen.getByRole("button", { name: "Agent" });
    await waitFor(() => expect(trigger.textContent).toBe("Coder"));
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Default agent/ }),
    );
    fireEvent.click(screen.getByText("Save Prompt"));
    expect(onUpdate).toHaveBeenCalledWith({ agentId: null });
  });
});
