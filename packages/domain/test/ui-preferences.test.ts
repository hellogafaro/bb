import { describe, expect, it } from "vitest";
import {
  getUiPreferenceDefault,
  parseUiPreferenceValue,
  threadSchema,
} from "../src/index.js";

describe("sidebar.collapsedStatusSections", () => {
  it("defaults to every status section expanded", () => {
    expect(getUiPreferenceDefault("sidebar.collapsedStatusSections")).toEqual(
      [],
    );
  });

  it("accepts known status sections and drops duplicates", () => {
    expect(
      parseUiPreferenceValue("sidebar.collapsedStatusSections", [
        "done",
        "snoozed",
        "done",
      ]),
    ).toEqual({ success: true, value: ["done", "snoozed"] });
  });

  it("rejects sections the sidebar does not have", () => {
    expect(
      parseUiPreferenceValue("sidebar.collapsedStatusSections", ["pinned"])
        .success,
    ).toBe(false);
    expect(
      parseUiPreferenceValue("sidebar.collapsedStatusSections", "done").success,
    ).toBe(false);
  });
});

describe("thread snoozedUntil", () => {
  it("is required and nullable on the thread DTO", () => {
    const shape = threadSchema.shape.snoozedUntil;
    expect(shape.safeParse(null).success).toBe(true);
    expect(shape.safeParse(1_000).success).toBe(true);
    expect(shape.safeParse(undefined).success).toBe(false);
  });
});
