import type { Agent } from "@bb/domain";
import { getThreadListIndicatorLabel } from "@bb/client-core";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  resolveThreadStatus,
  ThreadStatusGlyph,
  type ThreadStatusGlyphProps,
} from "@/components/thread/ThreadStatusGlyph";
import { AgentMascot } from "./mascots/AgentMascot";

export type ThreadMascotTone = "idle" | "working" | "error" | "waiting";

export function threadMascotTone(
  kind: ReturnType<typeof resolveThreadStatus>["indicatorKind"],
): ThreadMascotTone {
  switch (kind) {
    case "unread-error":
    case "queued-failed":
      return "error";
    case "waiting-for-input":
      return "waiting";
    case "runtime":
    case "working-draft":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
      return "working";
    case "queued-waiting":
    case "draft":
    case "unread-success":
    case "archived":
    case "none":
      return "idle";
  }
}

export function ThreadStatusMascot({
  agent,
  ...glyphProps
}: ThreadStatusGlyphProps & { agent: Agent | null }) {
  const {
    archived = false,
    decorative = false,
    hideIdleDraftLabel = false,
    pluginStatus = null,
    size = "default",
  } = glyphProps;
  const { indicatorKind, pluginStatusIsVisible } = resolveThreadStatus(
    glyphProps,
    pluginStatus,
    archived,
  );
  if (agent === null || pluginStatusIsVisible) {
    return <ThreadStatusGlyph {...glyphProps} />;
  }
  const tone = threadMascotTone(indicatorKind);
  const label =
    decorative || (hideIdleDraftLabel && indicatorKind === "draft")
      ? null
      : indicatorKind === "archived"
        ? "Archived thread"
        : getThreadListIndicatorLabel(indicatorKind);
  return (
    <span
      data-thread-status-mascot={tone}
      className={cn(
        "pointer-events-none relative inline-flex shrink-0 items-center justify-center",
        size === "compact" ? "size-3.5" : "size-4",
      )}
      {...(label === null
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": label })}
    >
      <AgentMascot
        mascot={agent.mascot}
        color={agent.color}
        active={tone === "working"}
        className={size === "compact" ? "size-3" : "size-3.5"}
      />
    </span>
  );
}
