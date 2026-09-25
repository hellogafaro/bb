import type { QueryClientArg } from "../cache-effect-types";
import { globalSearchQueryKeyPrefix } from "../queries/global-search-query-key";

export function invalidateActiveGlobalSearch({
  queryClient,
}: QueryClientArg): void {
  void queryClient.invalidateQueries({
    queryKey: globalSearchQueryKeyPrefix(),
    refetchType: "active",
  });
}
