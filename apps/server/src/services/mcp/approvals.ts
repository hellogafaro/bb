import { AsyncLocalStorage } from "node:async_hooks";
import type { ElicitRequest, ElicitResult } from "@modelcontextprotocol/client";
import {
  mcpApprovalResolutionSchema,
  mcpElicitationResolutionSchema,
  type CorePendingInteractionPayload,
} from "@bb/domain";
import type {
  PendingInteractionLifecycle,
  PluginInteractionResult,
} from "../interactions/pending-interactions.js";
import { detachActivePluginToolCallForUserInput } from "../plugins/plugin-tool-calls.js";
import { elicitationFields, validElicitationContent } from "./elicitation.js";
import type { CallScope, JsonRecord, ToolRisk } from "./types.js";

export const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const ARGS_PREVIEW_CHARS = 4_000;
const ROW_LABEL_MAX = 80;

interface ApprovalLogger {
  info(message: string): void;
  warn(message: string): void;
}

type InteractionRequester = Pick<
  PendingInteractionLifecycle,
  "requestCoreInteraction"
>;

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class McpApprovals {
  private readonly scope = new AsyncLocalStorage<
    CallScope & { sourceId: string }
  >();
  private readonly active = new Map<string, CallScope[]>();

  constructor(
    private readonly interactions: InteractionRequester,
    private readonly log: ApprovalLogger,
    private readonly timeoutMs = APPROVAL_TIMEOUT_MS,
  ) {}

  async runCall<T>(
    sourceId: string,
    scope: CallScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    const list = this.active.get(sourceId) ?? [];
    list.push(scope);
    this.active.set(sourceId, list);
    try {
      return await this.scope.run({ ...scope, sourceId }, operation);
    } finally {
      const index = list.indexOf(scope);
      if (index >= 0) list.splice(index, 1);
      if (list.length === 0) this.active.delete(sourceId);
    }
  }

  private async ask(
    threadId: string,
    payload: CorePendingInteractionPayload,
    signal: AbortSignal | undefined,
  ): Promise<PluginInteractionResult> {
    const pending = this.interactions.requestCoreInteraction({
      threadId,
      payload,
      timeoutMs: this.timeoutMs,
      ...(signal ? { signal } : {}),
    });
    if (!signal?.aborted) detachActivePluginToolCallForUserInput();
    return pending;
  }

  async confirmTool(input: {
    scope: CallScope;
    server: string;
    tool: string;
    risk: ToolRisk;
    args: JsonRecord;
  }): Promise<string | null> {
    const label = `${input.server}/${input.tool}`;
    const threadId = input.scope.threadId;
    if (!threadId) {
      return `${label} requires user approval (policy: confirm) and can only run from a BB thread, where the approval is shown; the tool was not run.`;
    }
    const json = JSON.stringify(input.args, null, 2) ?? "{}";
    const truncated = json.length > ARGS_PREVIEW_CHARS;
    let result: PluginInteractionResult;
    try {
      result = await this.ask(
        threadId,
        {
          kind: "mcp_approval",
          title: clamp(`Run ${label}?`, ROW_LABEL_MAX),
          server: input.server,
          tool: input.tool,
          risk: input.risk,
          args: truncated ? json.slice(0, ARGS_PREVIEW_CHARS) : json,
          truncated,
        },
        input.scope.signal,
      );
    } catch (error) {
      return `Could not ask for approval of ${label}: ${errorText(error)}`;
    }
    if (result.outcome === "cancelled") {
      return result.reason === "timeout"
        ? `Approval for ${label} timed out; the tool was not run.`
        : `Approval for ${label} was cancelled (${result.reason}); the tool was not run.`;
    }
    const parsed = mcpApprovalResolutionSchema.safeParse(result.value);
    if (!parsed.success || !parsed.data.allowed)
      return `The user denied ${label}; the tool was not run.`;
    this.log.info(`[mcp] allowed ${label} in thread ${threadId}`);
    return null;
  }

  private scopeFor(sourceId: string): CallScope | null {
    const current = this.scope.getStore();
    if (current?.sourceId === sourceId && current.threadId) return current;
    const candidates = (this.active.get(sourceId) ?? []).filter(
      (scope) => scope.threadId,
    );
    const threads = new Set(candidates.map((scope) => scope.threadId));
    return threads.size === 1
      ? (candidates[candidates.length - 1] ?? null)
      : null;
  }

  async elicit(
    request: ElicitRequest,
    sourceId: string,
    server: string,
  ): Promise<ElicitResult> {
    const params = request.params;
    const message = params.message.trim() ? params.message : null;
    if (!message || (params.mode !== undefined && params.mode !== "form"))
      return { action: "decline" };
    const fields = elicitationFields(
      "requestedSchema" in params ? params.requestedSchema : undefined,
    );
    const scope = this.scopeFor(sourceId);
    if (!fields || !scope?.threadId) {
      this.log.info(
        `[mcp] declined elicitation from ${server}: ${fields ? "no thread to ask in" : "unsupported form"}`,
      );
      return { action: "decline" };
    }
    let result: PluginInteractionResult;
    try {
      result = await this.ask(
        scope.threadId,
        {
          kind: "mcp_elicitation",
          title: clamp(`${server} asks: ${message}`, ROW_LABEL_MAX),
          server,
          message,
          fields,
        },
        scope.signal,
      );
    } catch (error) {
      this.log.warn(
        `[mcp] elicitation from ${server} could not be shown: ${errorText(error)}`,
      );
      return { action: "decline" };
    }
    if (result.outcome === "cancelled")
      return result.reason === "user"
        ? { action: "cancel" }
        : { action: "decline" };
    const parsed = mcpElicitationResolutionSchema.safeParse(result.value);
    if (!parsed.success || parsed.data.action === "decline")
      return { action: "decline" };
    const content = validElicitationContent(fields, parsed.data.content);
    return content ? { action: "accept", content } : { action: "decline" };
  }
}
