import { useQuery } from "@tanstack/react-query";
import type { McpServer } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  mcpProviderStatusQueryKey,
  mcpServerQueryKey,
  mcpServersQueryKey,
  mcpServerToolsQueryKey,
  mcpToolPoliciesQueryKey,
} from "@/hooks/queries/query-keys";

export type McpServerListRow = Pick<
  McpServer,
  | "id"
  | "handle"
  | "name"
  | "description"
  | "type"
  | "enabled"
  | "authStatus"
  | "lastError"
  | "sourceRef"
  | "registryName"
  | "toolCount"
>;

const PROVIDER_STATUS_STALE_TIME_MS = 60_000;

function toMcpServerListRows(servers: McpServer[]): McpServerListRow[] {
  return servers.map((server) => ({
    id: server.id,
    handle: server.handle,
    name: server.name,
    description: server.description,
    type: server.type,
    enabled: server.enabled,
    authStatus: server.authStatus,
    lastError: server.lastError,
    sourceRef: server.sourceRef,
    registryName: server.registryName,
    toolCount: server.toolCount,
  }));
}

export function useMcpServers() {
  return useQuery({
    queryKey: mcpServersQueryKey(),
    queryFn: ({ signal }) => sdk.mcp.list({ details: true, signal }),
    select: toMcpServerListRows,
  });
}

export function useMcpServer(ref: string) {
  return useQuery({
    queryKey: mcpServerQueryKey(ref),
    queryFn: ({ signal }) => sdk.mcp.get({ server: ref, signal }),
    retry: false,
  });
}

export function useMcpServerTools(serverId: string) {
  return useQuery({
    queryKey: mcpServerToolsQueryKey(serverId),
    queryFn: ({ signal }) => sdk.mcp.serverTools({ server: serverId, signal }),
  });
}

export function useMcpToolPolicies(serverId: string) {
  return useQuery({
    queryKey: mcpToolPoliciesQueryKey(serverId),
    queryFn: ({ signal }) => sdk.mcp.listPolicies({ server: serverId, signal }),
  });
}

export function useMcpProviderStatus() {
  return useQuery({
    queryKey: mcpProviderStatusQueryKey(),
    queryFn: ({ signal }) => sdk.mcp.providerStatus({ signal }),
    staleTime: PROVIDER_STATUS_STALE_TIME_MS,
    retry: false,
  });
}
