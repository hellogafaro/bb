import { useEffect, useState, type ReactNode } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@bb/shared-ui/hover-card";
import { Icon } from "@bb/shared-ui/icon";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
  useSdk,
} from "@get-bb/plugin-sdk/app";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { SidebarThread } from "../model/sidebar-thread.js";
import { PromiseCache } from "../model/promise-cache.js";
import {
  formatRelativeAge,
  getThreadLastActivityAt,
  useRelativeTimeNow,
} from "../model/relative-time.js";
import { useSidebarProjectName } from "../model/use-sidebar-data.js";

interface ThreadHoverDetails {
  model: string | null;
  reasoning: string | null;
  modelProviderId: string | null;
  fullTitle: string | null;
}

type Sdk = ReturnType<typeof useSdk>;
type ModelInfo = { name: string; route: string | null };

const detailsCache = new PromiseCache<ThreadHoverDetails>();
const modelCache = new PromiseCache<Map<string, ModelInfo>>(32, 5 * 60_000);
const EMPTY_DETAILS: ThreadHoverDetails = {
  model: null,
  reasoning: null,
  modelProviderId: null,
  fullTitle: null,
};

function loadModelNames(sdk: Sdk, providerId: string) {
  return modelCache.get(providerId, async () => {
    const result = await sdk.providers.models({ providerId });
    return new Map(
      result.models.flatMap((model) => {
        const info = {
          name: model.displayName,
          route: model.routeProviderId ?? null,
        };
        return [
          [model.id, info],
          [model.model, info],
        ] as [string, ModelInfo][];
      }),
    );
  });
}

async function loadFirstPrompt(sdk: Sdk, threadId: string) {
  const events = await sdk.threads.events.list({
    threadId,
    order: "asc",
    limit: "20",
    types: ["client/turn/requested"],
  });
  for (const event of events) {
    const data = event.data as {
      initiator?: string;
      input?: { type: string; text?: string }[];
    };
    if (data.initiator !== "user") continue;
    const text = data.input
      ?.flatMap((part) =>
        part.type === "text" && part.text ? [part.text] : [],
      )
      .join("\n")
      .trim();
    if (text) return text.replace(/\s+/g, " ");
  }
  return null;
}

async function loadDetails(
  sdk: Sdk,
  thread: SidebarThread,
): Promise<ThreadHoverDetails> {
  const [options, names, fullTitle] = await Promise.all([
    sdk.threads
      .defaultExecutionOptions({ threadId: thread.id })
      .catch(() => null),
    loadModelNames(sdk, thread.providerId).catch(
      () => new Map<string, ModelInfo>(),
    ),
    thread.title
      ? Promise.resolve(null)
      : loadFirstPrompt(sdk, thread.id).catch(() => null),
  ]);
  const info = options ? names.get(options.model) : undefined;
  return {
    model: options ? (info?.name ?? options.model) : null,
    reasoning:
      options && options.reasoningLevel !== "none"
        ? options.reasoningLevel[0]!.toUpperCase() +
          options.reasoningLevel.slice(1)
        : null,
    modelProviderId: info?.route ?? null,
    fullTitle,
  };
}

function useThreadHoverDetails(thread: SidebarThread, enabled: boolean) {
  const sdk = useSdk();
  const [details, setDetails] = useState<ThreadHoverDetails | null>(
    () => detailsCache.peek(thread.id) ?? null,
  );
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    detailsCache
      .get(thread.id, () => loadDetails(sdk, thread))
      .then(
        (value) => {
          if (live) setDetails(value);
        },
        () => {
          if (live) setDetails((current) => current ?? EMPTY_DETAILS);
        },
      );
    return () => {
      live = false;
    };
  }, [enabled, sdk, thread]);
  return detailsCache.peek(thread.id) ?? details;
}

function ThreadHoverCardBody({
  thread,
  details,
}: {
  thread: SidebarThread;
  details: ThreadHoverDetails | null;
}) {
  const now = useRelativeTimeNow();
  const projectName = useSidebarProjectName(thread.projectId);
  const { providers } = experimental_useProviders();
  const location =
    thread.projectId === PERSONAL_PROJECT_ID || !projectName
      ? "Personal"
      : projectName;
  const at = getThreadLastActivityAt(thread);
  const age = formatRelativeAge(at, now);
  const provider = providers.find(
    (candidate) => candidate.id === details?.modelProviderId,
  ) ??
    providers.find((candidate) => candidate.id === thread.providerId) ?? {
      id: thread.providerId,
    };
  const providerName = providers.find(
    (candidate) => candidate.id === thread.providerId,
  )?.displayName;
  const worktree =
    thread.environmentProviderId !== null ? thread.environmentName : null;
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3 text-xs leading-4">
      <div className="flex items-center justify-between gap-3 text-subtle-foreground">
        <span className="flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
          <Icon name="Folder" className="size-3.5 shrink-0" aria-hidden />
          <span>{location}</span>
        </span>
        <time className="shrink-0" dateTime={new Date(at).toISOString()}>
          {age === "now" ? "now" : `${age} ago`}
        </time>
      </div>
      <p className="m-0 max-h-60 overflow-y-auto text-sm leading-5 text-foreground [overflow-wrap:anywhere] [scrollbar-width:thin]">
        {thread.title || details?.fullTitle || thread.displayTitle}
      </p>
      <div className="flex flex-col gap-1.5 border-t border-border pt-2.5 text-muted-foreground">
        <span
          className="flex min-h-4 min-w-0 items-center gap-1.5"
          title={
            providerName && details?.model
              ? `${providerName}: ${details.model}${details.reasoning ? ` · ${details.reasoning} reasoning` : ""}`
              : undefined
          }
        >
          <ProviderIcon
            providerKind="agent"
            provider={provider}
            className="size-3.5 shrink-0 text-subtle-foreground"
          />
          {details === null ? (
            <span
              role="status"
              aria-label="Loading model"
              className="inline-block h-3 w-20 shrink-0 rounded-sm bg-muted"
            />
          ) : details.model ? (
            <>
              <span className="min-w-0 truncate">{details.model}</span>
              {details.reasoning ? (
                <span className="shrink-0 text-subtle-foreground">
                  {details.reasoning}
                </span>
              ) : null}
            </>
          ) : (
            <span className="text-subtle-foreground">
              {providerName ?? "Unknown model"}
            </span>
          )}
        </span>
        {thread.environmentBranchName || worktree ? (
          <span className="flex min-h-4 min-w-0 items-center gap-1.5">
            <Icon
              name="GitBranch"
              className="size-3.5 shrink-0 text-subtle-foreground"
              aria-hidden
            />
            <span className="min-w-0 truncate">
              {thread.environmentBranchName}
            </span>
            {worktree && worktree !== thread.environmentBranchName ? (
              <span className="shrink-0 text-subtle-foreground">
                {worktree}
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function ThreadHoverCard({
  thread,
  suppressed,
  children,
}: {
  thread: SidebarThread;
  suppressed: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [wanted, setWanted] = useState(false);
  const visible = open && !suppressed;
  const details = useThreadHoverDetails(thread, visible);
  return (
    <HoverCard
      open={visible}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setWanted(true);
      }}
      openDelay={400}
      closeDelay={60}
    >
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={12}
        className="w-72 p-0"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {wanted ? (
          <ThreadHoverCardBody thread={thread} details={details} />
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}
