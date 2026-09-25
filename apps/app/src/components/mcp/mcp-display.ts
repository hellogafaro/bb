import type { McpServer } from "@bb/server-contract";

type McpServerType = McpServer["type"];

export function mcpTypeLabel(type: McpServerType): string {
  if (type === "stdio") return "Command";
  if (type === "sse") return "SSE";
  return "HTTP";
}

export function mcpTypeIcon(type: McpServerType): "Terminal" | "Globe" {
  return type === "stdio" ? "Terminal" : "Globe";
}

export function mcpNeedsSignIn(authStatus: McpServer["authStatus"]): boolean {
  return authStatus === "unauthenticated" || authStatus === "authorizing";
}
