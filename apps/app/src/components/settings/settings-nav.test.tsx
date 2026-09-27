// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { InstalledPlugin } from "@bb/server-contract";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
import { useSettingsNavState } from "./settings-nav";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";

function wrapperFor(path: string, plugins: readonly InstalledPlugin[] = []) {
  const { queryClient, wrapper: QueryWrapper } = createQueryClientTestHarness();
  queryClient.setQueryData(pluginListQueryKey(true), plugins);
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryWrapper>
        <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>
      </QueryWrapper>
    );
  };
}

function disabledPlugin(): InstalledPlugin {
  return makeInstalledPlugin({
    id: "linear",
    source: "path:/plugins/linear",
    rootDir: "/plugins/linear",
    enabled: false,
    status: "disabled",
    description: "Linear integration",
    name: "Linear",
    sourceDisplay: "path · /plugins/linear",
  });
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
});

describe("useSettingsNavState", () => {
  it("resolves the Providers bucket from its section route", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/providers"),
    });

    expect(result.current.activeSection).toBe("providers");
    expect(result.current.hasUnknownSection).toBe(false);
  });

  it("treats removed section routes as unknown", () => {
    for (const section of ["browser", "marketplaces", "community", "files"]) {
      const { result } = renderHook(() => useSettingsNavState(), {
        wrapper: wrapperFor(`/settings/${section}`),
      });
      expect(result.current.hasUnknownSection).toBe(true);
      expect(result.current.sections.map((entry) => entry.id)).not.toContain(
        section,
      );
    }
  });

  it("keeps the Updates section visible", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/updates"),
    });

    expect(result.current.hasUnknownSection).toBe(false);
    expect(result.current.activeSection).toBe("updates");
  });

  it("shows the Machines section", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/machines"),
    });

    expect(result.current.sections.map((section) => section.id)).toContain(
      "machines",
    );
  });

  it.each([
    ["/settings/skills", "skills"],
    ["/settings/skills/skill_abc123", "skills"],
    ["/settings/mcps", "mcps"],
    ["/settings/mcps/github", "mcps"],
    ["/settings/agents", "agents"],
    ["/settings/agents/Code%20Reviewer", "agents"],
  ])("resolves %s to the %s Customize section", (path, section) => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor(path),
    });

    expect(result.current.activeSection).toBe(section);
    expect(result.current.hasUnknownSection).toBe(false);
    expect(result.current.sections.map((entry) => entry.id)).not.toContain(
      section,
    );
    expect(result.current.customizeSections.map((entry) => entry.id)).toEqual([
      "skills",
      "mcps",
      "agents",
    ]);
  });

  it("does not treat archived threads as a settings section", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/archived"),
    });

    expect(result.current.activeSection).toBe("general");
    expect(result.current.hasUnknownSection).toBe(true);
    expect(result.current.sections.map((section) => section.id)).not.toContain(
      "archived",
    );
  });

  it("recognizes installed plugins as a settings section", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/plugins"),
    });

    expect(result.current.hasUnknownSection).toBe(false);
    expect(result.current.sections.map((section) => section.id)).toContain(
      "plugins",
    );
  });

  it("omits disabled plugins from individual settings entries", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings", [disabledPlugin()]),
    });

    expect(result.current.pluginEntries).toEqual([]);
  });
});
