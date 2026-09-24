import { AsyncLocalStorage } from "node:async_hooks";
import type { PluginUi } from "@get-bb/plugin-sdk";
import {
  APPROVAL_RENDERER_ID,
  elicitationResponseSchema,
  toolApprovalResponseSchema,
  type ElicitationField,
} from "./approval-contract.js";
import type { JsonRecord, ToolRisk } from "./types.js";

export const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const ARGS_PREVIEW_CHARS = 4_000;
const ROW_LABEL_MAX = 80;

export interface CallScope {
  threadId: string | null;
  signal?: AbortSignal;
}

export type ElicitResult =
  | { action: "accept"; content: Record<string, string | number | boolean> }
  | { action: "decline" }
  | { action: "cancel" };

type Logger = { info(message: string): void; warn(message: string): void };

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function elicitationFields(requestedSchema: unknown): ElicitationField[] | null {
  if (!isRecord(requestedSchema) || !isRecord(requestedSchema.properties)) return null;
  const required = new Set(Array.isArray(requestedSchema.required) ? requestedSchema.required.filter((item): item is string => typeof item === "string") : []);
  const fields: ElicitationField[] = [];
  for (const [name, raw] of Object.entries(requestedSchema.properties)) {
    if (!isRecord(raw)) return null;
    const type = raw.type;
    if (type !== "string" && type !== "number" && type !== "integer" && type !== "boolean") {
      if (required.has(name)) return null;
      continue;
    }
    let options: ElicitationField["options"] = null;
    if (Array.isArray(raw.enum)) {
      const names = Array.isArray(raw.enumNames) ? raw.enumNames : [];
      options = raw.enum.filter((item): item is string => typeof item === "string")
        .map((value, index) => ({ value, label: typeof names[index] === "string" ? names[index] : value }));
    } else if (Array.isArray(raw.oneOf)) {
      options = raw.oneOf.filter(isRecord).filter((item) => typeof item.const === "string")
        .map((item) => ({ value: item.const as string, label: optionalText(item.title) ?? (item.const as string) }));
    }
    const fallback = raw.default;
    fields.push({
      name,
      title: optionalText(raw.title),
      description: optionalText(raw.description),
      type,
      options,
      required: required.has(name),
      defaultValue: typeof fallback === "string" || typeof fallback === "number" || typeof fallback === "boolean" ? fallback : null,
    });
  }
  return fields;
}

export function validElicitationContent(fields: ElicitationField[], content: Record<string, unknown>): Record<string, string | number | boolean> | null {
  const result: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const value = content[field.name];
    if (value === undefined || value === "") {
      if (field.required) return null;
      continue;
    }
    if (field.type === "boolean" && typeof value !== "boolean") return null;
    if ((field.type === "number" || field.type === "integer") && (typeof value !== "number" || !Number.isFinite(value))) return null;
    if (field.type === "integer" && !Number.isInteger(value)) return null;
    if (field.type === "string" && typeof value !== "string") return null;
    if (field.options && !field.options.some((option) => option.value === value)) return null;
    result[field.name] = value as string | number | boolean;
  }
  return result;
}

export class McpApprovals {
  private readonly scope = new AsyncLocalStorage<CallScope & { serverKey: string }>();
  private readonly active = new Map<string, Array<CallScope>>();

  constructor(
    private readonly ui: PluginUi,
    private readonly log: Logger,
    private readonly timeoutMs = APPROVAL_TIMEOUT_MS,
  ) {}

  async runCall<T>(serverKey: string, scope: CallScope, operation: () => Promise<T>): Promise<T> {
    const list = this.active.get(serverKey) ?? [];
    list.push(scope);
    this.active.set(serverKey, list);
    try { return await this.scope.run({ ...scope, serverKey }, operation); }
    finally {
      const index = list.indexOf(scope);
      if (index >= 0) list.splice(index, 1);
      if (list.length === 0) this.active.delete(serverKey);
    }
  }

  async confirmTool(input: { scope: CallScope; server: string; tool: string; risk: ToolRisk; args: JsonRecord }): Promise<string | null> {
    const label = `${input.server}/${input.tool}`;
    if (!input.scope.threadId) {
      return `${label} requires user approval (policy: confirm) and can only run from a BB thread, where the approval is shown; the tool was not run.`;
    }
    const json = JSON.stringify(input.args, null, 2) ?? "{}";
    const truncated = json.length > ARGS_PREVIEW_CHARS;
    let result;
    try {
      result = await this.ui.requestInput({
        threadId: input.scope.threadId,
        rendererId: APPROVAL_RENDERER_ID,
        title: clamp(`Run ${label}?`, ROW_LABEL_MAX),
        payload: { kind: "tool", server: input.server, tool: input.tool, risk: input.risk, args: truncated ? json.slice(0, ARGS_PREVIEW_CHARS) : json, truncated },
        timeoutMs: this.timeoutMs,
        presentation: {
          label: {
            pending: clamp(`Waiting for approval of ${label}`, ROW_LABEL_MAX),
            completed: clamp(`Answered ${label}`, ROW_LABEL_MAX),
          },
        },
        describeSubmission: (value) => {
          const parsed = toolApprovalResponseSchema.safeParse(value);
          return { title: clamp(`${parsed.success && parsed.data.approved ? "Approved" : "Denied"} ${label}`, ROW_LABEL_MAX) };
        },
      }, input.scope.signal ? { signal: input.scope.signal } : undefined);
    } catch (error) {
      return `Could not ask for approval of ${label}: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (result.outcome === "cancelled") {
      return result.reason === "timeout"
        ? `Approval for ${label} timed out; the tool was not run.`
        : `Approval for ${label} was cancelled (${result.reason}); the tool was not run.`;
    }
    const parsed = toolApprovalResponseSchema.safeParse(result.value);
    if (!parsed.success || !parsed.data.approved) return `The user denied ${label}; the tool was not run.`;
    this.log.info(`[mcps] approved ${label} in thread ${input.scope.threadId}`);
    return null;
  }

  private scopeFor(serverKey: string): CallScope | null {
    const current = this.scope.getStore();
    if (current?.serverKey === serverKey && current.threadId) return current;
    const candidates = (this.active.get(serverKey) ?? []).filter((scope) => scope.threadId);
    const threads = new Set(candidates.map((scope) => scope.threadId));
    return threads.size === 1 ? candidates[candidates.length - 1]! : null;
  }

  async elicit(request: unknown, serverKey: string, server: string): Promise<ElicitResult> {
    const params = isRecord(request) && isRecord(request.params) ? request.params : null;
    const message = optionalText(params?.message);
    if (!params || !message || (params.mode !== undefined && params.mode !== "form")) return { action: "decline" };
    const fields = elicitationFields(params.requestedSchema);
    const scope = this.scopeFor(serverKey);
    if (!fields || !scope?.threadId) {
      this.log.info(`[mcps] declined elicitation from ${server}: ${fields ? "no thread to ask in" : "unsupported form"}`);
      return { action: "decline" };
    }
    let result;
    try {
      result = await this.ui.requestInput({
        threadId: scope.threadId,
        rendererId: APPROVAL_RENDERER_ID,
        title: clamp(`${server} asks: ${message}`, ROW_LABEL_MAX),
        payload: { kind: "elicitation", server, message, fields },
        timeoutMs: this.timeoutMs,
        presentation: {
          label: {
            pending: clamp(`Waiting for your answer to ${server}`, ROW_LABEL_MAX),
            completed: clamp(`Answered ${server}`, ROW_LABEL_MAX),
          },
        },
        describeSubmission: (value) => {
          const parsed = elicitationResponseSchema.safeParse(value);
          return { title: clamp(`${parsed.success && parsed.data.action === "accept" ? "Answered" : "Declined"} ${server}`, ROW_LABEL_MAX) };
        },
      }, scope.signal ? { signal: scope.signal } : undefined);
    } catch (error) {
      this.log.warn(`[mcps] elicitation from ${server} could not be shown: ${error instanceof Error ? error.message : String(error)}`);
      return { action: "decline" };
    }
    if (result.outcome === "cancelled") return result.reason === "user" ? { action: "cancel" } : { action: "decline" };
    const parsed = elicitationResponseSchema.safeParse(result.value);
    if (!parsed.success || parsed.data.action === "decline") return { action: "decline" };
    const content = validElicitationContent(fields, parsed.data.content);
    return content ? { action: "accept", content } : { action: "decline" };
  }
}
