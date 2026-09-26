// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstalledPlugin } from "@bb/server-contract";
import { resetPluginSlotStoreForTest } from "@/lib/plugin-slots";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { pluginListQueryKey } from "@/hooks/queries/query-keys";
import { useSettingsNavState } from "./settings-nav";
import { makeInstalledPlugin } from "@/test/fixtures/plugins";

const mocks = vi.hoisted(() => ({
  accessState: "unavailable",
  builtinFileOpener: true,
}));

vi.mock("@/lib/fork-flags", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fork-flags")>();
  return {
    ...actual,
    get FORK_BUILTIN_FILE_OPENER() {
      return mocks.builtinFileOpener;
    },
    get FORK_HIDDEN_SETTINGS_SECTIONS() {
      return mocks.builtinFileOpener
        ? actual.FORK_HIDDEN_SETTINGS_SECTIONS
        : actual.FORK_HIDDEN_SETTINGS_SECTIONS.filter(
            (section) => section !== "files",
          );
    },
  };
});

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ hasDaemon: false }),
  useLocalHostDaemonAccess: () => ({ accessState: mocks.accessState }),
}));

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
  mocks.accessState = "unavailable";
  mocks.builtinFileOpener = true;
});

describe("useSettingsNavState", () => {
  it("resolves the Providers bucket from its section route", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/providers"),
    });

    expect(result.current.activeSection).toBe("providers");
    expect(result.current.hasUnknownSection).toBe(false);
  });

  it("omits the fork-hidden sections and treats their routes as unknown", () => {
    for (const section of [
      "browser",
      "marketplaces",
      "community",
      "updates",
      "files",
    ]) {
      const { result } = renderHook(() => useSettingsNavState(), {
        wrapper: wrapperFor(`/settings/${section}`),
      });
      expect(result.current.hasUnknownSection).toBe(true);
      expect(result.current.sections.map((entry) => entry.id)).not.toContain(
        section,
      );
    }
  });

  it("hides Files under the built-in file opener even when local helper access can be enabled", () => {
    mocks.accessState = "permission-required";
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/files"),
    });

    expect(result.current.hasUnknownSection).toBe(true);
    expect(result.current.activeSection).toBe("general");
    expect(result.current.sections.map((entry) => entry.id)).not.toContain(
      "files",
    );
  });

  it("shows the Machines section", () => {
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/machines"),
    });

    expect(result.current.sections.map((section) => section.id)).toContain(
      "machines",
    );
  });

  it("shows Files when local helper access can be enabled", () => {
    mocks.builtinFileOpener = false;
    mocks.accessState = "permission-required";
    const { result } = renderHook(() => useSettingsNavState(), {
      wrapper: wrapperFor("/settings/files"),
    });

    expect(result.current.sections).toContainEqual(
      expect.objectContaining({ icon: "File", id: "files" }),
    );
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
