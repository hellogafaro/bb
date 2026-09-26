import {
  getInitialStoredTurnRequestEvent,
  listStoredFollowUpTurnRequestEvents,
  updateThread,
  type UpdateThreadInput,
} from "@bb/db";
import type { PromptInput, Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  requireEnvironment,
  requirePublicThread,
} from "../lib/entity-lookup.js";
import { INFERENCE_POLICY } from "../ai/inference.js";
import { dispatchThreadRenameCommand } from "./thread-commands.js";
import { getLastThreadOutput } from "./thread-data.js";
import { parseStoredTurnRequestEvent } from "./thread-events.js";
import {
  generateThreadMetadataWithOutcome,
  type ThreadTitleConversationContext,
} from "./title-generation.js";

const MAX_TITLE_FOLLOW_UPS = 8;

const pendingGenerations = new WeakMap<AppDeps["db"], Set<string>>();

function promptInputText(input: PromptInput[]): string {
  return input
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

function collectTitleConversationContext(
  deps: AppDeps,
  thread: Thread,
  startSequence: number,
): ThreadTitleConversationContext {
  const followUps = listStoredFollowUpTurnRequestEvents(deps.db, {
    afterSequence: startSequence,
    limit: MAX_TITLE_FOLLOW_UPS,
    threadId: thread.id,
  })
    .map((row) => promptInputText(parseStoredTurnRequestEvent(row).input))
    .filter((text) => text.length > 0);
  return {
    currentTitle: thread.title,
    followUps,
    latestOutput: getLastThreadOutput(deps.db, thread.id, startSequence),
  };
}

export function updateThreadMetadata(
  deps: AppDeps,
  thread: Thread,
  patch: UpdateThreadInput,
): Thread {
  const updated = updateThread(deps.db, deps.hub, thread.id, patch);
  if (!updated) {
    throw new ApiError(404, "thread_not_found", "Thread not found");
  }
  if (patch.title && patch.title !== thread.title && updated.environmentId) {
    const environment = requireEnvironment(deps.db, updated.environmentId);
    if (environment.status === "ready" && environment.path) {
      dispatchThreadRenameCommand(deps, {
        environment: { id: environment.id, hostId: environment.hostId },
        providerId: updated.providerId,
        threadId: updated.id,
        title: patch.title,
      });
    }
  }
  return updated;
}

export async function generateThreadTitle(
  deps: AppDeps,
  threadId: string,
): Promise<Thread> {
  const thread = requirePublicThread(deps.db, threadId);
  let pending = pendingGenerations.get(deps.db);
  if (!pending) {
    pending = new Set();
    pendingGenerations.set(deps.db, pending);
  }
  if (pending.has(threadId)) {
    throw new ApiError(
      409,
      "title_generation_in_progress",
      "Title generation is already in progress",
    );
  }
  pending.add(threadId);
  try {
    const request = getInitialStoredTurnRequestEvent(deps.db, threadId);
    if (!request) {
      throw new ApiError(
        422,
        "title_generation_input_missing",
        "This thread has no task input to generate a title from",
      );
    }
    const outcome = await generateThreadMetadataWithOutcome(deps, {
      conversation: collectTitleConversationContext(
        deps,
        thread,
        request.sequence,
      ),
      threadId,
      input: parseStoredTurnRequestEvent(request).input,
      timeoutMaxAttempts: INFERENCE_POLICY.threadMetadata.maxAttempts,
      timeoutMs: INFERENCE_POLICY.threadMetadata.timeoutMs,
    });
    const title = outcome.metadata?.title;
    if (!title) {
      if (outcome.reason === "empty-input" || outcome.reason === "too-short") {
        throw new ApiError(
          422,
          "title_generation_input_missing",
          "The thread has too little text to generate a title from",
        );
      }
      throw new ApiError(
        503,
        "title_generation_failed",
        "Could not generate a title. Check the inference configuration and try again",
        { retryable: true },
      );
    }
    const current = requirePublicThread(deps.db, threadId);
    if (current.title !== thread.title) {
      throw new ApiError(
        409,
        "thread_title_changed",
        "The thread title changed during generation. Try again to replace it",
      );
    }
    return title === current.title
      ? current
      : updateThreadMetadata(deps, current, { title });
  } finally {
    pending.delete(threadId);
  }
}
