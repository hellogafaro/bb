// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { SkillsView } from "./ToolsView";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderSkillsView(initialPath: string) {
  vi.spyOn(sdk.providers, "list").mockResolvedValue([]);
  vi.spyOn(sdk.skills, "list").mockResolvedValue({
    skills: [
      {
        id: `skill_${"a".repeat(64)}`,
        name: "bb-review",
        description: "Review the current diff.",
        provider: null,
        scope: "bb-user",
        pluginId: null,
        filePath: "/home/u/.bb/skills/bb-review/SKILL.md",
        manageable: true,
        registrySkillId: null,
      },
    ],
  });
  const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientWrapper>
        <Routes>
          <Route path="/skills" element={<SkillsView />} />
          <Route path="/skills/library/:skillId" element={<SkillsView />} />
        </Routes>
      </QueryClientWrapper>
    </MemoryRouter>,
  );
  return fetchMock;
}

describe("Customize skills page", () => {
  it.each(["/skills", "/skills?view=library"])(
    "shows the Skills tab and the library at %s without the registry",
    async (initialPath) => {
      const fetchMock = renderSkillsView(initialPath);
      expect(await screen.findByText("bb-review")).toBeTruthy();
      expect(
        screen
          .getByRole("tab", { name: "Skills" })
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(screen.getByRole("tab", { name: "MCPs" })).toBeTruthy();
      expect(screen.getByPlaceholderText("Search skills")).toBeTruthy();
      await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    },
  );

  it("leaves the tabs off skill detail pages", async () => {
    renderSkillsView("/skills/library/skill_missing");
    expect(await screen.findByText("Skill not found.")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "MCPs" })).toBeNull();
  });
});
