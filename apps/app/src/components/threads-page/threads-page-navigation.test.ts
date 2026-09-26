import { describe, expect, it } from "vitest";
import {
  isThreadsListRoutePath,
  resolveThreadsListHeaderMeta,
  resolveThreadsListRoute,
} from "./threads-page-navigation";

describe("resolveThreadsListRoute", () => {
  it("maps the list and archived paths to tabs", () => {
    expect(resolveThreadsListRoute("/threads")).toEqual({ tab: "all" });
    expect(resolveThreadsListRoute("/archived")).toEqual({ tab: "archived" });
  });

  it("leaves thread detail and other pages alone", () => {
    expect(resolveThreadsListRoute("/threads/thr_1")).toBeNull();
    expect(resolveThreadsListRoute("/projects/p/threads/thr_1")).toBeNull();
    expect(resolveThreadsListRoute("/agents")).toBeNull();
    expect(isThreadsListRoutePath("/settings/archived")).toBe(false);
  });

  it("titles both tabs as Threads", () => {
    expect(resolveThreadsListHeaderMeta("/archived")).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [{ label: "Threads" }],
    });
    expect(resolveThreadsListHeaderMeta("/threads/thr_1")).toBeNull();
  });
});
