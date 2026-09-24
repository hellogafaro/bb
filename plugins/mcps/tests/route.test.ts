import { describe, expect, it } from "vitest";
import { crumbsForRoute, detailPath, parseRoute } from "../lib/route.js";

describe("parseRoute", () => {
  it("treats anything outside installed/<id> as the collection", () => {
    expect(parseRoute("")).toEqual({ detailId: null });
    expect(parseRoute("installed")).toEqual({ detailId: null });
    expect(parseRoute("1password")).toEqual({ detailId: null });
  });

  it("reads nested installed ids, including encoded slashes", () => {
    expect(parseRoute("installed/1password")).toEqual({ detailId: "1password" });
    expect(parseRoute("installed/com.notion%2Fmcp")).toEqual({ detailId: "com.notion/mcp" });
  });
});

describe("crumbsForRoute", () => {
  it("builds collection and detail crumbs", () => {
    expect(crumbsForRoute({ detailId: null }, null)).toEqual([{ label: "MCPs" }]);
    expect(crumbsForRoute({ detailId: "abc" }, "1password")).toEqual([
      { label: "MCPs", subPath: "" },
      { label: "1password" },
    ]);
  });

  it("builds a detail subPath that parseRoute round-trips", () => {
    expect(parseRoute(detailPath("com.notion/mcp")).detailId).toBe("com.notion/mcp");
  });
});
