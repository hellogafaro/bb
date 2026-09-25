import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { threads } from "../schema.js";

type ThreadRow = typeof threads.$inferSelect;
type ThreadSnoozeConnection = DbConnection | DbTransaction;

export interface SetThreadSnoozedUntilArgs {
  snoozedUntil: number | null;
  threadId: string;
}

export interface WakeSnoozedThreadFamilyArgs {
  threadId: string;
}

export function notifyThreadSnoozeChanged(
  notifier: Pick<DbNotifier, "notifyThread">,
  thread: Pick<ThreadRow, "id" | "projectId">,
): void {
  notifier.notifyThread(thread.id, ["pin-state-changed"], {
    projectId: thread.projectId,
  });
}

export function setThreadSnoozedUntil(
  db: DbConnection,
  notifier: DbNotifier,
  args: SetThreadSnoozedUntilArgs,
): ThreadRow | null {
  const result = db.transaction(
    (tx): { changed: boolean; thread: ThreadRow } | null => {
      const existing = tx
        .select()
        .from(threads)
        .where(and(eq(threads.id, args.threadId), isNull(threads.deletedAt)))
        .get();
      if (!existing) return null;
      if (existing.snoozedUntil === args.snoozedUntil) {
        return { changed: false, thread: existing };
      }
      const updated = tx
        .update(threads)
        .set({ snoozedUntil: args.snoozedUntil })
        .where(eq(threads.id, args.threadId))
        .returning()
        .get();
      return updated ? { changed: true, thread: updated } : null;
    },
    { behavior: "immediate" },
  );
  if (result?.changed) notifyThreadSnoozeChanged(notifier, result.thread);
  return result?.thread ?? null;
}

export function wakeSnoozedThreadAncestorsInTransaction(
  db: ThreadSnoozeConnection,
  threadId: string,
): ThreadRow[] {
  const woken: ThreadRow[] = [];
  const visited = new Set<string>([threadId]);
  let parentId =
    db
      .select({ parentThreadId: threads.parentThreadId })
      .from(threads)
      .where(eq(threads.id, threadId))
      .get()?.parentThreadId ?? null;
  while (parentId !== null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = db
      .select({
        parentThreadId: threads.parentThreadId,
        snoozedUntil: threads.snoozedUntil,
      })
      .from(threads)
      .where(eq(threads.id, parentId))
      .get();
    if (!parent) break;
    if (parent.snoozedUntil !== null) {
      const cleared = db
        .update(threads)
        .set({ snoozedUntil: null })
        .where(and(eq(threads.id, parentId), isNotNull(threads.snoozedUntil)))
        .returning()
        .get();
      if (cleared) woken.push(cleared);
    }
    parentId = parent.parentThreadId;
  }
  return woken;
}

export function wakeSnoozedThreadFamilyInTransaction(
  db: ThreadSnoozeConnection,
  threadId: string,
): ThreadRow[] {
  const self = db
    .update(threads)
    .set({ snoozedUntil: null })
    .where(and(eq(threads.id, threadId), isNotNull(threads.snoozedUntil)))
    .returning()
    .get();
  return [
    ...(self ? [self] : []),
    ...wakeSnoozedThreadAncestorsInTransaction(db, threadId),
  ];
}

export function wakeSnoozedThreadFamily(
  db: DbConnection,
  notifier: DbNotifier,
  args: WakeSnoozedThreadFamilyArgs,
): ThreadRow[] {
  const woken = db.transaction(
    (tx) => wakeSnoozedThreadFamilyInTransaction(tx, args.threadId),
    { behavior: "immediate" },
  );
  for (const thread of woken) notifyThreadSnoozeChanged(notifier, thread);
  return woken;
}
