import { z } from "zod";

export const SNOOZES_CHANGED_CHANNEL = "snoozes";

export const snoozeThreadIdSchema = z.string().regex(/^thr_[A-Za-z0-9_-]+$/);

export const snoozeSchema = z
  .object({
    threadId: snoozeThreadIdSchema,
    until: z.number().int().positive(),
    at: z.number().int().positive(),
  })
  .strict();
export type Snooze = z.infer<typeof snoozeSchema>;

export const snoozeListSchema = z.array(snoozeSchema);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function morningIn(days: number, from: Date): number {
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  next.setHours(9, 0, 0, 0);
  return next.getTime();
}

export interface SnoozePreset {
  id: "1h" | "3h" | "tomorrow" | "week";
  label: string;
  until: number;
  showDay: boolean;
}

export function snoozePresets(from: Date): SnoozePreset[] {
  const now = from.getTime();
  const daysToMonday = (8 - from.getDay()) % 7 || 7;
  return [
    { id: "1h", label: "In 1 hour", until: now + HOUR, showDay: false },
    { id: "3h", label: "In 3 hours", until: now + 3 * HOUR, showDay: false },
    {
      id: "tomorrow",
      label: "Tomorrow",
      until: morningIn(1, from),
      showDay: false,
    },
    {
      id: "week",
      label: "Next week",
      until: morningIn(daysToMonday, from),
      showDay: true,
    },
  ];
}

const DURATION_PATTERN = /^(\d+)\s*(m|h|d|w)$/i;
const DURATION_UNIT_MS = { m: MINUTE, h: HOUR, d: DAY, w: 7 * DAY } as const;

export function parseSnoozeUntil(raw: string, from: Date): number | null {
  const value = raw.trim();
  const preset = snoozePresets(from).find(
    (candidate) => candidate.id === value.toLowerCase(),
  );
  if (preset) return preset.until;
  const duration = DURATION_PATTERN.exec(value);
  if (duration) {
    const unit = duration[2]!.toLowerCase() as keyof typeof DURATION_UNIT_MS;
    return from.getTime() + Number(duration[1]) * DURATION_UNIT_MS[unit];
  }
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}
