import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { McpToolPolicy } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  applyMcpProviderStatus,
  applyMcpToolPolicy,
  invalidateMcpServerMutationQueries,
  invalidateMcpServerRuntimeQueries,
} from "../cache-owners/mcp-cache-owner";

interface McpServerRequest {
  serverId: string;
}

export function useSetMcpServerEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to update MCP." },
    mutationFn: ({
      serverId,
      enabled,
    }: McpServerRequest & { enabled: boolean }) =>
      sdk.mcp.setEnabled({ server: serverId, enabled }),
    onSettled: (_result, _error, { serverId }) => {
      invalidateMcpServerRuntimeQueries({ queryClient, serverId });
    },
  });
}

export function useSetMcpServerGuide() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to save the agent guide." },
    mutationFn: ({
      serverId,
      guide,
    }: McpServerRequest & { guide: string | null }) =>
      sdk.mcp.setGuide({ server: serverId, guide }),
    onSuccess: (_result, { serverId }) => {
      invalidateMcpServerMutationQueries({ queryClient, serverId });
    },
  });
}

export function useSetMcpServerHeaders() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to save headers." },
    mutationFn: ({
      serverId,
      headers,
    }: McpServerRequest & { headers: Record<string, string> }) =>
      sdk.mcp.setHeaders({ server: serverId, headers }),
    onSuccess: (_result, { serverId }) => {
      invalidateMcpServerRuntimeQueries({ queryClient, serverId });
    },
  });
}

export function useRemoveMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to remove MCP." },
    mutationFn: ({ serverId }: McpServerRequest) =>
      sdk.mcp.remove({ server: serverId }),
    onSuccess: (_result, { serverId }) => {
      invalidateMcpServerMutationQueries({ queryClient, serverId });
    },
  });
}

export function useAuthenticateMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to start MCP sign-in." },
    mutationFn: ({ serverId }: McpServerRequest) =>
      sdk.mcp.authenticate({ server: serverId }),
    onSettled: (_result, _error, { serverId }) => {
      invalidateMcpServerMutationQueries({ queryClient, serverId });
    },
  });
}

export function useReconnectMcpServer() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to reconnect MCP." },
    mutationFn: ({ serverId }: McpServerRequest) =>
      sdk.mcp.reconnect({ server: serverId }),
    onSettled: (_result, _error, { serverId }) => {
      invalidateMcpServerRuntimeQueries({ queryClient, serverId });
    },
  });
}

export function useSetMcpToolPolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { errorMessage: "Failed to update tool policy." },
    mutationFn: ({
      serverId,
      tool,
      mode,
    }: McpServerRequest & { tool: string; mode: McpToolPolicy["mode"] }) =>
      sdk.mcp.setPolicy({ server: serverId, tool, mode }),
    onSuccess: (policy, { serverId }) => {
      applyMcpToolPolicy({ queryClient, serverId, policy });
    },
  });
}

export function useFixMcpProviders() {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: ({ hostId }: { hostId: string }) =>
      sdk.mcp.fixProviders({ hostId }),
    onSuccess: (status) => {
      applyMcpProviderStatus({ queryClient, status });
    },
  });
}
