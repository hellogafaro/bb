import type { QueryClient } from "@tanstack/react-query";
import {
  inboxInteractionsQueryKey,
  inboxSummariesQueryKeyPrefix,
} from "@/hooks/queries/query-keys";

export function invalidateInbox({
  queryClient,
}: {
  queryClient: QueryClient;
}): void {
  void queryClient.invalidateQueries({ queryKey: inboxInteractionsQueryKey() });
  void queryClient.invalidateQueries({
    queryKey: inboxSummariesQueryKeyPrefix(),
  });
}
