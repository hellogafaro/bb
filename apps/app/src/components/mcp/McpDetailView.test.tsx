// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@bb/server-contract";
import { RESOURCE_ROUTE_LABEL_EVENT } from "@bb/shared-ui/resource-route-label";
import { BbHttpError, sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeMcpServer, makeMcpToolPolicy } from "@/test/fixtures/mcp";
import { McpDetailView } from "./McpDetailView";

const urlOpen = vi.hoisted(() => ({ openUrlInExternalBrowser: vi.fn() }));

vi.mock("@/lib/url-open-routing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/url-open-routing")>()),
  openUrlInExternalBrowser: urlOpen.openUrlInExternalBrowser,
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderDetail(server: McpServer = makeMcpServer()) {
  const get = vi.spyOn(sdk.mcp, "get").mockResolvedValue(server);
  vi.spyOn(sdk.mcp, "serverTools").mockResolvedValue({
    tools: [
      {
        id: "github__search_issues",
        sourceId: "github",
        handle: "github",
        name: "search_issues",
        description: "Search issues",
        risk: "read",
      },
      {
        id: "github__delete_repo",
        sourceId: "github",
        handle: "github",
        name: "delete_repo",
        description: "Delete a repository",
        risk: "destructive",
      },
    ],
    error: null,
  });
  vi.spyOn(sdk.mcp, "listPolicies").mockResolvedValue([
    makeMcpToolPolicy(),
    makeMcpToolPolicy({
      tool: "delete_repo",
      risk: "destructive",
      mode: "inherit",
      policy: "confirm",
    }),
  ]);
  const harness = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={[`/customize/mcps/${server.handle}`]}>
      <harness.wrapper>
        <Routes>
          <Route
            path="/customize/mcps/:ref"
            element={<McpDetailView serverRef={server.handle} />}
          />
          <Route path="*" element={null} />
        </Routes>
        <LocationProbe />
      </harness.wrapper>
    </MemoryRouter>,
  );
  return { get, harness };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  urlOpen.openUrlInExternalBrowser.mockReset();
});

describe("McpDetailView", () => {
  it("renders the header, settings, and tools with risk pills", async () => {
    renderDetail();
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByText("github")).toBeTruthy();
    expect(screen.getByText("https://api.githubcopilot.com/mcp/")).toBeTruthy();
    expect(await screen.findByText("delete_repo")).toBeTruthy();
    expect(screen.getByText("destructive")).toBeTruthy();
    const select = await screen.findByRole("combobox", {
      name: "Policy for delete_repo",
    });
    expect((select as HTMLSelectElement).value).toBe("inherit");
    expect(
      screen.getByRole("option", { name: "Default (Ask first)" }),
    ).toBeTruthy();
  });

  it("publishes the server name as the breadcrumb label", async () => {
    const labels: Array<string | null> = [];
    const listener = (event: Event) => {
      if (event instanceof CustomEvent) labels.push(event.detail.label);
    };
    window.addEventListener(RESOURCE_ROUTE_LABEL_EVENT, listener);
    renderDetail();
    await screen.findByRole("heading", { name: "GitHub" });
    await waitFor(() => expect(labels).toContain("GitHub"));
    window.removeEventListener(RESOURCE_ROUTE_LABEL_EVENT, listener);
  });

  it("sets a tool policy through the policy select", async () => {
    const setPolicy = vi.spyOn(sdk.mcp, "setPolicy").mockResolvedValue(
      makeMcpToolPolicy({
        tool: "delete_repo",
        risk: "destructive",
        mode: "deny",
        policy: "deny",
      }),
    );
    renderDetail();
    const select = await screen.findByRole("combobox", {
      name: "Policy for delete_repo",
    });
    fireEvent.change(select, { target: { value: "deny" } });
    await waitFor(() =>
      expect(setPolicy).toHaveBeenCalledWith({
        server: "mcp_github",
        tool: "delete_repo",
        mode: "deny",
      }),
    );
    await waitFor(() =>
      expect(
        (
          screen.getByRole("combobox", {
            name: "Policy for delete_repo",
          }) as HTMLSelectElement
        ).value,
      ).toBe("deny"),
    );
  });

  it("saves the agent guide", async () => {
    const setGuide = vi.spyOn(sdk.mcp, "setGuide").mockResolvedValue({
      id: "mcp_github",
      handle: "github",
      guide: "Search org issues first.",
    });
    renderDetail();
    const save = await screen.findByRole("button", { name: "Save guide" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Agent guide" }), {
      target: { value: "  Search org issues first.  " },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(setGuide).toHaveBeenCalledWith({
        server: "mcp_github",
        guide: "Search org issues first.",
      }),
    );
  });

  it("replaces headers with re-entered values", async () => {
    const setHeaders = vi
      .spyOn(sdk.mcp, "setHeaders")
      .mockImplementation(async () => makeMcpServer());
    renderDetail(
      makeMcpServer({
        config: {
          type: "streamable-http",
          url: "https://api.githubcopilot.com/mcp/",
          headers: { Authorization: "***" },
        },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Edit headers for GitHub" }),
    );
    const save = screen.getByRole("button", { name: "Save headers" });
    expect(save.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Header 1 value"), {
      target: { value: "Bearer abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add header/ }));
    fireEvent.change(screen.getByLabelText("Header 2 name"), {
      target: { value: "X-Org" },
    });
    fireEvent.change(screen.getByLabelText("Header 2 value"), {
      target: { value: "bb" },
    });
    fireEvent.click(save);
    await waitFor(() =>
      expect(setHeaders).toHaveBeenCalledWith({
        server: "mcp_github",
        headers: { Authorization: "Bearer abc", "X-Org": "bb" },
      }),
    );
  });

  it("opens the OAuth URL from Sign in", async () => {
    const reserved = { closed: false, location: { href: "" }, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(reserved as unknown as Window);
    const authenticate = vi.spyOn(sdk.mcp, "authenticate").mockResolvedValue({
      url: "https://github.com/login/oauth/authorize?x=1",
      status: "authorizing",
    });
    renderDetail(makeMcpServer({ authStatus: "unauthenticated" }));
    expect(
      await screen.findByText("Sign in to load this server's tools."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(open).toHaveBeenCalledWith("about:blank", "_blank");
    await waitFor(() =>
      expect(authenticate).toHaveBeenCalledWith({ server: "mcp_github" }),
    );
    await waitFor(() =>
      expect(reserved.location.href).toBe(
        "https://github.com/login/oauth/authorize?x=1",
      ),
    );
    expect(urlOpen.openUrlInExternalBrowser).not.toHaveBeenCalled();
  });

  it("falls back to the external URL opener when no window was reserved", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    vi.spyOn(sdk.mcp, "authenticate").mockResolvedValue({
      url: "https://notion.so/oauth",
      status: "authorizing",
    });
    renderDetail(makeMcpServer({ authStatus: "unauthenticated" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(urlOpen.openUrlInExternalBrowser).toHaveBeenCalledWith(
        "https://notion.so/oauth",
      ),
    );
  });

  it("removes the server after confirming and returns to the list", async () => {
    const remove = vi
      .spyOn(sdk.mcp, "remove")
      .mockResolvedValue({ deleted: true, id: "mcp_github" });
    renderDetail();
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "GitHub actions" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(await screen.findByText("Remove MCP?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ server: "mcp_github" }),
    );
    await waitFor(() =>
      expect(screen.getByTestId("pathname").textContent).toBe(
        "/customize/mcps",
      ),
    );
  });

  it("shows a gone state for a missing server", async () => {
    vi.spyOn(sdk.mcp, "get").mockRejectedValue(
      new BbHttpError({
        status: 404,
        message: "MCP server not found: nope",
        code: "not_found",
        body: null,
      }),
    );
    const harness = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/customize/mcps/nope"]}>
        <harness.wrapper>
          <McpDetailView serverRef="nope" />
        </harness.wrapper>
      </MemoryRouter>,
    );
    expect(await screen.findByText("That MCP is gone.")).toBeTruthy();
  });
});
