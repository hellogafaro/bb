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
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeMcpProviderStatus, makeMcpServer } from "@/test/fixtures/mcp";
import { McpsView } from "./McpsView";

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderList({
  servers = [makeMcpServer()],
  status = makeMcpProviderStatus(),
}: {
  servers?: ReturnType<typeof makeMcpServer>[];
  status?: ReturnType<typeof makeMcpProviderStatus>;
} = {}) {
  vi.spyOn(sdk.mcp, "list").mockImplementation(async () => servers);
  vi.spyOn(sdk.mcp, "providerStatus").mockResolvedValue(status);
  const harness = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={["/customize/mcps"]}>
      <harness.wrapper>
        <Routes>
          <Route path="/customize/mcps" element={<McpsView />} />
          <Route path="*" element={null} />
        </Routes>
        <LocationProbe />
      </harness.wrapper>
    </MemoryRouter>,
  );
  return harness;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("McpsView", () => {
  it("lists servers with type, status, and tool count", async () => {
    renderList({
      servers: [
        makeMcpServer(),
        makeMcpServer({
          id: "mcp_fs",
          handle: "fs",
          name: "Files",
          type: "stdio",
          enabled: false,
          authStatus: "not-applicable",
          toolCount: null,
          config: {
            type: "stdio",
            command: "npx",
            args: [],
            env: {},
            cwd: null,
          },
        }),
      ],
    });
    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(screen.getByText("HTTP · authenticated · 2 tools")).toBeTruthy();
    expect(screen.getByText("Command · disabled")).toBeTruthy();
    expect(
      screen
        .getByRole("switch", { name: "Enable Files" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("filters by search text", async () => {
    renderList({
      servers: [
        makeMcpServer(),
        makeMcpServer({ id: "mcp_notion", handle: "notion", name: "Notion" }),
      ],
    });
    await screen.findByText("Notion");
    fireEvent.change(screen.getByRole("textbox", { name: "Search MCPs" }), {
      target: { value: "notion" },
    });
    expect(screen.queryByText("GitHub")).toBeNull();
    expect(screen.getByText("Notion")).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search MCPs" }), {
      target: { value: "nothing" },
    });
    expect(screen.getByText("No MCPs match this search.")).toBeTruthy();
  });

  it("toggles a server without opening it", async () => {
    const setEnabled = vi
      .spyOn(sdk.mcp, "setEnabled")
      .mockResolvedValue({ enabled: false, status: "disabled" });
    renderList();
    fireEvent.click(
      await screen.findByRole("switch", { name: "Disable GitHub" }),
    );
    await waitFor(() =>
      expect(setEnabled).toHaveBeenCalledWith({
        server: "mcp_github",
        enabled: false,
      }),
    );
    expect(screen.getByTestId("pathname").textContent).toBe("/customize/mcps");
  });

  it("renders only a search box without filter, sort, or create controls", async () => {
    renderList();
    await screen.findByText("GitHub");
    expect(screen.getByRole("textbox", { name: "Search MCPs" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /filter|sort/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /New MCP/ })).toBeNull();
  });

  it("shows the provider guard and disables claude.ai connectors", async () => {
    const issueStatus = makeMcpProviderStatus({
      issues: [
        { provider: "claude", message: "claude.ai connectors are enabled" },
      ],
      status: {
        claude: {
          settingsPath: "/home/u/.claude/settings.json",
          connectorsDisabled: false,
          mcpServers: [],
        },
        codex: { configPath: "/home/u/.codex/config.toml", mcpServers: [] },
      },
    });
    const fix = vi
      .spyOn(sdk.mcp, "fixProviders")
      .mockResolvedValue(makeMcpProviderStatus());
    renderList({ status: issueStatus });
    expect(
      await screen.findByText("claude.ai connectors are enabled"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Disable claude.ai connectors" }),
    );
    await waitFor(() =>
      expect(fix).toHaveBeenCalledWith({ hostId: "host_local" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Provider MCP guard" }),
      ).toBeNull(),
    );
  });

  it("hides the provider guard when there are no issues", async () => {
    renderList();
    await screen.findByText("GitHub");
    expect(
      screen.queryByRole("status", { name: "Provider MCP guard" }),
    ).toBeNull();
  });
});
