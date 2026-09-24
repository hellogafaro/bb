import { describe, expect, it } from "vitest";
import {
  getCustomizeRoutePath,
  resolveCustomizeBreadcrumbs,
  resolveCustomizeHeaderMeta,
  resolveCustomizeRoute,
  resolvePluginPanelRoutePath,
} from "./customize-navigation";
import { getToolsOwnedCollectionRoutePath } from "./tools-navigation";

describe("Customize routes", () => {
  it("builds tab paths with an encoded MCP sub path", () => {
    expect(getCustomizeRoutePath("skills")).toBe("/customize");
    expect(getCustomizeRoutePath("mcps")).toBe("/customize/mcps");
    expect(getCustomizeRoutePath("mcps", "installed/my server")).toBe(
      "/customize/mcps/installed/my%20server",
    );
  });

  it("resolves the active tab and sub path", () => {
    expect(resolveCustomizeRoute("/customize")).toEqual({
      tab: "skills",
      subPath: "",
    });
    expect(resolveCustomizeRoute("/customize/mcps")).toEqual({
      tab: "mcps",
      subPath: "",
    });
    expect(resolveCustomizeRoute("/customize/mcps/installed/github")).toEqual({
      tab: "mcps",
      subPath: "installed/github",
    });
    expect(resolveCustomizeRoute("/customize/other")).toBeNull();
    expect(resolveCustomizeRoute("/skills")).toBeNull();
  });

  it("sends mcps plugin navigation to the Customize page only", () => {
    expect(
      resolvePluginPanelRoutePath({
        pluginId: "mcps",
        path: "mcps",
        subPath: "installed/github",
      }),
    ).toBe("/customize/mcps/installed/github");
    expect(
      resolvePluginPanelRoutePath({ pluginId: "mcps", path: "mcps" }),
    ).toBe("/customize/mcps");
    expect(
      resolvePluginPanelRoutePath({ pluginId: "garden", path: "docs" }),
    ).toBe("/plugins/garden/docs");
  });

  it("closes skill details back to the Customize page", () => {
    expect(getToolsOwnedCollectionRoutePath("skills")).toBe("/customize");
  });
});

describe("Customize header", () => {
  it("titles both tabs Customize with the tab as breadcrumb", () => {
    expect(resolveCustomizeHeaderMeta("/customize")).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [
        { label: "Customize", to: "/customize" },
        { label: "Skills" },
      ],
    });
    expect(resolveCustomizeHeaderMeta("/customize/mcps")).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [
        { label: "Customize", to: "/customize" },
        { label: "MCPs" },
      ],
    });
  });

  it("adds the published MCP detail label", () => {
    expect(
      resolveCustomizeBreadcrumbs("/customize/mcps/installed/github", "GitHub"),
    ).toEqual([
      { label: "Customize", to: "/customize" },
      { label: "MCPs", to: "/customize/mcps" },
      { label: "GitHub" },
    ]);
    expect(
      resolveCustomizeBreadcrumbs("/customize/mcps/installed/my%20server"),
    ).toEqual([
      { label: "Customize", to: "/customize" },
      { label: "MCPs", to: "/customize/mcps" },
      { label: "my server" },
    ]);
  });

  it("treats single-segment MCP paths as the list", () => {
    expect(resolveCustomizeBreadcrumbs("/customize/mcps/installed")).toEqual([
      { label: "Customize", to: "/customize" },
      { label: "MCPs" },
    ]);
  });

  it("keeps skill detail deep links under Customize › Skills", () => {
    expect(
      resolveCustomizeBreadcrumbs("/skills/library/skill_abc123", "bb-review"),
    ).toEqual([
      { label: "Customize", to: "/customize" },
      { label: "Skills", to: "/customize" },
      { label: "bb-review" },
    ]);
    expect(resolveCustomizeBreadcrumbs("/skills/library/skill_abc123")).toEqual(
      [
        { label: "Customize", to: "/customize" },
        { label: "Skills", to: "/customize" },
        { label: "skill_abc123" },
      ],
    );
  });

  it("leaves other routes alone", () => {
    expect(resolveCustomizeHeaderMeta("/plugins")).toBeNull();
    expect(resolveCustomizeHeaderMeta("/plugins/mcps/mcps")).toBeNull();
  });
});
