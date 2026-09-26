import {
  getThread,
  listInboxSummaries,
  listInboxSummaryTargets,
  upsertInboxSummary,
} from "@bb/db";
import { formatPendingInteractionSummary } from "@bb/core-ui";
import type { InboxSummary } from "@bb/domain";
import { renderTemplate } from "@bb/templates";
import { Type } from "@earendil-works/pi-ai";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import {
  INFERENCE_POLICY,
  inferenceCompleteWithRetry,
} from "../ai/inference.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { listThreadPromptHistory } from "../prompt-history.js";
import {
  getLastThreadErrorMessage,
  getLastThreadOutput,
} from "../threads/thread-data.js";

const MAX_REQUEST_CHARS = 1_200;
const MAX_OUTPUT_CHARS = 2_400;
const MAX_ERROR_CHARS = 600;
const MAX_FIELD_CHARS = 240;
const PROMPT_HISTORY_LIMIT = 8;
const CONCURRENCY = 2;

type InboxSummaryDeps = LoggedWorkSessionDeps &
  Pick<AppDeps, "pendingInteractions">;

export interface InboxSummariesResult {
  summaries: InboxSummary[];
  pending: string[];
}

const inboxSummarySchema = Type.Object({
  goal: Type.String(),
  state: Type.String(),
  needs: Type.String(),
});

function clampText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/gu, " ").trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 1).trimEnd()}…`;
}

function clampField(value: string): string {
  return clampText(value, MAX_FIELD_CHARS);
}

function promptText(input: readonly { type: string; text?: string }[]): string {
  return input
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join(" ");
}

export class InboxSummaryService {
  private readonly queue: string[] = [];
  private readonly inFlight = new Set<string>();
  private active = 0;

  constructor(private readonly deps: InboxSummaryDeps) {}

  get isEnabled(): boolean {
    return this.deps.config.openRouterApiKey.length > 0;
  }

  request(threadIds: readonly string[]): InboxSummariesResult {
    const targets = listInboxSummaryTargets(this.deps.db, threadIds);
    const summaries = listInboxSummaries(
      this.deps.db,
      targets.map((target) => target.threadId),
    );
    const byThread = new Map(
      summaries.map((summary) => [summary.threadId, summary]),
    );
    const pending: string[] = [];
    if (!this.isEnabled) {
      return { summaries, pending };
    }
    for (const target of targets) {
      const existing = byThread.get(target.threadId);
      if (existing && existing.sourceVersion >= target.latestAttentionAt) {
        continue;
      }
      pending.push(target.threadId);
      this.enqueue(target.threadId);
    }
    return { summaries, pending };
  }

  private enqueue(threadId: string): void {
    if (this.inFlight.has(threadId)) return;
    this.inFlight.add(threadId);
    this.queue.push(threadId);
    this.drain();
  }

  private drain(): void {
    while (this.active < CONCURRENCY) {
      const threadId = this.queue.shift();
      if (threadId === undefined) return;
      this.active += 1;
      void this.generate(threadId)
        .catch((error: unknown) => {
          this.deps.logger.warn(
            { threadId, ...runtimeErrorLogFields(this.deps.config, error) },
            "Inbox summary generation failed",
          );
        })
        .finally(() => {
          this.active -= 1;
          this.inFlight.delete(threadId);
          this.drain();
        });
    }
  }

  private async generate(threadId: string): Promise<void> {
    const thread = getThread(this.deps.db, threadId);
    if (thread === null) return;
    const sourceVersion = thread.latestAttentionAt;
    const history = listThreadPromptHistory(this.deps, {
      threadId,
      limit: PROMPT_HISTORY_LIMIT,
    });
    const requests = history
      .map((entry) => clampText(promptText(entry.input), MAX_REQUEST_CHARS))
      .filter((text) => text.length > 0)
      .map((text) => `- ${text}`)
      .join("\n");
    const title = thread.title ?? thread.titleFallback ?? "Untitled thread";
    if (requests.length === 0 && !thread.titleFallback) return;
    const latestOutput = getLastThreadOutput(this.deps.db, threadId);
    const latestError = getLastThreadErrorMessage(this.deps.db, threadId);
    const interaction = this.deps.pendingInteractions
      .listPendingThreadInteractions(threadId)
      .at(0);
    const prompt = renderTemplate("summarizeInboxThread", {
      title,
      requests: requests.length > 0 ? requests : `- ${title}`,
      ...(latestOutput
        ? { latestOutput: clampText(latestOutput, MAX_OUTPUT_CHARS) }
        : {}),
      ...(latestError
        ? { latestError: clampText(latestError, MAX_ERROR_CHARS) }
        : {}),
      ...(interaction
        ? { pendingAsk: formatPendingInteractionSummary({ interaction }) }
        : {}),
    });
    const result = await inferenceCompleteWithRetry(this.deps, {
      label: "Inbox summary inference",
      logContext: { threadId },
      maxAttempts: INFERENCE_POLICY.threadMetadata.maxAttempts,
      prompt,
      retryDelayMs: INFERENCE_POLICY.threadMetadata.retryDelayMs,
      reasoningEffort:
        this.deps.config.inferenceModel === "openai/gpt-6-luna"
          ? "none"
          : "low",
      schema: inboxSummarySchema,
      timeoutMs: INFERENCE_POLICY.threadMetadata.timeoutMs,
    });
    if (result === null) return;
    const goal = clampField(result.goal);
    const state = clampField(result.state);
    if (goal.length === 0 || state.length === 0) return;
    const needs = clampField(result.needs);
    upsertInboxSummary(this.deps.db, {
      threadId,
      goal,
      state,
      needs: needs.length > 0 ? needs : null,
      sourceVersion,
    });
  }
}
