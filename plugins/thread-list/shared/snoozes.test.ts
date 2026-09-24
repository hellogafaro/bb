import { describe, expect, it } from "vitest";
import { parseSnoozeUntil, snoozePresets } from "./snoozes.js";
import { formatWakeLabel } from "../app/rows/ThreadRowMeta.js";

describe("snooze times", () => {
  const wednesday = new Date(2026, 8, 16, 17, 0);

  it("offers tomorrow morning and next Monday morning", () => {
    const presets = snoozePresets(wednesday);
    const tomorrow = new Date(presets[2]!.until);
    const nextWeek = new Date(presets[3]!.until);
    expect([tomorrow.getDate(), tomorrow.getHours()]).toEqual([17, 9]);
    expect([
      nextWeek.getDay(),
      nextWeek.getDate(),
      nextWeek.getHours(),
    ]).toEqual([1, 21, 9]);
  });

  it("reads presets, durations, dates, and epoch milliseconds", () => {
    const now = wednesday.getTime();
    expect(parseSnoozeUntil("3h", wednesday)).toBe(now + 3 * 3_600_000);
    expect(parseSnoozeUntil("45m", wednesday)).toBe(now + 45 * 60_000);
    expect(parseSnoozeUntil("2d", wednesday)).toBe(now + 2 * 86_400_000);
    expect(parseSnoozeUntil("tomorrow", wednesday)).toBe(
      snoozePresets(wednesday)[2]!.until,
    );
    expect(parseSnoozeUntil("2026-10-01T09:00:00Z", wednesday)).toBe(
      Date.parse("2026-10-01T09:00:00Z"),
    );
    expect(parseSnoozeUntil("1790000000000", wednesday)).toBe(
      1_790_000_000_000,
    );
    expect(parseSnoozeUntil("whenever", wednesday)).toBeNull();
  });

  it("rounds wake labels up so a sleeping thread never reads 0m", () => {
    expect(formatWakeLabel(1_000 + 30_000, 1_000)).toBe("1m");
    expect(formatWakeLabel(1_000 + 3_600_000 - 5_000, 1_000)).toBe("1h");
    expect(formatWakeLabel(1_000 + 2 * 3_600_000, 1_000)).toBe("2h");
    expect(formatWakeLabel(1_000 + 86_400_000 - 5_000, 1_000)).toBe("1d");
  });
});
