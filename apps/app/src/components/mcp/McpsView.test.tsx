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
import { makeMcpServer, makeProviderGuard } from "@/test/fixtures/mcp";
import { McpsView } from "./McpsView";

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="pathname">{location.pathname}</span>;
}

function renderList({
  servers = [makeMcpServer()],
  status = makeProviderGuard(),
}: {
  servers?: ReturnType<typeof makeMcpServer>[];
  status?: ReturnType<typeof makeProviderGuard>;
} = {}) {
  vi.spyOn(sdk.mcp, "list").mockImplementation(async () => servers);
  vi.spyOn(sdk.providers, "guardStatus").mockResolvedValue(status);
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

  it("shows the provider guard on the machine and fixes it", async () => {
    const issueStatus = makeProviderGuard({
      issues: [
        {
          provider: "claude",
          message: "Claude Code bundled skills are enabled",
          fixable: true,
        },
      ],
    });
    const fix = vi
      .spyOn(sdk.providers, "guardFix")
      .mockResolvedValue(makeProviderGuard());
    renderList({ status: issueStatus });
    expect(
      await screen.findByText(
        "Claude Code / Codex still load their own MCPs, skills, or plugins on studio.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Claude Code bundled skills are enabled"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Fix" }));
    await waitFor(() =>
      expect(fix).toHaveBeenCalledWith({ hostId: "host_local" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("status", { name: "Provider guard" }),
      ).toBeNull(),
    );
  });

  it("offers no Fix button when every issue needs a hand edit", async () => {
    renderList({
      status: makeProviderGuard({
        issues: [
          {
            provider: "codex",
            message: "Codex skills outside BB",
            fixable: false,
          },
        ],
      }),
    });
    expect(await screen.findByText("Codex skills outside BB")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Fix" })).toBeNull();
  });

  it("hides the provider guard when there are no issues", async () => {
    renderList();
    await screen.findByText("GitHub");
    expect(
      screen.queryByRole("status", { name: "Provider MCP guard" }),
    ).toBeNull();
  });
});
