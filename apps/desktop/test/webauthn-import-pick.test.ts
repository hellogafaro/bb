import { describe, expect, it } from "vitest";
import type { DesktopBrowserImportSource } from "@bb/host-daemon-contract";
import { pickWebauthnImportSource } from "../src/webauthn-import-pick.js";

function source(
  overrides: Partial<DesktopBrowserImportSource> &
    Pick<DesktopBrowserImportSource, "id">,
): DesktopBrowserImportSource {
  return {
    name: overrides.id,
    profiles: [],
    ...overrides,
  };
}

describe("pickWebauthnImportSource", () => {
  it("returns not-ok with reason null when there are no sources", () => {
    expect(pickWebauthnImportSource([])).toEqual({ ok: false, reason: null });
  });

  it("prefers a ready chrome source over other ready sources", () => {
    const chrome = source({
      id: "chrome",
      profiles: [{ directory: "Default", name: "Default" }],
    });
    const brave = source({
      id: "brave",
      profiles: [{ directory: "Default", name: "Default" }],
    });
    const result = pickWebauthnImportSource([brave, chrome]);
    expect(result).toMatchObject({ ok: true, source: { id: "chrome" } });
  });

  it("falls back to the first ready source when chrome is unavailable", () => {
    const chrome = source({ id: "chrome", unavailable: "notInstalled" });
    const brave = source({
      id: "brave",
      profiles: [{ directory: "Default", name: "Default" }],
    });
    const result = pickWebauthnImportSource([chrome, brave]);
    expect(result).toMatchObject({ ok: true, source: { id: "brave" } });
  });

  it("picks the profile with the most cookies", () => {
    const chrome = source({
      id: "chrome",
      profiles: [
        { directory: "Profile 1", name: "Work", cookieCount: 3 },
        { directory: "Default", name: "Default", cookieCount: 40 },
      ],
    });
    const result = pickWebauthnImportSource([chrome]);
    expect(result).toMatchObject({
      ok: true,
      profile: { directory: "Default" },
    });
  });

  it("treats a ready source with no profiles as not pickable", () => {
    const chrome = source({ id: "chrome", profiles: [] });
    const result = pickWebauthnImportSource([chrome]);
    expect(result).toEqual({ ok: false, reason: null });
  });

  it("surfaces chrome's unavailable reason when nothing is ready", () => {
    const chrome = source({ id: "chrome", unavailable: "browserRunning" });
    const brave = source({ id: "brave", unavailable: "notInstalled" });
    const result = pickWebauthnImportSource([brave, chrome]);
    expect(result).toEqual({ ok: false, reason: "browserRunning" });
  });

  it("falls back to the first source's reason when chrome is absent", () => {
    const brave = source({ id: "brave", unavailable: "needsFullDiskAccess" });
    const result = pickWebauthnImportSource([brave]);
    expect(result).toEqual({ ok: false, reason: "needsFullDiskAccess" });
  });
});
