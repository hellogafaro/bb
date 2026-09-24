import { Icon } from "@bb/shared-ui/icon";
import { StatusRing } from "@bb/shared-ui/status-ring";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  getThreadListIndicatorLabel,
  resolveThreadListIndicator,
  type ThreadListIndicatorKind,
  type ThreadListIndicatorState,
} from "@bb/client-core";
import type { PluginComposerThreadRowStatus } from "@get-bb/plugin-sdk";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import {
  SIDEBAR_STATUS_ICON_CLASS,
  SIDEBAR_SUCCESS_STATUS_COLOR_CLASS,
} from "@/components/sidebar/sidebarRowClasses";

function PluginThreadRowStatusIndicator({
  status,
  size,
}: {
  status: PluginComposerThreadRowStatus;
  size: "default" | "compact";
}) {
  const iconSizeClass =
    size === "compact" ? "size-3.5" : SIDEBAR_STATUS_ICON_CLASS;
  if (status.tone === "running") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center motion-safe:animate-pulse",
          iconSizeClass,
          "text-success",
        )}
      >
        <Icon
          name={pluginIconName(status.icon)}
          className={cn(
            "pointer-events-none shrink-0 animate-shine-icon",
            iconSizeClass,
          )}
          aria-label={status.label}
        />
      </span>
    );
  }

  return (
    <Icon
      name={pluginIconName(status.icon)}
      className={cn(
        "pointer-events-none shrink-0",
        iconSizeClass,
        status.tone === "success"
          ? SIDEBAR_SUCCESS_STATUS_COLOR_CLASS
          : status.tone === "error"
            ? "text-destructive"
            : "text-muted-foreground",
      )}
      aria-label={status.label}
    />
  );
}

interface ThreadStatusResolution {
  accessibleLabel: string | null;
  indicatorKind: ThreadListIndicatorKind | "archived";
  pluginStatusIsVisible: boolean;
}

export function resolveThreadStatus(
  statusProps: ThreadListIndicatorState,
  pluginStatus: PluginComposerThreadRowStatus | null = null,
  archived = false,
): ThreadStatusResolution {
  const indicatorKind = archived
    ? "archived"
    : resolveThreadListIndicator(statusProps);
  const pluginStatusIsVisible =
    !archived &&
    pluginStatus !== null &&
    indicatorKind !== "runtime" &&
    indicatorKind !== "unread-error" &&
    indicatorKind !== "waiting-for-input";

  return {
    accessibleLabel: pluginStatusIsVisible
      ? pluginStatus.label
      : indicatorKind === "archived"
        ? "Archived thread"
        : getThreadListIndicatorLabel(indicatorKind),
    indicatorKind,
    pluginStatusIsVisible,
  };
}

export interface ThreadStatusGlyphProps extends ThreadListIndicatorState {
  archived?: boolean;
  pluginStatus?: PluginComposerThreadRowStatus | null;
  hideIdleDraftLabel?: boolean;
  decorative?: boolean;
  size?: "default" | "compact";
}

export function ThreadStatusGlyph({
  archived = false,
  pluginStatus = null,
  hasPendingInteraction,
  hasUnsubmittedDraft,
  hasUnreadError,
  hasUnreadSuccess,
  hideIdleDraftLabel = false,
  decorative = false,
  isBackgroundAgentActive,
  isBackgroundCommandActive,
  isGoalActive,
  isPlanModeActive,
  isRuntimeActive,
  isWorkflowActive,
  queuedWork,
  size = "default",
}: ThreadStatusGlyphProps) {
  const iconSizeClass =
    size === "compact" ? "size-3.5" : SIDEBAR_STATUS_ICON_CLASS;
  const { indicatorKind: kind, pluginStatusIsVisible } = resolveThreadStatus(
    {
      hasPendingInteraction,
      hasUnsubmittedDraft,
      hasUnreadError,
      hasUnreadSuccess,
      isBackgroundAgentActive,
      isBackgroundCommandActive,
      isGoalActive,
      isPlanModeActive,
      isRuntimeActive,
      isWorkflowActive,
      queuedWork,
    },
    pluginStatus,
    archived,
  );

  if (pluginStatusIsVisible && pluginStatus) {
    return <PluginThreadRowStatusIndicator status={pluginStatus} size={size} />;
  }

  const label = decorative
    ? undefined
    : (getThreadListIndicatorLabel(kind === "archived" ? "none" : kind) ??
      undefined);
  const ringClassName = size === "compact" ? "size-3.5" : undefined;
  switch (kind) {
    case "archived":
      return (
        <Icon
          name="Archive"
          className={iconSizeClass}
          aria-label="Archived thread"
        />
      );
    case "unread-error":
    case "queued-failed":
      return (
        <StatusRing tone="failed" label={label} className={ringClassName} />
      );
    case "waiting-for-input":
      return (
        <StatusRing tone="waiting" label={label} className={ringClassName} />
      );
    case "queued-waiting":
      return (
        <StatusRing tone="scheduled" label={label} className={ringClassName} />
      );
    case "runtime":
    case "working-draft":
    case "workflow":
    case "background-agent":
    case "background-command":
    case "plan-mode":
    case "goal":
      return (
        <StatusRing tone="working" label={label} className={ringClassName} />
      );
    case "draft":
      return (
        <StatusRing
          tone="draft"
          label={hideIdleDraftLabel ? undefined : label}
          className={ringClassName}
        />
      );
    case "unread-success":
      return (
        <StatusRing tone="ready" label={label} className={ringClassName} />
      );
    case "none":
      return null;
  }
}
