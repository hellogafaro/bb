import { renderTemplate } from "@bb/templates";
import { getThread, updateThread } from "@bb/db";
import { basename } from "node:path";
import {
  removeCommandMentionsFromPromptInput,
  type PromptInput,
  type PromptMentionCommandTrigger,
} from "@bb/domain";
import {
  countWords,
  displayWidth,
  truncateToWidth,
  truncateToWidthAtWordBoundary,
} from "@bb/text-utils";
import type { AppDeps, LoggedWorkSessionDeps } from "../../types.js";
import { Type } from "@earendil-works/pi-ai";
import {
  INFERENCE_POLICY,
  InferenceTimeoutError,
  inferenceCompleteWithRetry,
} from "../ai/inference.js";

const MIN_TITLE_GENERATION_WORDS = 5;
const MAX_GENERATED_TITLE_WIDTH = 60;
const MAX_TITLE_FALLBACK_WIDTH = 80;
const TITLE_FALLBACK_ELLIPSIS = "...";
const MAX_BRANCH_SLUG_LENGTH = 48;
const MAX_TITLE_PROMPT_INFERENCE_WIDTH = 2_000;
const MAX_TITLE_FOLLOW_UP_INFERENCE_WIDTH = 400;
const MAX_TITLE_OUTPUT_INFERENCE_WIDTH = 1_500;
const MAX_TITLE_ATTACHMENT_NAMES = 6;

interface ApplyGeneratedThreadTitleArgs {
  threadId: string;
  title: string;
}

export interface ThreadTitleConversationContext {
  currentTitle: string | null;
  followUps: string[];
  latestOutput: string | null;
}

interface ThreadMetadataGenerationArgs {
  conversation?: ThreadTitleConversationContext;
  input: PromptInput[];
  threadId: string;
  timeoutMaxAttempts?: number;
  timeoutMs?: number;
}

interface GeneratedThreadMetadata {
  title?: string;
}

type ThreadMetadataGenerationOutcomeReason =
  | "empty-input"
  | "failed"
  | "inference-unavailable"
  | "too-short"
  | "timeout";

export interface ThreadMetadataGenerationOutcome {
  durationMs: number;
  metadata: GeneratedThreadMetadata | null;
  reason?: ThreadMetadataGenerationOutcomeReason;
}

interface RawGeneratedThreadMetadata {
  title: string;
}

function cleanPromptText(input: PromptInput[]): string {
  return input
    .filter((part) => part.type === "text")
    .map((part) => part.text.trim())
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function clampTextToWidth(text: string, maxWidth: number): string {
  if (displayWidth(text) <= maxWidth) {
    return text;
  }
  const body = truncateToWidth(text, maxWidth - TITLE_FALLBACK_ELLIPSIS.length);
  return `${body}${TITLE_FALLBACK_ELLIPSIS}`;
}

function clampPromptText(text: string): string {
  return clampTextToWidth(text, MAX_TITLE_FALLBACK_WIDTH);
}

export function clampTitleInferenceText(text: string): string {
  return clampTextToWidth(text, MAX_TITLE_PROMPT_INFERENCE_WIDTH);
}

export function clampTitleFollowUpText(text: string): string {
  return clampTextToWidth(text, MAX_TITLE_FOLLOW_UP_INFERENCE_WIDTH);
}

export function clampTitleOutputText(text: string): string {
  return clampTextToWidth(text, MAX_TITLE_OUTPUT_INFERENCE_WIDTH);
}

export function deriveTitleFallback(input: PromptInput[]): string | null {
  const text = cleanPromptText(input);
  if (text.length === 0) {
    return null;
  }
  return clampPromptText(text);
}

export function collectPromptAttachmentNames(input: PromptInput[]): string[] {
  const names: string[] = [];
  for (const part of input) {
    if (part.type !== "localFile") {
      continue;
    }
    const name = basename(part.path);
    if (name.length === 0 || names.includes(name)) {
      continue;
    }
    names.push(name);
    if (names.length === MAX_TITLE_ATTACHMENT_NAMES) {
      break;
    }
  }
  return names;
}

interface InvokedPromptCommand {
  name: string;
  trigger: PromptMentionCommandTrigger;
}

export function collectInvokedPromptCommands(
  input: PromptInput[],
): InvokedPromptCommand[] {
  const seen = new Set<string>();
  return input.flatMap((part) =>
    part.type === "text"
      ? part.mentions.flatMap((mention) => {
          if (mention.resource.kind !== "command") {
            return [];
          }
          const { name, trigger } = mention.resource;
          const key = `${trigger}${name}`;
          if (seen.has(key)) {
            return [];
          }
          seen.add(key);
          return [{ name, trigger }];
        })
      : [],
  );
}

function promptTextWithoutCommands(
  input: PromptInput[],
  commands: InvokedPromptCommand[],
): string {
  return cleanPromptText(
    commands.reduce<PromptInput[]>(
      (remaining, command) =>
        removeCommandMentionsFromPromptInput(remaining, command),
      input,
    ),
  );
}

function formatInvokedCommands(commands: InvokedPromptCommand[]): string {
  return commands
    .map((command) => `${command.trigger}${command.name}`)
    .join(", ");
}

export function shouldGenerateThreadTitle(input: PromptInput[]): boolean {
  const text = cleanPromptText(input);
  if (text.length === 0) {
    return false;
  }

  if (collectInvokedPromptCommands(input).length > 0) {
    return true;
  }

  return countWords(text) >= MIN_TITLE_GENERATION_WORDS;
}

export function sanitizeGeneratedTitle(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ");
  const title = truncateToWidthAtWordBoundary(
    normalized,
    MAX_GENERATED_TITLE_WIDTH,
  ).trim();
  return title.length > 0 ? title : null;
}

export function sanitizeGeneratedBranchSlug(value: string): string | null {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, MAX_BRANCH_SLUG_LENGTH)
    .replace(/-+$/u, "");

  return slug.length > 0 ? slug : null;
}

const threadMetadataSchema = Type.Object({
  title: Type.String(),
});

function normalizeGeneratedThreadMetadata(
  parsed: RawGeneratedThreadMetadata | null,
): GeneratedThreadMetadata | null {
  if (!parsed) {
    return null;
  }

  const title = parsed.title ? sanitizeGeneratedTitle(parsed.title) : null;
  if (!title) {
    return null;
  }

  return { title };
}

export async function generateThreadMetadataWithOutcome(
  deps: LoggedWorkSessionDeps,
  args: ThreadMetadataGenerationArgs,
): Promise<ThreadMetadataGenerationOutcome> {
  const startedAt = Date.now();
  const fallback = deriveTitleFallback(args.input);
  const complete = (
    metadata: GeneratedThreadMetadata | null,
    reason?: ThreadMetadataGenerationOutcomeReason,
  ): ThreadMetadataGenerationOutcome => ({
    durationMs: Date.now() - startedAt,
    metadata,
    ...(reason ? { reason } : {}),
  });

  if (!fallback) {
    return complete(null, "empty-input");
  }
  const conversation = args.conversation;
  const hasConversation =
    conversation !== undefined &&
    (conversation.followUps.length > 0 || conversation.latestOutput !== null);
  if (!hasConversation && !shouldGenerateThreadTitle(args.input)) {
    return complete(null, "too-short");
  }

  const commands = collectInvokedPromptCommands(args.input);
  const body = promptTextWithoutCommands(args.input, commands);
  const attachments = collectPromptAttachmentNames(args.input);
  const prompt = renderTemplate("generateThreadMetadata", {
    cleanedPrompt:
      body.length > 0 ? clampTitleInferenceText(body) : fallback,
    ...(commands.length > 0
      ? { invokedCommands: formatInvokedCommands(commands) }
      : {}),
    ...(attachments.length > 0 ? { attachments: attachments.join(", ") } : {}),
    ...(conversation?.followUps.length
      ? {
          followUps: conversation.followUps
            .map((text) => `- ${clampTitleFollowUpText(text)}`)
            .join("\n"),
        }
      : {}),
    ...(conversation?.latestOutput
      ? { latestOutput: clampTitleOutputText(conversation.latestOutput) }
      : {}),
    ...(conversation?.currentTitle
      ? { currentTitle: conversation.currentTitle }
      : {}),
  });
  const maxAttempts = Math.max(1, args.timeoutMaxAttempts ?? 1);

  try {
    const inference = await inferenceCompleteWithRetry(deps, {
      label: "Thread metadata inference",
      logContext: { threadId: args.threadId },
      maxAttempts,
      prompt,
      retryDelayMs: INFERENCE_POLICY.threadMetadata.retryDelayMs,
      reasoningEffort:
        deps.config.inferenceModel === "openai/gpt-6-luna" ? "none" : "low",
      schema: threadMetadataSchema,
      timeoutMs: args.timeoutMs ?? INFERENCE_POLICY.threadMetadata.timeoutMs,
    });
    const metadata = normalizeGeneratedThreadMetadata(inference);
    return complete(metadata, metadata ? undefined : "inference-unavailable");
  } catch (error) {
    return complete(
      null,
      error instanceof InferenceTimeoutError ? "timeout" : "failed",
    );
  }
}

export function applyGeneratedThreadTitle(
  deps: Pick<AppDeps, "db" | "hub">,
  args: ApplyGeneratedThreadTitleArgs,
): boolean {
  const title = args.title.trim();
  if (title.length === 0) {
    return false;
  }

  const currentThread = getThread(deps.db, args.threadId);
  if (!currentThread || currentThread.title) {
    return false;
  }

  updateThread(deps.db, deps.hub, args.threadId, {
    title,
  });

  return true;
}
