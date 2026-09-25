import type { QueryKey } from "@tanstack/react-query";
import type { McpChangeKind } from "@bb/domain";
import type {
  McpProviderStatusResponse,
  McpServer,
  McpToolPolicy,
} from "@bb/server-contract";
import type { QueryClientArg } from "../cache-effect-types";
import {
  allMcpServerQueryKeyPrefix,
  allMcpServerToolsQueryKeyPrefix,
  allMcpToolPoliciesQueryKeyPrefix,
  mcpProviderStatusQueryKey,
  mcpServerQueryKey,
  mcpServersQueryKey,
  mcpServerToolsQueryKey,
  mcpToolPoliciesQueryKey,
} from "../queries/query-keys";
import { invalidateQueryKeys } from "./cache-effect-utils";

interface McpServerArg extends QueryClientArg {
  serverId: string;
}

interface McpRealtimeChangeArg extends QueryClientArg {
  serverId: string | undefined;
  changes: readonly McpChangeKind[];
}

function cachedMcpServerQueryKeys({
  queryClient,
  serverId,
}: McpServerArg): QueryKey[] {
  const keys: QueryKey[] = [mcpServerQueryKey(serverId)];
  for (const [queryKey, server] of queryClient.getQueriesData<McpServer>({
    queryKey: allMcpServerQueryKeyPrefix(),
  })) {
    if (server?.id === serverId && queryKey[1] !== serverId) {
      keys.push(queryKey);
    }
  }
  return keys;
}

export function invalidateMcpRealtimeChange({
  queryClient,
  serverId,
  changes,
}: McpRealtimeChangeArg): void {
  const kinds = new Set(changes);
  const queryKeys: QueryKey[] = [];
  if (kinds.has("servers-changed") || kinds.has("runtime-changed")) {
    queryKeys.push(mcpServersQueryKey());
    if (serverId === undefined) {
      queryKeys.push(
        allMcpServerQueryKeyPrefix(),
        allMcpServerToolsQueryKeyPrefix(),
        allMcpToolPoliciesQueryKeyPrefix(),
      );
    } else {
      queryKeys.push(
        ...cachedMcpServerQueryKeys({ queryClient, serverId }),
        mcpServerToolsQueryKey(serverId),
        mcpToolPoliciesQueryKey(serverId),
      );
    }
  } else if (kinds.has("policies-changed")) {
    queryKeys.push(
      serverId === undefined
        ? allMcpToolPoliciesQueryKeyPrefix()
        : mcpToolPoliciesQueryKey(serverId),
    );
  }
  invalidateQueryKeys({ queryClient, queryKeys });
}

export function invalidateMcpServerMutationQueries({
  queryClient,
  serverId,
}: McpServerArg): void {
  invalidateQueryKeys({
    queryClient,
    queryKeys: [
      mcpServersQueryKey(),
      ...cachedMcpServerQueryKeys({ queryClient, serverId }),
    ],
  });
}

export function invalidateMcpServerRuntimeQueries({
  queryClient,
  serverId,
}: McpServerArg): void {
  invalidateMcpRealtimeChange({
    queryClient,
    serverId,
    changes: ["runtime-changed"],
  });
}

export function applyMcpToolPolicy({
  queryClient,
  serverId,
  policy,
}: McpServerArg & { policy: McpToolPolicy }): void {
  queryClient.setQueryData<McpToolPolicy[]>(
    mcpToolPoliciesQueryKey(serverId),
    (current) =>
      current?.some((row) => row.tool === policy.tool)
        ? current.map((row) => (row.tool === policy.tool ? policy : row))
        : [...(current ?? []), policy],
  );
}

export function applyMcpProviderStatus({
  queryClient,
  status,
}: QueryClientArg & { status: McpProviderStatusResponse }): void {
  queryClient.setQueryData(mcpProviderStatusQueryKey(), status);
}
