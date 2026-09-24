import { cn } from "../../lib/utils";

export type StatusRingTone =
  | "working"
  | "waiting"
  | "failed"
  | "ready"
  | "scheduled"
  | "draft";

const STATUS_RING_TONE_CLASS: Record<StatusRingTone, string> = {
  working: "text-status-working",
  waiting: "text-status-waiting",
  failed: "text-status-failed",
  ready: "text-status-ready",
  scheduled: "text-subtle-foreground",
  draft: "text-draft",
};

const DASHED_TONES: ReadonlySet<StatusRingTone> = new Set([
  "working",
  "waiting",
]);

interface StatusRingProps {
  tone: StatusRingTone;
  label?: string;
  className?: string;
}

export function StatusRing({ tone, label, className }: StatusRingProps) {
  return (
    <span
      data-status-ring={tone}
      className={cn(
        "pointer-events-none inline-flex size-4 shrink-0 items-center justify-center",
        STATUS_RING_TONE_CLASS[tone],
        className,
      )}
      {...(label === undefined
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
    >
      <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
        <circle
          cx="5"
          cy="5"
          r="4.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={DASHED_TONES.has(tone) ? "3.15 2.19" : undefined}
          transform="rotate(-90 5 5)"
        />
      </svg>
    </span>
  );
}
