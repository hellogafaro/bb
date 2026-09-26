import { and, eq, inArray, isNull } from "drizzle-orm";
import type { InboxSummary } from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { projects, threadInboxSummaries, threads } from "../schema.js";

type InboxSummaryWriteConnection = DbConnection | DbTransaction;

export interface UpsertInboxSummaryArgs {
  threadId: string;
  goal: string;
  state: string;
  needs: string | null;
  sourceVersion: number;
}

function toInboxSummary(
  row: typeof threadInboxSummaries.$inferSelect,
): InboxSummary {
  return {
    threadId: row.threadId,
    goal: row.goal,
    state: row.state,
    needs: row.needs,
    sourceVersion: row.sourceVersion,
    updatedAt: row.updatedAt,
  };
}

export interface InboxSummaryTarget {
  threadId: string;
  latestAttentionAt: number;
}

export function listInboxSummaryTargets(
  db: DbConnection,
  threadIds: readonly string[],
): InboxSummaryTarget[] {
  if (threadIds.length === 0) return [];
  return db
    .select({
      threadId: threads.id,
      latestAttentionAt: threads.latestAttentionAt,
    })
    .from(threads)
    .innerJoin(projects, eq(projects.id, threads.projectId))
    .where(
      and(
        inArray(threads.id, [...threadIds]),
        isNull(threads.deletedAt),
        isNull(projects.deletedAt),
      ),
    )
    .all();
}

export function listInboxSummaries(
  db: DbConnection,
  threadIds: readonly string[],
): InboxSummary[] {
  if (threadIds.length === 0) return [];
  return db
    .select()
    .from(threadInboxSummaries)
    .where(inArray(threadInboxSummaries.threadId, [...threadIds]))
    .all()
    .map(toInboxSummary);
}

export function upsertInboxSummary(
  db: InboxSummaryWriteConnection,
  args: UpsertInboxSummaryArgs,
): InboxSummary {
  const now = Date.now();
  const row = db
    .insert(threadInboxSummaries)
    .values({
      threadId: args.threadId,
      goal: args.goal,
      state: args.state,
      needs: args.needs,
      sourceVersion: args.sourceVersion,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: threadInboxSummaries.threadId,
      set: {
        goal: args.goal,
        state: args.state,
        needs: args.needs,
        sourceVersion: args.sourceVersion,
        updatedAt: now,
      },
    })
    .returning()
    .get();
  return toInboxSummary(row);
}
