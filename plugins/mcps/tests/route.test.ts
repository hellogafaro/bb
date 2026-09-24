import { describe, expect, it } from "vitest";
import { crumbsForRoute, detailPath, parseRoute } from "../lib/route.js";

describe("parseRoute", () => {
  it("treats empty and installed as the collection", () => {
    expect(parseRoute("")).toEqual({ tab: "installed", detailId: null });
    expect(parseRoute("installed")).toEqual({ tab: "installed", detailId: null });
    expect(parseRoute("/browse/")).toEqual({ tab: "browse", detailId: null });
  });

  it("reads nested installed ids, including encoded slashes", () => {
    expect(parseRoute("installed/1password")).toEqual({ tab: "installed", detailId: "1password" });
    expect(parseRoute("installed/com.notion%2Fmcp")).toEqual({ tab: "installed", detailId: "com.notion/mcp" });
  });

  it("keeps a bare remainder as a legacy detail id", () => {
    expect(parseRoute("1password")).toEqual({ tab: "installed", detailId: "1password" });
  });
});

describe("crumbsForRoute", () => {
  it("matches Automations collection and detail crumbs", () => {
    expect(crumbsForRoute({ tab: "installed", detailId: null }, null)).toEqual([
      { label: "MCPs", subPath: "" },
      { label: "Installed" },
    ]);
    expect(crumbsForRoute({ tab: "browse", detailId: null }, null)).toEqual([
      { label: "MCPs", subPath: "" },
      { label: "Browse" },
    ]);
    expect(crumbsForRoute({ tab: "installed", detailId: "abc" }, "1password")).toEqual([
      { label: "MCPs", subPath: "" },
      { label: "Installed", subPath: "" },
      { label: "1password" },
    ]);
  });

  it("builds a detail subPath that parseRoute round-trips", () => {
    expect(parseRoute(detailPath("com.notion/mcp")).detailId).toBe("com.notion/mcp");
  });
});
