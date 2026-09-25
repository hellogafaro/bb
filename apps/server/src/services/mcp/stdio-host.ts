import {
  specTypeSchemas,
  type Prompt,
  type Resource,
  type ResourceTemplateType,
  type StandardSchemaV1Sync,
  type Tool,
} from "@modelcontextprotocol/client";
import type { McpStdioCatalog as HostCatalog } from "@bb/host-daemon-contract";
import type { McpStdioCatalog, McpStdioHost } from "./gateway-stdio.js";

const START_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 70_000;
const CLOSE_TIMEOUT_MS = 5_000;

export interface McpHostCommands {
  hostId(): string;
  start(
    hostId: string,
    command: {
      id: string;
      command: string;
      args: string[];
      cwd: string;
      env: Record<string, string>;
    },
    timeoutMs: number,
  ): Promise<HostCatalog>;
  refresh(hostId: string, id: string, timeoutMs: number): Promise<HostCatalog>;
  close(hostId: string, id: string, timeoutMs: number): Promise<void>;
  callTool(
    hostId: string,
    input: {
      id: string;
      name: string;
      args: Record<string, unknown>;
      toolDefinition: Record<string, unknown> | null;
    },
    timeoutMs: number,
  ): Promise<Record<string, unknown>>;
  getPrompt(
    hostId: string,
    input: { id: string; name: string; args: Record<string, string> },
    timeoutMs: number,
  ): Promise<Record<string, unknown>>;
  readResource(
    hostId: string,
    input: { id: string; uri: string },
    timeoutMs: number,
  ): Promise<Record<string, unknown>>;
}

function validItems<Input, Output>(
  schema: StandardSchemaV1Sync<Input, Output>,
  values: readonly unknown[],
): Output[] {
  const items: Output[] = [];
  for (const value of values) {
    const result = schema["~standard"].validate(value);
    if (!result.issues) items.push(result.value);
  }
  return items;
}

export function parseHostCatalog(catalog: HostCatalog): McpStdioCatalog {
  return {
    tools: validItems<unknown, Tool>(specTypeSchemas.Tool, catalog.tools),
    prompts: validItems<unknown, Prompt>(
      specTypeSchemas.Prompt,
      catalog.prompts,
    ),
    resources: validItems<unknown, Resource>(
      specTypeSchemas.Resource,
      catalog.resources,
    ),
    resourceTemplates: validItems<unknown, ResourceTemplateType>(
      specTypeSchemas.ResourceTemplate,
      catalog.resourceTemplates,
    ),
  };
}

export function daemonStdioHost(commands: McpHostCommands): McpStdioHost {
  const hosts = new Map<string, string>();
  const hostFor = (id: string): string => {
    const hostId = hosts.get(id);
    if (!hostId) throw new Error(`MCP stdio connection not found: ${id}`);
    return hostId;
  };
  return {
    async start(config) {
      const hostId = commands.hostId();
      hosts.set(config.id, hostId);
      return parseHostCatalog(
        await commands.start(hostId, config, START_TIMEOUT_MS),
      );
    },
    async refresh(id) {
      return parseHostCatalog(
        await commands.refresh(hostFor(id), id, REQUEST_TIMEOUT_MS),
      );
    },
    async close(id) {
      const hostId = hosts.get(id);
      hosts.delete(id);
      if (hostId) await commands.close(hostId, id, CLOSE_TIMEOUT_MS);
    },
    callTool(id, name, args, toolDefinition) {
      return commands.callTool(
        hostFor(id),
        {
          id,
          name,
          args,
          toolDefinition: toolDefinition ? { ...toolDefinition } : null,
        },
        REQUEST_TIMEOUT_MS,
      );
    },
    getPrompt(id, name, args) {
      return commands.getPrompt(
        hostFor(id),
        { id, name, args },
        REQUEST_TIMEOUT_MS,
      );
    },
    readResource(id, uri) {
      return commands.readResource(
        hostFor(id),
        { id, uri },
        REQUEST_TIMEOUT_MS,
      );
    },
  };
}
