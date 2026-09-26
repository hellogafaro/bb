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
    <MemoryRouter initialEntries={[`/settings/mcps/${server.handle}`]}>
      <harness.wrapper>
        <Routes>
          <Route
            path="/settings/mcps/:ref"
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
  it("renders the header, settings, and tools grouped by read and write", async () => {
    renderDetail();
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
    expect(screen.getByText("github")).toBeTruthy();
    expect(screen.getByText("https://api.githubcopilot.com/mcp/")).toBeTruthy();
    expect(await screen.findByText("delete_repo")).toBeTruthy();
    expect(screen.getByText("destructive")).toBeTruthy();
    expect(screen.getByText("Read tools")).toBeTruthy();
    expect(screen.getByText("Write tools")).toBeTruthy();
    expect(screen.getAllByText("1 of 1 enabled")).toHaveLength(2);
    const writePolicy = screen.getByRole("combobox", {
      name: "Write tools policy",
    }) as HTMLSelectElement;
    expect(writePolicy.value).toBe("inherit");
    expect(
      screen.getByRole("option", { name: "Default (Ask first)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "Default (Run automatically)" }),
    ).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Agent guide" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit in chat" })).toBeNull();
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

  it("disables a tool with its switch and re-enables it on the group policy", async () => {
    const setPolicy = vi
      .spyOn(sdk.mcp, "setPolicy")
      .mockImplementation(async ({ tool, mode }) =>
        makeMcpToolPolicy({
          tool,
          risk: tool === "delete_repo" ? "destructive" : "read",
          mode,
          policy: mode === "inherit" ? "confirm" : mode,
        }),
      );
    renderDetail();
    fireEvent.click(
      await screen.findByRole("switch", { name: "Disable delete_repo" }),
    );
    await waitFor(() =>
      expect(setPolicy).toHaveBeenCalledWith({
        server: "mcp_github",
        tool: "delete_repo",
        mode: "deny",
      }),
    );
    expect(await screen.findByText("0 of 1 enabled")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Enable delete_repo" }));
    await waitFor(() =>
      expect(setPolicy).toHaveBeenLastCalledWith({
        server: "mcp_github",
        tool: "delete_repo",
        mode: "inherit",
      }),
    );
  });

  it("applies a group policy to every enabled tool in the group", async () => {
    const setPolicy = vi
      .spyOn(sdk.mcp, "setPolicy")
      .mockImplementation(async ({ tool, mode }) =>
        makeMcpToolPolicy({
          tool,
          risk: tool === "delete_repo" ? "destructive" : "read",
          mode,
          policy: mode === "inherit" ? "allow" : mode,
        }),
      );
    renderDetail();
    const readPolicy = await screen.findByRole("combobox", {
      name: "Read tools policy",
    });
    fireEvent.change(readPolicy, { target: { value: "confirm" } });
    await waitFor(() =>
      expect(setPolicy).toHaveBeenCalledWith({
        server: "mcp_github",
        tool: "search_issues",
        mode: "confirm",
      }),
    );
    expect(setPolicy).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect((readPolicy as HTMLSelectElement).value).toBe("confirm"),
    );
  });

  it("disables and enables a whole group", async () => {
    const setPolicy = vi
      .spyOn(sdk.mcp, "setPolicy")
      .mockImplementation(async ({ tool, mode }) =>
        makeMcpToolPolicy({
          tool,
          mode,
          policy: mode === "deny" ? "deny" : "allow",
        }),
      );
    renderDetail();
    await screen.findByText("Read tools");
    fireEvent.click(screen.getAllByRole("button", { name: "Disable all" })[0]);
    await waitFor(() =>
      expect(setPolicy).toHaveBeenCalledWith({
        server: "mcp_github",
        tool: "search_issues",
        mode: "deny",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Enable all" }),
    ).toBeTruthy();
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
      expect(screen.getByTestId("pathname").textContent).toBe("/settings/mcps"),
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
