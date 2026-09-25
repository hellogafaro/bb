import { describe, expect, it } from "vitest";
import {
  getCustomizeRoutePath,
  getMcpDetailRoutePath,
  resolveCustomizeBreadcrumbs,
  resolveCustomizeHeaderMeta,
  resolveCustomizeRoute,
} from "./customize-navigation";
import { getToolsOwnedCollectionRoutePath } from "./tools-navigation";

describe("Customize routes", () => {
  it("builds tab and encoded MCP detail paths", () => {
    expect(getCustomizeRoutePath("skills")).toBe("/customize");
    expect(getCustomizeRoutePath("mcps")).toBe("/customize/mcps");
    expect(getMcpDetailRoutePath("mcp_abc")).toBe("/customize/mcps/mcp_abc");
    expect(getMcpDetailRoutePath("my server/x")).toBe(
      "/customize/mcps/my%20server%2Fx",
    );
  });

  it("resolves the active tab and MCP ref", () => {
    expect(resolveCustomizeRoute("/customize")).toEqual({ tab: "skills" });
    expect(resolveCustomizeRoute("/customize/mcps")).toEqual({
      tab: "mcps",
      mcpRef: null,
    });
    expect(resolveCustomizeRoute("/customize/mcps/github")).toEqual({
      tab: "mcps",
      mcpRef: "github",
    });
    expect(resolveCustomizeRoute("/customize/mcps/my%20server%2Fx")).toEqual({
      tab: "mcps",
      mcpRef: "my server/x",
    });
    expect(
      resolveCustomizeRoute("/customize/mcps/installed/github"),
    ).toBeNull();
    expect(resolveCustomizeRoute("/customize/other")).toBeNull();
    expect(resolveCustomizeRoute("/skills")).toBeNull();
  });

  it("closes skill details back to the Customize page", () => {
    expect(getToolsOwnedCollectionRoutePath("skills")).toBe("/customize");
  });
});

describe("Customize header", () => {
  it("titles both collection tabs with a single Customize crumb", () => {
    expect(resolveCustomizeHeaderMeta("/customize")).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [{ label: "Customize" }],
    });
    expect(resolveCustomizeHeaderMeta("/customize/mcps")).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [{ label: "Customize" }],
    });
  });

  it("links MCP details back to the MCPs tab", () => {
    expect(
      resolveCustomizeBreadcrumbs("/customize/mcps/mcp_abc", "GitHub"),
    ).toEqual([
      { label: "Customize", to: "/customize/mcps" },
      { label: "GitHub" },
    ]);
    expect(resolveCustomizeBreadcrumbs("/customize/mcps/my%20server")).toEqual([
      { label: "Customize", to: "/customize/mcps" },
      { label: "my server" },
    ]);
  });

  it("links skill detail deep links back to the Skills tab", () => {
    expect(
      resolveCustomizeBreadcrumbs("/skills/library/skill_abc123", "bb-review"),
    ).toEqual([
      { label: "Customize", to: "/customize" },
      { label: "bb-review" },
    ]);
    expect(resolveCustomizeBreadcrumbs("/skills/library/skill_abc123")).toEqual(
      [{ label: "Customize", to: "/customize" }, { label: "skill_abc123" }],
    );
  });

  it("leaves other routes alone", () => {
    expect(resolveCustomizeHeaderMeta("/plugins")).toBeNull();
    expect(resolveCustomizeHeaderMeta("/plugins/mcp/mcp")).toBeNull();
  });
});
