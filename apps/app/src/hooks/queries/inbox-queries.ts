import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import {
  INBOX_SUMMARY_REQUEST_MAX_THREADS,
  type InboxSummary,
  type PendingInteraction,
} from "@bb/domain";
import { invalidateInbox } from "@/hooks/cache-owners/inbox-cache-owner";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { sdk } from "@/lib/sdk";
import {
  inboxInteractionsQueryKey,
  inboxSummariesQueryKey,
} from "./query-keys";
import { useSidebarNavigation } from "./sidebar-navigation-query";

const INBOX_REFETCH_INTERVAL_MS = 30_000;

export function useInboxInteractions() {
  const queryClient = useQueryClient();
  const navigation = useSidebarNavigation();
  const pendingThreadIds = useMemo(
    () =>
      navigation.data === undefined
        ? ""
        : listSidebarNavigationThreads(navigation.data)
            .filter((thread) => thread.hasPendingInteraction)
            .map((thread) => thread.id)
            .sort()
            .join(","),
    [navigation.data],
  );
  useEffect(() => {
    invalidateInbox({ queryClient });
  }, [pendingThreadIds, queryClient]);
  return useQuery<PendingInteraction[]>({
    queryKey: inboxInteractionsQueryKey(),
    queryFn: ({ signal }) => sdk.interactions.list({ signal }),
    refetchInterval: INBOX_REFETCH_INTERVAL_MS,
  });
}

export function useThreadOutput(threadId: string, version: number) {
  return useQuery({
    queryKey: ["threadOutput", threadId, version] as const,
    queryFn: ({ signal }) => sdk.threads.output({ threadId, signal }),
    placeholderData: (previous) => previous,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

const INBOX_SUMMARIES_PENDING_POLL_MS = 4_000;
const INBOX_SUMMARIES_IDLE_POLL_MS = 60_000;

export interface InboxSummariesState {
  byThread: Map<string, InboxSummary>;
  pending: Set<string>;
}

export function useInboxSummaries(threadIds: readonly string[]) {
  const key = useMemo(
    () => threadIds.slice(0, INBOX_SUMMARY_REQUEST_MAX_THREADS).sort(),
    [threadIds],
  );
  return useQuery<InboxSummariesState>({
    queryKey: inboxSummariesQueryKey(key),
    enabled: key.length > 0,
    queryFn: async ({ signal }) => {
      const result = await sdk.inbox.summaries({ threadIds: key, signal });
      return {
        byThread: new Map(
          result.summaries.map((summary) => [summary.threadId, summary]),
        ),
        pending: new Set(result.pending),
      };
    },
    placeholderData: (previous) => previous,
    refetchInterval: (query) =>
      (query.state.data?.pending.size ?? 0) > 0
        ? INBOX_SUMMARIES_PENDING_POLL_MS
        : INBOX_SUMMARIES_IDLE_POLL_MS,
  });
}
