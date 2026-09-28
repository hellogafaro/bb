import {
  machineRemovalDescriptions,
  machineRemovalLabels,
  type MachineRemovalStatus,
} from "@/lib/machine-removal-display";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import type {
  Agent,
  EnvironmentStatus,
  ThreadListEntry,
  ThreadPullRequest,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import { threadListIndicatorStateForThread } from "@bb/client-core";
import { ThreadStatusMascot } from "@/components/agents/ThreadStatusMascot";
import {
  formatRelativeAge,
  getThreadLastActivityAt,
  useRelativeTimeNow,
} from "@/components/sidebar/ThreadRowMeta";
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
  agent: Agent | null;
  thread: ThreadListEntry;
  state: ThreadPromptChildThreadState;
  hasPendingInteraction: boolean;
}

export interface ThreadPromptChildThreadsSection {
  items: readonly ThreadPromptChildThreadItem[];
  openThreadId?: string | null;
  onOpen?: (threadId: string) => void;
}

export const CHILD_THREAD_STATE_LABEL: Record<
  ThreadPromptChildThreadState,
  string
> = {
  "needs-input": "Needs input",
  active: "Active",
  done: "Done",
};

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

function sortChildThreadItems(
  items: readonly ThreadPromptChildThreadItem[],
): ThreadPromptChildThreadItem[] {
  return [...items].sort(
    (left, right) =>
      CHILD_THREAD_STATE_ORDER[left.state] -
      CHILD_THREAD_STATE_ORDER[right.state],
  );
}

function ChildThreadMascot({ item }: { item: ThreadPromptChildThreadItem }) {
  const indicator = threadListIndicatorStateForThread(item.thread, false);
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      <ThreadStatusMascot {...indicator} agent={item.agent} />
    </span>
  );
}

function ChildThreadRow({
  item,
  isOpen,
  onOpen,
}: {
  item: ThreadPromptChildThreadItem;
  isOpen: boolean;
  onOpen: () => void;
}) {
  const now = useRelativeTimeNow();
  const titleText = useThreadTitleDisplayText(item.title);
  const stateLabel = CHILD_THREAD_STATE_LABEL[item.state];
  const age = formatRelativeAge(getThreadLastActivityAt(item.thread), now);
  return (
    <li>
      <button
        type="button"
        aria-label={`${stateLabel}: ${titleText}`}
        aria-pressed={isOpen}
        onClick={onOpen}
        className={cn(
          PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
          "gap-2",
          isOpen && "bg-background/80",
        )}
      >
        <ChildThreadMascot item={item} />
        <span className="min-w-0 flex-1 truncate text-left">
          <ThreadTitle title={item.title} inline />
        </span>
        <span className="shrink-0 whitespace-nowrap text-meta text-subtle-foreground">
          {age}
        </span>
      </button>
    </li>
  );
}

function ChildThreadsBody({
  items,
  openThreadId,
  onOpen,
}: {
  items: readonly ThreadPromptChildThreadItem[];
  openThreadId: string | null;
  onOpen: ((threadId: string) => void) | undefined;
}) {
  return (
    <ul>
      {items.map((item) => (
        <ChildThreadRow
          key={item.id}
          item={item}
          isOpen={openThreadId === item.id}
          onOpen={() => onOpen?.(item.id)}
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
  if (args.count === 1) {
    if (args.pendingCount > 0) return "1 subagent needs input";
    if (args.activeCount > 0) return "1 subagent running";
    return "1 subagent";
  }
  const base = `${args.count} subagents`;
  if (args.pendingCount > 0) {
    return `${base} · ${args.pendingCount} ${args.pendingCount === 1 ? "needs" : "need"} input`;
  }
  if (args.activeCount > 0) {
    return `${base} · ${args.activeCount} running`;
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
  if (items.length === 0) {
    return null;
  }
  const pendingCount = items.filter(
    (item) => item.state === "needs-input",
  ).length;
  const activeCount = items.filter((item) => item.state === "active").length;
  const groupLabel = childThreadsLabel({
    count: items.length,
    pendingCount,
    activeCount,
  });
  const isActive = pendingCount === 0 && activeCount > 0;
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
          aria-label={groupLabel}
          onClick={onToggle}
          className={
            isActive
              ? activityRowClass(
                  "active",
                  PROMPT_STACK_CARD_HEADER_BUTTON_CLASS,
                )
              : PROMPT_STACK_CARD_HEADER_BUTTON_CLASS
          }
        >
          <Icon
            name="Robot"
            className={
              isActive
                ? activityIconClass("active", "size-3.5 shrink-0")
                : "size-3.5 shrink-0 text-muted-foreground"
            }
            aria-hidden="true"
          />
          <span className="min-w-0 flex-1 truncate text-left font-medium">
            {groupLabel}
          </span>
          <PromptStackCardChevron
            isExpanded={isExpanded}
            className="text-muted-foreground"
          />
        </button>
      </div>
      <AnimatedBody
        collapsedBorder="none"
        id={SECTION_IDS.childThreads.body}
        labelledBy={SECTION_IDS.childThreads.toggle}
        isExpanded={isExpanded}
      >
        <ChildThreadsBody
          items={items}
          openThreadId={childThreadsSection.openThreadId ?? null}
          onOpen={childThreadsSection.onOpen}
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
