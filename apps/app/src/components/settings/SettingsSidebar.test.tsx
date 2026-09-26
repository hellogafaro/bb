// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  CUSTOMIZE_NAV_SECTIONS,
  SETTINGS_NAV_SECTIONS,
} from "./settings-sections";
import { SettingsSidebarContent } from "./SettingsSidebar";

const configurablePlugin = {
  icon: null,
  id: "linear",
  label: "Linear",
};

function renderSidebar(
  activePluginId: string | null = null,
  activeSection: "general" | "mcps" = "general",
) {
  return render(
    <MemoryRouter>
      <SidebarProvider>
        <SettingsSidebarContent
          appRoutePath="/"
          isResizing={false}
          mobileHosted
          navigation={{
            activePluginId,
            activeSection: activePluginId === null ? activeSection : null,
            customizeSections: CUSTOMIZE_NAV_SECTIONS,
            pluginEntries: [configurablePlugin],
            sections: SETTINGS_NAV_SECTIONS,
          }}
          onResizeMouseDown={() => {}}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("SettingsSidebarContent plugin navigation", () => {
  it("offers installed-plugin management and configurable plugin settings", () => {
    renderSidebar();
    expect(
      screen
        .getByRole("link", { name: "Installed plugins" })
        .getAttribute("href"),
    ).toBe("/settings/plugins");
    expect(
      screen.getByRole("link", { name: "Linear" }).getAttribute("href"),
    ).toBe("/settings/plugins/linear");
    expect(
      screen.queryByRole("button", { name: /Other installed plugins/ }),
    ).toBeNull();
  });

  it("lists Skills, MCPs, and Agents under Customize", () => {
    renderSidebar(null, "mcps");
    expect(screen.getByText("Customize")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Skills" }).getAttribute("href"),
    ).toBe("/settings/skills");
    expect(
      screen.getByRole("link", { name: "MCPs" }).getAttribute("href"),
    ).toBe("/settings/mcps");
    expect(
      screen.getByRole("link", { name: "Agents" }).getAttribute("href"),
    ).toBe("/settings/agents");
    expect(
      screen.getByRole("link", { name: "MCPs" }).getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "Skills" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("marks the active plugin settings page", () => {
    renderSidebar("linear");
    expect(
      screen.getByRole("link", { name: "Linear" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
