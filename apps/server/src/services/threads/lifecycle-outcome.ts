import {
  applyThreadLifecycleEvent,
  applyThreadLifecycleEventInTransaction,
  notifyThreadSnoozeChanged,
  type ApplyThreadLifecycleEventArgs,
  type ApplyThreadLifecycleEventOutcome,
  type DbConnection,
  type DbTransaction,
} from "@bb/db";
import type { ServerLogger } from "../../types.js";
import type { NotificationHub } from "../../ws/hub.js";
import {
  emitPluginThreadLifecycleOutcome,
  emitPluginTurnFailed,
} from "../plugins/plugin-thread-events.js";
import type { ProviderRegistryService } from "../providers/provider-registry.js";
import { buildThreadStatusChangeMetadata } from "./thread-runtime-display.js";

/**
 * `run.failed` is the only event that lands a thread in `error`, so an applied
 * one is exactly "a turn on this thread just failed" — which is what the
 * `turn.failed` plugin event announces.
 *
 * Deliberately after the failure is fully applied: this is an announcement, not
 * a decision. A listener that wants another attempt asks for one afterwards
 * with `sdk.threads.retry`, so nothing here can change how the failure was
 * handled.
 */
function announceTurnFailed(
  args: ApplyThreadLifecycleEventArgs,
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  if (!outcome.applied || args.event.type !== "run.failed") return;
  emitPluginTurnFailed(args.threadId);
}

interface ApplyLoggedThreadLifecycleEventDeps {
  db: DbConnection;
  hub: Pick<NotificationHub, "getDaemonSessionIdForHost" | "notifyThread">;
  logger: ServerLogger;
  providerRegistry: ProviderRegistryService;
}

interface ApplyLoggedThreadLifecycleEventTransactionDeps {
  db: DbTransaction;
  hub: Pick<NotificationHub, "notifyThread">;
  logger: ServerLogger;
}

function notifyWokenSnoozes(
  hub: Pick<NotificationHub, "notifyThread">,
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  if (!outcome.applied) return;
  for (const thread of outcome.wokenThreads) {
    notifyThreadSnoozeChanged(hub, thread);
  }
}

function logUnappliedThreadLifecycleEvent(
  logger: ServerLogger,
  args: ApplyThreadLifecycleEventArgs,
  outcome: ApplyThreadLifecycleEventOutcome,
): void {
  if (outcome.applied) {
    return;
  }
  logger.info(
    {
      detail: outcome.detail,
      event: args.event.type,
      reason: outcome.reason,
      threadId: args.threadId,
    },
    "Thread lifecycle event not applied",
  );
}

export function applyLoggedThreadLifecycleEvent(
  deps: ApplyLoggedThreadLifecycleEventDeps,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const outcome = applyThreadLifecycleEvent(deps.db, args);
  if (outcome.applied) {
    deps.hub.notifyThread(
      args.threadId,
      ["status-changed"],
      buildThreadStatusChangeMetadata(deps, outcome.thread),
    );
  }
  notifyWokenSnoozes(deps.hub, outcome);
  logUnappliedThreadLifecycleEvent(deps.logger, args, outcome);
  emitPluginThreadLifecycleOutcome(outcome);
  announceTurnFailed(args, outcome);
  return outcome;
}

export function applyLoggedThreadLifecycleEventInTransaction(
  deps: ApplyLoggedThreadLifecycleEventTransactionDeps,
  args: ApplyThreadLifecycleEventArgs,
): ApplyThreadLifecycleEventOutcome {
  const outcome = applyThreadLifecycleEventInTransaction(deps.db, args);
  notifyWokenSnoozes(deps.hub, outcome);
  logUnappliedThreadLifecycleEvent(deps.logger, args, outcome);
  emitPluginThreadLifecycleOutcome(outcome);
  announceTurnFailed(args, outcome);
  return outcome;
}
