import { defineRpcContract } from "@get-bb/plugin-sdk";
import type { ExperimentalHostSignals } from "@get-bb/plugin-sdk/host";
import { z } from "zod";

const jsonRecordSchema = z.record(z.string(), z.unknown());

const catalogSchema = z.object({
  tools: z.array(jsonRecordSchema),
  prompts: z.array(jsonRecordSchema),
  resources: z.array(jsonRecordSchema),
  resourceTemplates: z.array(jsonRecordSchema),
}).strict();

const sourceIdSchema = z.string().min(1).max(128);

const stdioConfigSchema = z.object({
  id: sourceIdSchema,
  command: z.string().min(1).max(16_384),
  args: z.array(z.string().max(16_384)).max(256),
  cwd: z.string().min(1).max(16_384),
  env: z.record(z.string(), z.string().max(16_384)),
}).strict();

const operationSchema = z.object({ id: sourceIdSchema }).strict();

const providerMcpEntrySchema = z.object({ name: z.string(), file: z.string(), scope: z.string() }).strict();

export const providerMcpStatusSchema = z.object({
  claude: z.object({
    settingsPath: z.string(),
    connectorsDisabled: z.boolean(),
    mcpServers: z.array(providerMcpEntrySchema),
  }).strict(),
  codex: z.object({
    configPath: z.string(),
    mcpServers: z.array(providerMcpEntrySchema),
  }).strict(),
}).strict();

export const mcpHostContract = defineRpcContract({
  start: {
    input: stdioConfigSchema,
    output: catalogSchema,
  },
  refresh: {
    input: operationSchema,
    output: catalogSchema,
  },
  close: {
    input: operationSchema,
    output: z.object({ closed: z.boolean() }).strict(),
  },
  callTool: {
    input: z.object({
      id: sourceIdSchema,
      name: z.string().min(1).max(512),
      args: jsonRecordSchema,
      toolDefinition: jsonRecordSchema.optional(),
    }).strict(),
    output: jsonRecordSchema,
  },
  getPrompt: {
    input: z.object({ id: sourceIdSchema, name: z.string().min(1).max(512), args: jsonRecordSchema }).strict(),
    output: jsonRecordSchema,
  },
  readResource: {
    input: z.object({ id: sourceIdSchema, uri: z.string().min(1).max(16_384) }).strict(),
    output: jsonRecordSchema,
  },
  providerMcpStatus: {
    input: z.object({ projectPath: z.string().min(1).max(16_384).optional() }).strict(),
    output: providerMcpStatusSchema,
  },
  providerMcpFix: {
    input: z.object({ projectPath: z.string().min(1).max(16_384).optional() }).strict(),
    output: providerMcpStatusSchema,
  },
});

export const mcpHostSignals = {
  catalogChanged: {
    payload: z.object({
      id: sourceIdSchema,
      kind: z.enum(["tools", "prompts", "resources"]),
      error: z.string().nullable(),
    }).strict(),
  },
  connectionChanged: {
    payload: z.object({
      id: sourceIdSchema,
      status: z.enum(["closed", "error"]),
      error: z.string().nullable(),
    }).strict(),
  },
} satisfies ExperimentalHostSignals;

export type McpHostCatalog = {
  tools: Array<Record<string, unknown>>;
  prompts: Array<Record<string, unknown>>;
  resources: Array<Record<string, unknown>>;
  resourceTemplates: Array<Record<string, unknown>>;
};
