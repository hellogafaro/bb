import { sql } from "drizzle-orm";
import type { DbConnection } from "../connection.js";

const registeredConnections = new WeakSet<object>();

function normalized(value: string): string {
  return value.normalize("NFKD").replaceAll(/\p{M}/gu, "").normalize("NFKC").toLocaleLowerCase();
}

function nearbyWord(query: string, word: string): boolean {
  if (query === word) return true;
  const left = Array.from(query);
  const right = Array.from(word);
  if (Math.abs(left.length - right.length) > 1 || left.length > 32 || right.length > 32) return false;
  let prefix = 0;
  while (prefix < Math.min(left.length, right.length) && left[prefix] === right[prefix]) prefix += 1;
  if (left.length === right.length && left[prefix] === right[prefix + 1] && left[prefix + 1] === right[prefix]) {
    return left.slice(prefix + 2).join("") === right.slice(prefix + 2).join("");
  }
  if (left.length === right.length) return left.slice(prefix + 1).join("") === right.slice(prefix + 1).join("");
  if (left.length > right.length) return left.slice(prefix + 1).join("") === right.slice(prefix).join("");
  return left.slice(prefix).join("") === right.slice(prefix + 1).join("");
}

function fuzzyTitleMatch(title: string, query: string): number {
  const words = title.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  return Number(tokens.length > 0 && tokens.every((token) => words.some((word) => nearbyWord(token, word))));
}

export interface GlobalThreadSearchRow {
  id: string;
  projectId: string;
  projectName: string;
  title: string | null;
  titleFallback: string | null;
  status: string;
  archivedAt: number | null;
  updatedAt: number;
  matchClass: number;
  messageText: string | null;
  messageSeq: number | null;
}

export interface GlobalThreadSearchCursor {
  matchClass: number;
  affinity: number;
  archived: number;
  updatedAt: number;
  id: string;
}

export function registerSearchNormalization(db: DbConnection): void {
  if (!registeredConnections.has(db.$client)) {
    db.$client.function("bb_search_normalize", { deterministic: true }, normalized);
    db.$client.function("bb_search_fuzzy_title", { deterministic: true }, fuzzyTitleMatch);
    registeredConnections.add(db.$client);
  }
}

export function searchGlobalThreads(db: DbConnection, args: {
  query: string;
  tokens: readonly string[];
  contextProjectId?: string;
  limit: number;
  after?: GlobalThreadSearchCursor;
}): GlobalThreadSearchRow[] {
  registerSearchNormalization(db);
  const normalizedQuery = normalized(args.query);
  const escaped = normalizedQuery.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_");
  const tokens = args.tokens.map((token) => token.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_"));
  const label = sql`bb_search_normalize(coalesce(t.title, t.title_fallback, ''))`;
  const metadata = sql`bb_search_normalize(p.name || ' ' || t.id)`;
  const titleTokens = sql.join(tokens.map((token) => sql`${label} LIKE ${`%${token}%`} ESCAPE '!'`), sql` AND `);
  const metadataTokens = sql.join(tokens.map((token) => sql`(${label} || ' ' || ${metadata}) LIKE ${`%${token}%`} ESCAPE '!'`), sql` AND `);
  const searchContent = Array.from(args.query.replaceAll(/\s/gu, "")).length > 1;
  const candidateSelects = args.tokens.flatMap((token, index) => [
    sql`SELECT t.id AS id, ${index} AS tokenIndex, 0 AS fuzzyCandidate FROM threads t
      WHERE t.project_id IN (SELECT p.id FROM projects p
        WHERE p.deleted_at IS NULL AND bb_search_normalize(p.name) LIKE ${`%${tokens[index]}%`} ESCAPE '!')`,
    sql`SELECT t.id AS id, ${index} AS tokenIndex, 0 AS fuzzyCandidate FROM threads t
      WHERE bb_search_normalize(t.id) LIKE ${`%${tokens[index]}%`} ESCAPE '!'`,
    sql`SELECT s.thread_id AS id, ${index} AS tokenIndex, 0 AS fuzzyCandidate
      FROM thread_search_segments_fts
      JOIN thread_search_segments s ON s.rowid = thread_search_segments_fts.rowid
      WHERE ${searchContent ? sql`1` : sql`s.source_kind IN ('title', 'title_fallback')`}
        AND thread_search_segments_fts MATCH ${`"${token.replaceAll('"', '""')}"*`}`,
    ...(token.length >= 3 ? [sql`SELECT fuzzy.thread_id AS id, ${index} AS tokenIndex, 1 AS fuzzyCandidate FROM (
      SELECT s.thread_id FROM thread_search_segments_fts
      JOIN thread_search_segments s ON s.rowid = thread_search_segments_fts.rowid
      JOIN threads ranked_thread ON ranked_thread.id = s.thread_id
      WHERE s.source_kind IN ('title', 'title_fallback')
        AND thread_search_segments_fts MATCH ${`"${token[0]}"*`}
      GROUP BY s.thread_id
      ORDER BY ranked_thread.updated_at DESC, s.thread_id
      LIMIT 2000
    ) fuzzy`] : []),
  ]);
  const rank = sql`CASE
    WHEN ${label} = ${normalizedQuery} OR bb_search_normalize(t.id) = ${normalizedQuery} THEN 1
    WHEN ${label} LIKE ${`${escaped}%`} ESCAPE '!' THEN 2
    WHEN ${titleTokens} THEN 3
    WHEN bb_search_fuzzy_title(${label}, ${normalizedQuery}) = 1 THEN 4
    WHEN ${metadataTokens} THEN 5
    ELSE 6 END`;
  const affinity = sql`CASE WHEN t.project_id = ${args.contextProjectId ?? ""} THEN 0 ELSE 1 END`;
  const archived = sql`CASE WHEN t.archived_at IS NULL THEN 0 ELSE 1 END`;
  const messageCondition = sql.join(tokens.map((token) => sql`bb_search_normalize(s.text) LIKE ${`%${token}%`} ESCAPE '!'`), sql` OR `);
  const messageScore = sql.join(tokens.map((token) => sql`CASE WHEN bb_search_normalize(s.text) LIKE ${`%${token}%`} ESCAPE '!' THEN 1 ELSE 0 END`), sql` + `);
  const after = args.after;
  return db.all<GlobalThreadSearchRow>(sql`
    WITH candidate_tokens AS (${sql.join(candidateSelects, sql` UNION ALL `)}),
    candidate_ids AS (
      SELECT id, COUNT(DISTINCT CASE WHEN fuzzyCandidate = 0 THEN tokenIndex END) AS nonFuzzyTokens
      FROM candidate_tokens GROUP BY id
      HAVING COUNT(DISTINCT tokenIndex) = ${args.tokens.length}
    ), matched AS (
      SELECT t.id, t.project_id AS projectId, p.name AS projectName,
        t.title, t.title_fallback AS titleFallback, t.status,
        t.archived_at AS archivedAt, t.updated_at AS updatedAt,
        ${rank} AS matchClass, ${affinity} AS affinity, ${archived} AS archived
      FROM candidate_ids c JOIN threads t ON t.id = c.id
      JOIN projects p ON p.id = t.project_id
      WHERE t.deleted_at IS NULL AND t.visibility = 'visible'
        AND p.deleted_at IS NULL
        AND (c.nonFuzzyTokens = ${args.tokens.length} OR bb_search_fuzzy_title(${label}, ${normalizedQuery}) = 1)
    ), page AS (
      SELECT * FROM matched
      WHERE ${after === undefined ? sql`1` : sql`(
        matchClass > ${after.matchClass}
        OR (matchClass = ${after.matchClass} AND affinity > ${after.affinity})
        OR (matchClass = ${after.matchClass} AND affinity = ${after.affinity} AND archived > ${after.archived})
        OR (matchClass = ${after.matchClass} AND affinity = ${after.affinity} AND archived = ${after.archived} AND updatedAt < ${after.updatedAt})
        OR (matchClass = ${after.matchClass} AND affinity = ${after.affinity} AND archived = ${after.archived} AND updatedAt = ${after.updatedAt} AND id > ${after.id})
      )`}
      ORDER BY matchClass, affinity, archived, updatedAt DESC, id
      LIMIT ${args.limit}
    )
    SELECT page.id, page.projectId, page.projectName, page.title,
      page.titleFallback, page.status, page.archivedAt, page.updatedAt,
      page.matchClass, snippet.text AS messageText, snippet.source_seq AS messageSeq
    FROM page
    LEFT JOIN thread_search_segments snippet ON snippet.rowid = CASE WHEN page.matchClass = 6 THEN (
      SELECT s.rowid FROM thread_search_segments s
      WHERE s.thread_id = page.id AND s.source_kind NOT IN ('title', 'title_fallback')
        AND (${messageCondition})
      ORDER BY (${messageScore}) DESC, s.source_seq, s.id LIMIT 1
    ) END
    ORDER BY matchClass, affinity, archived, updatedAt DESC, page.id
  `);
}
