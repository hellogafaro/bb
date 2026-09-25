// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  localActionResults,
  matchClass,
  readSearchRecents,
  recordSearchRecent,
  sortSearchGroups,
} from "./global-search";

afterEach(() => localStorage.clear());

describe("global search ranking and recency", () => {
  it("ranks exact names before metadata and requires all query tokens", () => {
    expect(matchClass("Theme", "Appearance controls", "theme")).toBe(1);
    expect(matchClass("Appearance", "Theme and text size", "theme size")).toBe(
      5,
    );
    expect(matchClass("Appearance", "Theme controls", "theme size")).toBeNull();
    expect(
      matchClass("Text size", "Appearance", "font size", ["font size"]),
    ).toBe(2);
    expect(matchClass("Appearance", "", "apearance")).toBe(4);
    expect(matchClass("Résumé", "", "resume")).toBe(1);
    expect(
      sortSearchGroups([
        {
          kind: "threads",
          results: [
            {
              id: "t",
              kind: "local-action",
              label: "t",
              matchClass: 6,
              action: {
                id: "t",
                bucket: "Actions",
                group: "",
                title: "",
                shortcut: null,
                run() {},
              },
            },
          ],
        },
        {
          kind: "settings",
          results: [
            {
              id: "s",
              kind: "local-action",
              label: "s",
              matchClass: 1,
              action: {
                id: "s",
                bucket: "Actions",
                group: "",
                title: "",
                shortcut: null,
                run() {},
              },
            },
          ],
        },
      ]),
    ).toEqual(["settings", "threads"]);
  });

  it("keeps recents isolated by server and excludes palette commands", () => {
    recordSearchRecent("https://one.example", "destinations", "project:p1");
    expect(readSearchRecents("https://one.example", "destinations")).toEqual([
      "project:p1",
    ]);
    expect(readSearchRecents("https://two.example", "destinations")).toEqual(
      [],
    );
    const action = {
      id: "app:palette.open",
      bucket: "Actions" as const,
      group: "App",
      title: "Open search",
      shortcut: null,
      run() {},
    };
    expect(localActionResults([action], "search")).toEqual([]);
  });

  it("migrates prior action recents into the current server namespace", () => {
    localStorage.setItem(
      "bb.palette.recents",
      JSON.stringify(["app:thread.new", "app:settings.open"]),
    );
    expect(readSearchRecents("https://one.example", "actions")).toEqual([
      "app:thread.new",
      "app:settings.open",
    ]);
    expect(localStorage.getItem("bb.palette.recents")).toBeNull();
    expect(readSearchRecents("https://two.example", "actions")).toEqual([]);
  });
});
