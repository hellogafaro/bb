// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CorePendingInteraction,
  CorePendingInteractionPayload,
} from "@bb/domain";
import { classifyInteractionRequest } from "./interaction-request";
import { ThreadPendingInteractionBanner } from "./ThreadPendingInteractionBanner";

const mocks = vi.hoisted(() => ({
  resolveMutateAsync: vi.fn(async () => ({})),
}));

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: () => ({
    mutateAsync: mocks.resolveMutateAsync,
    isPending: false,
    error: null,
  }),
  useCancelThreadPendingInteraction: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

function coreInteraction(
  payload: CorePendingInteractionPayload,
): CorePendingInteraction {
  return {
    id: "pint_mcp",
    threadId: "thr_1",
    turnId: "turn_1",
    origin: { kind: "core" },
    status: "pending",
    statusReason: null,
    createdAt: 1,
    expiresAt: null,
    resolvedAt: null,
    resolution: null,
    payload,
  };
}

const approval = coreInteraction({
  kind: "mcp_approval",
  title: "Allow github / delete_repo?",
  server: "github",
  tool: "delete_repo",
  risk: "destructive",
  args: '{\n  "repo": "get-bb/bb"',
  truncated: true,
});

const elicitation = coreInteraction({
  kind: "mcp_elicitation",
  title: "GitHub needs details",
  server: "github",
  message: "Which repository should I use?",
  fields: [
    {
      name: "repo",
      title: "Repository",
      description: "owner/name",
      type: "string",
      options: null,
      required: true,
      defaultValue: null,
    },
    {
      name: "limit",
      title: "Limit",
      description: null,
      type: "integer",
      options: null,
      required: false,
      defaultValue: 10,
    },
    {
      name: "visibility",
      title: "Visibility",
      description: null,
      type: "string",
      options: [
        { value: "public", label: "Public" },
        { value: "private", label: "Private" },
      ],
      required: false,
      defaultValue: null,
    },
    {
      name: "archived",
      title: "Include archived",
      description: null,
      type: "boolean",
      options: null,
      required: false,
      defaultValue: null,
    },
  ],
});

function renderBanner(interaction: CorePendingInteraction) {
  render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <ThreadPendingInteractionBanner
          interaction={interaction}
          threadId="thr_1"
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  mocks.resolveMutateAsync.mockClear();
});

describe("MCP pending interactions", () => {
  it("classifies core MCP payloads as requests", () => {
    expect(classifyInteractionRequest(approval)).toEqual({
      family: "request",
      kind: "mcp_approval",
      payload: approval.payload,
    });
    expect(classifyInteractionRequest(elicitation)).toEqual({
      family: "request",
      kind: "mcp_elicitation",
      payload: elicitation.payload,
    });
  });

  it("renders an approval with its access group, truncated args, and decisions", () => {
    renderBanner(approval);
    expect(screen.getByTestId("mcp-approval-banner")).toBeTruthy();
    expect(screen.getByText("Allow github / delete_repo?")).toBeTruthy();
    expect(screen.queryByText("github / delete_repo")).toBeNull();
    expect(screen.queryByText("destructive")).toBeNull();
    expect(screen.getByText("write")).toBeTruthy();
    expect(screen.getByText(/"repo": "get-bb\/bb"/)).toBeTruthy();
    expect(screen.getByText("Arguments truncated for display.")).toBeTruthy();
  });

  it.each([
    ["Allow", true],
    ["Deny", false],
  ])("resolves %s with allowed=%s", (label, allowed) => {
    renderBanner(approval);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(mocks.resolveMutateAsync).toHaveBeenCalledWith({
      threadId: "thr_1",
      interactionId: "pint_mcp",
      resolution: { kind: "mcp_approval", allowed },
    });
  });

  it("validates required and integer fields before accepting", () => {
    renderBanner(elicitation);
    expect(screen.getByText("Which repository should I use?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(mocks.resolveMutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("Required")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Repository *"), {
      target: { value: "get-bb/bb" },
    });
    fireEvent.change(screen.getByLabelText("Limit"), {
      target: { value: "2.5" },
    });
    expect(screen.getByText("Enter a whole number")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Submit" }).hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.change(screen.getByLabelText("Limit"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("Visibility"), {
      target: { value: "private" },
    });
    fireEvent.click(screen.getByLabelText("Include archived"));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(mocks.resolveMutateAsync).toHaveBeenCalledWith({
      threadId: "thr_1",
      interactionId: "pint_mcp",
      resolution: {
        kind: "mcp_elicitation",
        action: "accept",
        content: {
          repo: "get-bb/bb",
          limit: 5,
          visibility: "private",
          archived: true,
        },
      },
    });
  });

  it("declines without content", () => {
    renderBanner(elicitation);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    expect(mocks.resolveMutateAsync).toHaveBeenCalledWith({
      threadId: "thr_1",
      interactionId: "pint_mcp",
      resolution: { kind: "mcp_elicitation", action: "decline" },
    });
  });
});
