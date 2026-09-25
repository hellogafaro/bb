import type { McpService } from "./service.js";

let current: McpService | null = null;

export function setMcpService(service: McpService): void {
  current = service;
}

export function clearMcpService(service: McpService): void {
  if (current === service) current = null;
}

export function currentMcpService(): McpService | null {
  return current;
}
