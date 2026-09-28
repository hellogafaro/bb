import {
  machineRemovalDescriptions,
  machineRemovalLabels,
  type MachineRemovalStatus,
} from "@/lib/machine-removal-display";
import {
  forwardRef,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { NavLink } from "react-router-dom";
import type {
  EnvironmentStatus,
  ThreadPullRequest,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type { PullRequestMergeMethod } from "@bb/server-contract";
import {
  PromptStackCard,
  PromptStackCardChevron,
  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
  PROMPT_STACK_CARD_ROW_HEIGHT,
  PROMPT_STACK_INLAY_INSET_CLASS,
  PROMPT_STACK_INLAY_SEGMENT_CLASS,
} from "@/components/promptbox/banner/PromptStackCard";
import {
  activityIconClass,
  activityRowClass,
} from "@bb/shared-ui/activity-row-styles";
import { cn } from "@bb/shared-ui/lib/utils";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  getPullRequestAttentionDisplay,
  getPullRequestGithubCheckStatus,
  PULL_REQUEST_STATE_DISPLAY,
} from "@/lib/pull-request-display";
import { PullRequestStatusPill } from "@/components/pull-request/PullRequestStatusPill";
import { AnimatedBody } from "@/components/promptbox/banner/AnimatedBody";
import { ChildThreadPanel } from "@/components/promptbox/banner/ChildThreadPanel";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import {
  BannerActionSlot,
  PROMPT_BANNER_ACTION_FILL_CLASS,
  PROMPT_BANNER_ACTION_SEGMENT_CLASS,
  PromptBannerActionButton,
} from "@/components/promptbox/banner/prompt-banner-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { useUrlAnchorClickHandler } from "@/lib/url-open-routing";
import {
  ThreadTitle,
  useThreadTitleDisplayText,
} from "@/components/thread/ThreadTitleMentions";

export interface ThreadPromptParentThreadSection {
  parentThreadTitle: string;
  href: string;
  relationship: "parent" | "fork" | "side-chat";
}

export type ThreadPromptChildThreadState = "needs-input" | "active" | "done";

export interface ThreadPromptChildThreadItem {
  id: string;
  title: string;
  href: string;
  projectId: string;
  providerId: string;
  state: ThreadPromptChildThreadState;
  hasPendingInteraction: boolean;
}

export interface ThreadPromptChildThreadsSection {
  items: readonly ThreadPromptChildThreadItem[];
  resolveMentionLink?: PromptMentionLinkResolver;
}

export interface ThreadPromptPullRequestSection {
  pullRequest: ThreadPullRequest;
  actions?: {
    isPending?: boolean;
    onMarkReady?: () => void;
    onMerge?: (method: PullRequestMergeMethod) => void;
    onConvertToDraft?: () => void;
    selectedMergeMethod?: PullRequestMergeMethod;
  };
}

export interface ThreadPromptArchivedSection {
  archivedAt: number;
  onUnarchive?: () => void;
  unarchivePending?: boolean;
}

export interface ThreadPromptEnvironmentGoneSection {
  status: Extract<EnvironmentStatus, "destroyed"> | MachineRemovalStatus;
  onRestore?: () => void;
  restorePending?: boolean;
}

const THREAD_BANNER_ACTIVE_CHILD_RUNTIME_STATUSES: ReadonlySet<ThreadRuntimeDisplayStatus> =
  new Set([
    "active",
    "host-reconnecting",
    "provisioning",
    "starting",
    "waiting-for-host",
  ]);

export function isThreadDisplayStatusBannerActive(
  status: ThreadRuntimeDisplayStatus,
): boolean {
  return THREAD_BANNER_ACTIVE_CHILD_RUNTIME_STATUSES.has(status);
}

export type ThreadPromptContextBannerExpandedSection =
  | "parentThread"
  | "childThreads"
  | "status";

interface ThreadPromptContextBannerProps {
  archivedSection: ThreadPromptArchivedSection | null;
  environmentGoneSection: ThreadPromptEnvironmentGoneSection | null;
  parentThreadSection: ThreadPromptParentThreadSection | null;
  childThreadsSection: ThreadPromptChildThreadsSection | null;
  pullRequestSection: ThreadPromptPullRequestSection | null;
  expandedSection: ThreadPromptContextBannerExpandedSection | null;
  onToggleSection: (section: ThreadPromptContextBannerExpandedSection) => void;
}

const ARCHIVED_THREAD_STATUS_LABEL = "Thread is archived";
const ENVIRONMENT_GONE_STATUS_COPY: Record<
  ThreadPromptEnvironmentGoneSection["status"],
  { description: string; label: string }
> = {
  destroyed: {
    description:
      "Environment unavailable. You can still view this thread’s history.",
    label: "Environment unavailable",
  },
  removed: {
    label: machineRemovalLabels.removed,
    description: machineRemovalDescriptions.removed,
  },
  removing: {
    label: machineRemovalLabels.removing,
    description: machineRemovalDescriptions.removing,
  },
  "cleanup-failed": {
    label: machineRemovalLabels["cleanup-failed"],
    description: machineRemovalDescriptions["cleanup-failed"],
  },
};

const SECTION_IDS = {
  parentThread: {
    toggle: "thread-prompt-banner-parent-thread-toggle",
    body: "thread-prompt-banner-parent-thread-body",
  },
  childThreads: {
    toggle: "thread-prompt-banner-child-threads-toggle",
    body: "thread-prompt-banner-child-threads-body",
  },
  status: {
    toggle: "thread-prompt-banner-status-toggle",
    body: "thread-prompt-banner-status-body",
  },
} as const;

const SEGMENT_SHRINK_CLASS = "min-w-0 overflow-hidden";

interface SectionToggleButtonProps {
  id: string;
  controlsId: string;
  ariaLabel?: string;
  icon: ReactNode;
  label: ReactNode;
  hideLabelInCompact?: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}

function SectionToggleButton({
  id,
  controlsId,
  ariaLabel,
  icon,
  label,
  hideLabelInCompact = true,
  isExpanded,
  onToggle,
}: SectionToggleButtonProps) {
  return (
    <button
      type="button"
      id={id}
      aria-expanded={isExpanded}
      aria-controls={controlsId}
      aria-label={ariaLabel}
      onClick={onToggle}
      className={cn(
        "flex cursor-pointer items-center text-xs transition-colors",
        PROMPT_STACK_INLAY_SEGMENT_CLASS,
        "hover:bg-state-hover",
        SEGMENT_SHRINK_CLASS,
        label !== null && label !== undefined ? "gap-1.5" : "gap-0",
        isExpanded ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {icon}
      {label !== null && label !== undefined ? (
        <span
          className="min-w-0 truncate"
          data-promptbox-hide-compact={hideLabelInCompact ? "" : undefined}
        >
          {label}
        </span>
      ) : null}
      <Icon
        name="ChevronDown"
        className={cn(
          "size-3.5 shrink-0 text-subtle-foreground transition-transform duration-200",
          isExpanded && "rotate-180",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

const PARENT_SECTION_COPY: Record<
  ThreadPromptParentThreadSection["relationship"],
  { verb: string; bodyLead: string; ariaPrefix: string }
> = {
  parent: {
    verb: "Parent",
    bodyLead: "This thread is a child of ",
    ariaPrefix: "Parent thread",
  },
  fork: {
    verb: "Forked from",
    bodyLead: "This thread was forked from ",
    ariaPrefix: "Forked from",
  },
  "side-chat": {
    verb: "Side chat of",
    bodyLead: "This thread is a side chat of ",
    ariaPrefix: "Side chat of",
  },
};

const PARENT_SECTION_ICON: Record<
  ThreadPromptParentThreadSection["relationship"],
  IconName
> = {
  parent: "UserRound",
  fork: "Fork",
  "side-chat": "SideChat",
};

function useParentSectionAriaLabel(
  section: ThreadPromptParentThreadSection,
): string {
  const parentThreadTitle = useThreadTitleDisplayText(
    section.parentThreadTitle,
  );
  return `${PARENT_SECTION_COPY[section.relationship].ariaPrefix} ${parentThreadTitle}`;
}

const PARENT_THREAD_TITLE_CLASS =
  "text-foreground/90 underline underline-offset-2";

function ParentThreadInlineSegment({
  section,
}: {
  section: ThreadPromptParentThreadSection;
}) {
  const ariaLabel = useParentSectionAriaLabel(section);
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs",
        PROMPT_STACK_INLAY_SEGMENT_CLASS,
      )}
      title={ariaLabel}
    >
      <Icon
        name={PARENT_SECTION_ICON[section.relationship]}
        className="size-3.5 shrink-0"
        aria-hidden="true"
      />
      <span className="min-w-0 truncate">
        {PARENT_SECTION_COPY[section.relationship].verb}{" "}
        <NavLink to={section.href}>
          <ThreadTitle
            title={section.parentThreadTitle}
            className={PARENT_THREAD_TITLE_CLASS}
            inline
          />
        </NavLink>
      </span>
    </div>
  );
}

function shouldShowPullRequestAttentionLabel(
  pullRequest: ThreadPullRequest,
): boolean {
  return (
    pullRequest.attention === "checks_failed" ||
    pullRequest.attention === "changes_requested" ||
    pullRequest.attention === "review_requested" ||
    pullRequest.attention === "conflicts" ||
    pullRequest.attention === "blocked"
  );
}

function ParentThreadSectionToggle({
  section,
  isExpanded,
  onToggle,
}: {
  section: ThreadPromptParentThreadSection;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const ariaLabel = useParentSectionAriaLabel(section);
  return (
    <SectionToggleButton
      id={SECTION_IDS.parentThread.toggle}
      controlsId={SECTION_IDS.parentThread.body}
      ariaLabel={ariaLabel}
      icon={
        <Icon
          name={PARENT_SECTION_ICON[section.relationship]}
          className="size-3.5 shrink-0"
          aria-hidden="true"
        />
      }
      label={null}
      isExpanded={isExpanded}
      onToggle={onToggle}
    />
  );
}

function ParentThreadSectionBody({
  section,
  isExpanded,
}: {
  section: ThreadPromptParentThreadSection;
  isExpanded: boolean;
}) {
  return (
    <AnimatedBody
      collapsedBorder="reserve"
      id={SECTION_IDS.parentThread.body}
      labelledBy={SECTION_IDS.parentThread.toggle}
      isExpanded={isExpanded}
    >
      <div className="px-3 pb-2 pt-1.5 text-xs leading-relaxed text-muted-foreground">
        {PARENT_SECTION_COPY[section.relationship].bodyLead}
        <NavLink to={section.href}>
          <ThreadTitle
            title={section.parentThreadTitle}
            className={PARENT_THREAD_TITLE_CLASS}
            inline
          />
        </NavLink>
        .
      </div>
    </AnimatedBody>
  );
}

const CHILD_THREAD_STATE_ORDER: Record<ThreadPromptChildThreadState, number> = {
  "needs-input": 0,
  active: 1,
  done: 2,
};

const CHILD_THREAD_STATE_LABEL: Record<ThreadPromptChildThreadState, string> = {
  "needs-input": "Needs input",
  active: "Active",
  done: "Done",
};

function sortChildThreadItems(
  items: readonly ThreadPromptChildThreadItem[],
): ThreadPromptChildThreadItem[] {
  return [...items].sort(
    (left, right) =>
      CHILD_THREAD_STATE_ORDER[left.state] -
      CHILD_THREAD_STATE_ORDER[right.state],
  );
}

function ChildThreadStateIcon({
  state,
  className,
}: {
  state: ThreadPromptChildThreadState;
  className?: string;
}) {
  switch (state) {
    case "needs-input":
      return (
        <Icon
          name="CircleQuestion"
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/75",
            className,
          )}
          aria-hidden="true"
        />
      );
    case "active":
      return (
        <Icon
          name="UserRound"
          className={activityIconClass(
            "active",
            cn("size-3.5 shrink-0", className),
          )}
          aria-hidden="true"
        />
      );
    case "done":
      return (
        <Icon
          name="Check"
          className={cn("size-3.5 shrink-0 text-subtle-foreground", className)}
          aria-hidden="true"
        />
      );
    default: {
      const exhaustiveCheck: never = state;
      return exhaustiveCheck;
    }
  }
}

function childThreadRowId(threadId: string): string {
  return `thread-prompt-banner-child-thread-${threadId}`;
}

function ChildThreadRow({
  item,
  isExpanded,
  onToggle,
  resolveMentionLink,
}: {
  item: ThreadPromptChildThreadItem;
  isExpanded: boolean;
  onToggle: () => void;
  resolveMentionLink: PromptMentionLinkResolver | undefined;
}) {
  const titleText = useThreadTitleDisplayText(item.title);
  const panelId = `${childThreadRowId(item.id)}-panel`;
  return (
    <li className="text-xs">
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          id={childThreadRowId(item.id)}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          aria-label={`${CHILD_THREAD_STATE_LABEL[item.state]}: ${titleText}`}
          onClick={onToggle}
          className="flex min-h-7 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-left text-foreground/90 transition-colors hover:bg-background/80"
        >
          <ChildThreadStateIcon state={item.state} />
          <ThreadTitle title={item.title} tooltip className="flex-1" />
          <span className="shrink-0 text-muted-foreground">
            {CHILD_THREAD_STATE_LABEL[item.state]}
          </span>
          <PromptStackCardChevron
            isExpanded={isExpanded}
            className="text-muted-foreground"
          />
        </button>
        <NavLink
          to={item.href}
          aria-label={`Open ${titleText}`}
          title="Open thread"
          className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
        >
          <Icon name="ExternalLink" className="size-3.5" aria-hidden="true" />
        </NavLink>
      </div>
      <AnimatedBody
        collapsedBorder="none"
        id={panelId}
        labelledBy={childThreadRowId(item.id)}
        isExpanded={isExpanded}
      >
        {isExpanded ? (
          <ChildThreadPanel
            projectId={item.projectId}
            providerId={item.providerId}
            resolveMentionLink={resolveMentionLink}
            threadId={item.id}
          />
        ) : null}
      </AnimatedBody>
    </li>
  );
}

function ChildThreadsBody({
  items,
  resolveMentionLink,
}: {
  items: readonly ThreadPromptChildThreadItem[];
  resolveMentionLink: PromptMentionLinkResolver | undefined;
}) {
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  useEffect(() => {
    if (
      expandedThreadId !== null &&
      !items.some((item) => item.id === expandedThreadId)
    ) {
      setExpandedThreadId(null);
    }
  }, [expandedThreadId, items]);
  return (
    <ul className="space-y-0.5 px-2 pb-2 pt-1">
      {items.map((item) => (
        <ChildThreadRow
          key={item.id}
          item={item}
          isExpanded={expandedThreadId === item.id}
          onToggle={() =>
            setExpandedThreadId((current) =>
              current === item.id ? null : item.id,
            )
          }
          resolveMentionLink={resolveMentionLink}
        />
      ))}
    </ul>
  );
}

const PromptBannerActionGroup = ({ children }: { children: ReactNode }) => (
  <div
    className={cn(
      "inline-flex overflow-hidden rounded border border-border",
      PROMPT_BANNER_ACTION_FILL_CLASS,
    )}
  >
    {children}
  </div>
);

const PromptBannerActionSegmentButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement>
>(function PromptBannerActionSegmentButton(
  { className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "px-1.5 py-0.5",
        PROMPT_BANNER_ACTION_SEGMENT_CLASS,
        className,
      )}
      {...props}
    />
  );
});

function PendingBannerActionButton({
  pending,
  label,
  pendingLabel,
  onClick,
}: {
  pending: boolean;
  label: string;
  pendingLabel: string;
  onClick: () => void;
}) {
  return (
    <PromptBannerActionButton onClick={onClick} disabled={pending}>
      {pending ? pendingLabel : label}
    </PromptBannerActionButton>
  );
}

const PULL_REQUEST_MERGE_ACTIONS: readonly {
  method: PullRequestMergeMethod;
  label: string;
}[] = [
  { method: "merge", label: "Merge" },
  { method: "squash", label: "Squash merge" },
  { method: "rebase", label: "Rebase and merge" },
];

function PullRequestMergeSplitButton({
  disabled,
  onConvertToDraft,
  onMerge,
  selectedMethod,
}: {
  disabled?: boolean;
  onConvertToDraft?: () => void;
  onMerge: (method: PullRequestMergeMethod) => void;
  selectedMethod: PullRequestMergeMethod;
}) {
  const selectedAction =
    PULL_REQUEST_MERGE_ACTIONS.find(
      (action) => action.method === selectedMethod,
    ) ?? PULL_REQUEST_MERGE_ACTIONS[0];
  return (
    <PromptBannerActionGroup>
      <PromptBannerActionSegmentButton
        disabled={Boolean(disabled)}
        onClick={() => onMerge(selectedAction.method)}
      >
        {selectedAction.label}
      </PromptBannerActionSegmentButton>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PromptBannerActionSegmentButton
            disabled={Boolean(disabled)}
            className={cn(
              "inline-flex items-center border-l border-border px-1 data-[state=open]:bg-state-active data-[state=open]:text-foreground",
            )}
            aria-label="Choose pull request merge method"
          >
            <Icon name="ChevronDown" className="size-3" aria-hidden="true" />
          </PromptBannerActionSegmentButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={2}
          mobileTitle="Merge pull request"
        >
          {PULL_REQUEST_MERGE_ACTIONS.map((action) => (
            <DropdownMenuItem
              key={action.method}
              onSelect={() => onMerge(action.method)}
              textValue={action.label}
            >
              {action.label}
            </DropdownMenuItem>
          ))}
          {onConvertToDraft ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onConvertToDraft}
                textValue="Convert to draft"
              >
                Convert to draft
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </PromptBannerActionGroup>
  );
}

function PullRequestBannerLink({
  pullRequest,
  hideLabelInCompact,
  showLabel,
  showStateLabel,
}: {
  pullRequest: ThreadPullRequest;
  hideLabelInCompact: boolean;
  showLabel: boolean;
  showStateLabel: boolean;
}) {
  const attentionDisplay = getPullRequestAttentionDisplay(pullRequest);
  const stateDisplay = PULL_REQUEST_STATE_DISPLAY[pullRequest.state];
  const handlePullRequestClick = useUrlAnchorClickHandler(pullRequest.url);
  const showAttentionLabel =
    showLabel && shouldShowPullRequestAttentionLabel(pullRequest);
  return (
    <a
      href={pullRequest.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handlePullRequestClick}
      aria-label={`Pull request ${pullRequest.number}: ${attentionDisplay.label}`}
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground no-underline transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        PROMPT_STACK_INLAY_SEGMENT_CLASS,
        getPullRequestGithubCheckStatus(pullRequest) !== null
          ? "min-w-13"
          : "min-w-8",
        "overflow-hidden",
      )}
    >
      <PullRequestStatusPill pullRequest={pullRequest} className="h-4" />
      {showLabel ? (
        <span
          className="min-w-0 truncate"
          data-promptbox-hide-compact={hideLabelInCompact ? "" : undefined}
        >
          PR #{pullRequest.number}
          {showStateLabel && pullRequest.state !== "open"
            ? ` · ${stateDisplay.label}`
            : ""}
        </span>
      ) : null}
      {showAttentionLabel ? (
        <span className={cn("min-w-0 truncate", attentionDisplay.className)}>
          · {attentionDisplay.label}
        </span>
      ) : null}
    </a>
  );
}

function childThreadsLabel(args: {
  count: number;
  pendingCount: number;
  activeCount: number;
}): string {
  const base = `${args.count} child ${args.count === 1 ? "thread" : "threads"}`;
  if (args.pendingCount > 0) {
    return `${base} · ${args.pendingCount} ${args.pendingCount === 1 ? "needs" : "need"} input`;
  }
  if (args.activeCount > 0) {
    return `${base} · ${args.activeCount} active`;
  }
  return base;
}

function ChildThreadsCard({
  childThreadsSection,
  isExpanded,
  onToggle,
}: {
  childThreadsSection: ThreadPromptChildThreadsSection;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const items = sortChildThreadItems(childThreadsSection.items);
  const primary = items[0];
  const primaryTitle = useThreadTitleDisplayText(primary?.title ?? "");
  if (!primary) {
    return null;
  }
  const pendingCount = items.filter(
    (item) => item.state === "needs-input",
  ).length;
  const activeCount = items.filter((item) => item.state === "active").length;
  const otherCount = items.length - 1;
  const groupLabel = childThreadsLabel({
    count: items.length,
    pendingCount,
    activeCount,
  });
  const headerState = primary.state;
  return (
    <PromptStackCard
      ariaLabel="Child threads"
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div className="flex items-center">
        <button
          type="button"
          id={SECTION_IDS.childThreads.toggle}
          aria-expanded={isExpanded}
          aria-controls={SECTION_IDS.childThreads.body}
          aria-label={`${groupLabel}: ${primaryTitle}`}
          onClick={onToggle}
          className={
            headerState === "active"
              ? activityRowClass(
                  "active",
                  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
                )
              : PROMPT_STACK_CARD_HEADER_BUTTON_CLASS
          }
        >
          <ChildThreadStateIcon state={headerState} />
          <span className="min-w-0 flex-1 truncate text-left">
            <span className="text-muted-foreground">
              {CHILD_THREAD_STATE_LABEL[headerState]}:{" "}
            </span>
            <ThreadTitle
              title={primary.title}
              className="font-medium text-foreground/80"
              inline
            />
          </span>
          {otherCount > 0 ? (
            <span className="shrink-0 text-muted-foreground">
              +{otherCount} more
            </span>
          ) : null}
          <PromptStackCardChevron
            isExpanded={isExpanded}
            className="text-muted-foreground"
          />
        </button>
      </div>
      <AnimatedBody
        collapsedBorder="reserve"
        id={SECTION_IDS.childThreads.body}
        labelledBy={SECTION_IDS.childThreads.toggle}
        isExpanded={isExpanded}
      >
        <ChildThreadsBody
          items={items}
          resolveMentionLink={childThreadsSection.resolveMentionLink}
        />
      </AnimatedBody>
    </PromptStackCard>
  );
}

interface ReadOnlyContextBannerProps {
  iconName: IconName;
  statusLabel: string;
  description: string | null;
  parentThreadSection: ThreadPromptParentThreadSection | null;
  statusAction: ReactNode;
  expandedSection: ThreadPromptContextBannerExpandedSection | null;
  onToggleSection: (section: ThreadPromptContextBannerExpandedSection) => void;
}

function ReadOnlyContextBanner({
  iconName,
  statusLabel,
  description,
  parentThreadSection,
  statusAction,
  expandedSection,
  onToggleSection,
}: ReadOnlyContextBannerProps) {
  const isParentThreadExpanded =
    expandedSection === "parentThread" && parentThreadSection !== null;
  const isStatusExpanded = expandedSection === "status" && description !== null;
  const hasMultipleSegments = parentThreadSection !== null;
  const statusIcon = (
    <Icon name={iconName} className="size-3.5 shrink-0" aria-hidden="true" />
  );
  const showStatusAction = statusAction !== null && !hasMultipleSegments;
  return (
    <PromptStackCard
      ariaLabel="Thread history"
      className="overflow-hidden"
      style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
    >
      <div
        className={cn(
          "flex items-center gap-0.5 text-xs text-muted-foreground",
          PROMPT_STACK_INLAY_INSET_CLASS,
        )}
      >
        {parentThreadSection ? (
          <ParentThreadSectionToggle
            section={parentThreadSection}
            isExpanded={isParentThreadExpanded}
            onToggle={() => onToggleSection("parentThread")}
          />
        ) : null}
        {description === null ? (
          <div
            className={cn(
              "flex min-w-0 items-center gap-1.5 text-xs",
              PROMPT_STACK_INLAY_SEGMENT_CLASS,
            )}
            role="status"
            aria-label={statusLabel}
          >
            {statusIcon}
            <span className="min-w-0 truncate" aria-hidden="true">
              {statusLabel}
            </span>
          </div>
        ) : (
          <SectionToggleButton
            id={SECTION_IDS.status.toggle}
            controlsId={SECTION_IDS.status.body}
            icon={statusIcon}
            label={statusLabel}
            hideLabelInCompact={false}
            isExpanded={isStatusExpanded}
            onToggle={() => onToggleSection("status")}
          />
        )}
        {showStatusAction ? (
          <BannerActionSlot>{statusAction}</BannerActionSlot>
        ) : null}
      </div>
      {description === null ? null : (
        <AnimatedBody
          collapsedBorder="reserve"
          id={SECTION_IDS.status.body}
          labelledBy={SECTION_IDS.status.toggle}
          isExpanded={isStatusExpanded}
        >
          <p className="px-3 pb-2 pt-1.5 text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        </AnimatedBody>
      )}
      {parentThreadSection ? (
        <ParentThreadSectionBody
          section={parentThreadSection}
          isExpanded={isParentThreadExpanded}
        />
      ) : null}
    </PromptStackCard>
  );
}

export function ThreadPromptContextBanner({
  archivedSection,
  environmentGoneSection,
  parentThreadSection,
  childThreadsSection,
  pullRequestSection,
  expandedSection,
  onToggleSection,
}: ThreadPromptContextBannerProps) {
  if (archivedSection || environmentGoneSection) {
    const environmentGone = environmentGoneSection !== null;
    const environmentGoneCopy = environmentGoneSection
      ? ENVIRONMENT_GONE_STATUS_COPY[environmentGoneSection.status]
      : null;
    return (
      <ReadOnlyContextBanner
        iconName={environmentGone ? "CircleX" : "Archive"}
        statusLabel={environmentGoneCopy?.label ?? ARCHIVED_THREAD_STATUS_LABEL}
        description={environmentGoneCopy?.description ?? null}
        statusAction={
          archivedSection?.onUnarchive ? (
            <PendingBannerActionButton
              pending={Boolean(archivedSection.unarchivePending)}
              label="Unarchive"
              pendingLabel="Unarchiving..."
              onClick={archivedSection.onUnarchive}
            />
          ) : environmentGoneSection?.onRestore ? (
            <PendingBannerActionButton
              pending={Boolean(environmentGoneSection.restorePending)}
              label="Restore workspace"
              pendingLabel="Restoring..."
              onClick={environmentGoneSection.onRestore}
            />
          ) : null
        }
        parentThreadSection={parentThreadSection}
        expandedSection={expandedSection}
        onToggleSection={onToggleSection}
      />
    );
  }
  const showParentThread = parentThreadSection !== null;
  const showChildThreads =
    childThreadsSection !== null && childThreadsSection.items.length > 0;
  const showPullRequest = pullRequestSection !== null;
  if (!showParentThread && !showChildThreads && !showPullRequest) {
    return null;
  }
  const visibleSegmentCount =
    Number(showParentThread) + Number(showPullRequest);
  const hasSingleVisibleSegment = visibleSegmentCount === 1;
  const isParentThreadExpanded =
    expandedSection === "parentThread" && showParentThread;
  const isChildThreadsExpanded =
    expandedSection === "childThreads" && showChildThreads;
  const activeChildThreadsCard =
    showChildThreads && childThreadsSection ? (
      <ChildThreadsCard
        childThreadsSection={childThreadsSection}
        isExpanded={isChildThreadsExpanded}
        onToggle={() => onToggleSection("childThreads")}
      />
    ) : null;
  const isParentThreadOnly = showParentThread && !showPullRequest;

  const pullRequest = pullRequestSection?.pullRequest ?? null;
  const pullRequestActions = pullRequestSection?.actions;
  const pullRequestAction =
    pullRequest && pullRequestActions ? (
      pullRequest.state === "draft" && pullRequestActions.onMarkReady ? (
        <BannerActionSlot>
          <PendingBannerActionButton
            pending={Boolean(pullRequestActions.isPending)}
            label="Mark ready"
            pendingLabel="Marking..."
            onClick={pullRequestActions.onMarkReady}
          />
        </BannerActionSlot>
      ) : pullRequest.state === "open" &&
        pullRequest.mergeability.state === "mergeable" &&
        pullRequestActions.onMerge ? (
        <BannerActionSlot>
          <PullRequestMergeSplitButton
            disabled={pullRequestActions.isPending}
            onConvertToDraft={pullRequestActions.onConvertToDraft}
            onMerge={pullRequestActions.onMerge}
            selectedMethod={pullRequestActions.selectedMergeMethod ?? "merge"}
          />
        </BannerActionSlot>
      ) : null
    ) : null;

  const compactContextBanner =
    visibleSegmentCount > 0 ? (
      <PromptStackCard
        ariaLabel="Thread context before sending"
        className="overflow-hidden"
        style={{ minHeight: PROMPT_STACK_CARD_ROW_HEIGHT }}
      >
        <div
          className={cn(
            "flex items-center gap-0.5 text-xs text-muted-foreground",
            PROMPT_STACK_INLAY_INSET_CLASS,
          )}
        >
          {showParentThread && parentThreadSection && isParentThreadOnly ? (
            <ParentThreadInlineSegment section={parentThreadSection} />
          ) : null}
          {showParentThread && parentThreadSection && !isParentThreadOnly ? (
            <ParentThreadSectionToggle
              section={parentThreadSection}
              isExpanded={isParentThreadExpanded}
              onToggle={() => onToggleSection("parentThread")}
            />
          ) : null}
          {showPullRequest && pullRequest ? (
            <PullRequestBannerLink
              pullRequest={pullRequest}
              hideLabelInCompact={!hasSingleVisibleSegment}
              showLabel={hasSingleVisibleSegment}
              showStateLabel={hasSingleVisibleSegment}
            />
          ) : null}
          {pullRequestAction}
        </div>
        {showParentThread && parentThreadSection && !isParentThreadOnly ? (
          <ParentThreadSectionBody
            section={parentThreadSection}
            isExpanded={isParentThreadExpanded}
          />
        ) : null}
      </PromptStackCard>
    ) : null;

  if (activeChildThreadsCard && compactContextBanner) {
    return (
      <div className="min-w-0 space-y-2">
        {activeChildThreadsCard}
        {compactContextBanner}
      </div>
    );
  }

  return activeChildThreadsCard ?? compactContextBanner;
}
