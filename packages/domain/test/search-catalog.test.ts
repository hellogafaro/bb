import { describe, expect, it } from "vitest";
import {
  CORE_SETTINGS_CATALOG,
  CORE_SETTINGS_PAGES,
  getCoreSettingById,
} from "../src/search-catalog.js";

describe("core settings search catalog", () => {
  it("keeps IDs and destinations unique, serializable, and plugin-free", () => {
    expect(new Set(CORE_SETTINGS_CATALOG.map((entry) => entry.id)).size).toBe(
      CORE_SETTINGS_CATALOG.length,
    );
    expect(new Set(CORE_SETTINGS_CATALOG.map((entry) => entry.path)).size).toBe(
      CORE_SETTINGS_CATALOG.length,
    );
    for (const entry of CORE_SETTINGS_CATALOG) {
      expect(entry.path).toContain(`?setting=${entry.id}`);
      expect(entry.path).not.toContain("plugin");
      expect(getCoreSettingById(entry.id)).toBe(entry);
      expect(JSON.parse(JSON.stringify(entry))).toEqual(entry);
    }
  });

  it("maps core discovery terms to real controls", () => {
    const terms = [
      "theme",
      "dark mode",
      "light mode",
      "keyboard shortcuts",
      "hotkeys",
      "model",
      "provider",
      "editor",
      "default app",
      "environment variables",
    ];
    for (const term of terms) {
      expect(
        CORE_SETTINGS_CATALOG.some(
          (entry) =>
            entry.label.toLowerCase().includes(term) ||
            entry.aliases.some((alias) => alias.toLowerCase() === term),
        ),
        term,
      ).toBe(true);
    }
  });

  it("provides one direct destination for each core settings page", () => {
    expect(new Set(CORE_SETTINGS_PAGES.map((page) => page.id)).size).toBe(
      CORE_SETTINGS_PAGES.length,
    );
    expect(new Set(CORE_SETTINGS_PAGES.map((page) => page.path)).size).toBe(
      CORE_SETTINGS_PAGES.length,
    );
    expect(
      CORE_SETTINGS_PAGES.find((page) => page.id === "general")?.path,
    ).toBe("/settings");
    for (const page of CORE_SETTINGS_PAGES) {
      expect(page.path).not.toContain("?");
      expect(page.path).not.toContain("plugin");
      expect(JSON.parse(JSON.stringify(page))).toEqual(page);
    }
  });
});
