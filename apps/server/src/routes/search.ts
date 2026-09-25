import { CORE_SETTINGS_CATALOG, CORE_SETTINGS_PAGES } from "@bb/domain";
import { fuzzyMatchText } from "@bb/fuzzy-match";
import {
  getProjectComposeRoutePath,
  getSettingsMachineRoutePath,
  getSettingsRoutePath,
  getThreadRoutePath,
} from "@bb/client-core";
import {
  listThreadsWithPendingInteractionStateByIds,
  registerSearchNormalization,
  searchGlobalThreads,
} from "@bb/db";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type SearchGroup,
  type SearchGroupKind,
  type SearchHighlight,
  type SearchMatchClass,
  type SearchResponse,
  type SearchResult,
} from "@bb/server-contract";
import { sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { toThreadListEntryResponses } from "../services/threads/thread-runtime-display.js";

const cursorBase = z.object({
  query: z.string(),
  contextProjectId: z.string(),
  lastId: z.string().min(1),
});
const catalogCursor = cursorBase
  .extend({
    group: z.enum(["projects", "settings", "machines", "actions"]),
    lastMatchClass: z.number().int().min(1).max(6),
    lastLabel: z.string(),
  })
  .strict();
const threadCursor = cursorBase
  .extend({
    group: z.literal("threads"),
    thread: z
      .object({
        matchClass: z.number().int().min(1).max(6),
        affinity: z.union([z.literal(0), z.literal(1)]),
        archived: z.union([z.literal(0), z.literal(1)]),
        updatedAt: z.number().int().finite().nonnegative(),
        id: z.string().min(1),
      })
      .strict(),
  })
  .strict();
const cursorSchema = z.discriminatedUnion("group", [
  catalogCursor,
  threadCursor,
]);
type Cursor = z.infer<typeof cursorSchema>;

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(
  value: string,
  query: string,
  contextProjectId: string,
): Cursor {
  try {
    const candidate: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    const cursor = cursorSchema.parse(candidate);
    if (cursor.query !== query || cursor.contextProjectId !== contextProjectId)
      throw new Error();
    if (
      cursor.group === "threads" &&
      cursor.lastId !== `thread:${cursor.thread.id}`
    )
      throw new Error();
    return cursor;
  } catch {
    throw new ApiError(
      400,
      "invalid_request",
      "Invalid or mismatched search cursor",
    );
  }
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .normalize("NFKC")
    .trim()
    .replaceAll(/\s+/gu, " ")
    .toLocaleLowerCase();
}

function fold(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .normalize("NFKC")
    .toLocaleLowerCase();
}

function repositoryLabel(remote: string | null): string | undefined {
  if (!remote) return undefined;
  const scp = remote.includes("://")
    ? null
    : /^(?:[^@\s]+@)?([^:/\s]+):([^?#\s]+)$/.exec(remote);
  if (scp) return `${scp[1]}/${scp[2]}`.replace(/\.git$/i, "");
  try {
    const url = new URL(remote);
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol))
      return undefined;
    return `${url.hostname}${url.pathname}`.replace(/\.git$/i, "");
  } catch {
    return undefined;
  }
}

function classify(
  label: string,
  id: string,
  secondary: string,
  aliases: readonly string[],
  query: string,
  tokens: readonly string[],
): SearchMatchClass | null {
  const name = normalize(label);
  if (name === query || normalize(id) === query) return 1;
  if (
    aliases.some((alias) => normalize(alias) === query) ||
    name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(query))
  )
    return 2;
  if (tokens.every((token) => name.includes(token))) return 3;
  if (
    fuzzyMatchText({
      items: [label],
      query,
      getText: (value) => value,
      limit: 1,
    }).length > 0
  )
    return 4;
  if (
    tokens.every((token) =>
      normalize(`${label} ${secondary} ${aliases.join(" ")}`).includes(token),
    )
  )
    return 5;
  return null;
}

function highlights(
  text: string,
  query: string,
  field: SearchHighlight["field"],
): SearchHighlight[] {
  const codepoints = Array.from(text);
  const positions = [0];
  for (const codepoint of codepoints)
    positions.push(positions.at(-1)! + codepoint.length);
  const terms = query.split(" ");
  const ranges: SearchHighlight[] = [];
  for (const term of terms) {
    for (let startIndex = 0; startIndex < codepoints.length; startIndex += 1) {
      for (
        let endIndex = startIndex + 1;
        endIndex <=
        Math.min(codepoints.length, startIndex + Array.from(term).length + 2);
        endIndex += 1
      ) {
        const start = positions[startIndex]!;
        const end = positions[endIndex]!;
        if (fold(text.slice(start, end)) === term) {
          if (
            !ranges.some((range) => range.start === start && range.end === end)
          )
            ranges.push({ field, start, end });
          startIndex = codepoints.length;
          break;
        }
      }
    }
  }
  return ranges;
}

function snippetAroundMatch(text: string, tokens: readonly string[]): string {
  const codepoints = Array.from(text);
  const foldedOffsets: number[] = [];
  let foldedText = "";
  for (let index = 0; index < codepoints.length; index += 1) {
    const normalized = fold(codepoints[index]!);
    foldedText += normalized;
    for (let position = 0; position < normalized.length; position += 1)
      foldedOffsets.push(index);
  }
  const first = tokens
    .map((token) => foldedText.indexOf(token))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];
  const start = Math.max(
    0,
    (first === undefined ? 0 : (foldedOffsets[first] ?? 0)) - 40,
  );
  const end = Math.min(codepoints.length, start + 160);
  return `${start > 0 ? "…" : ""}${codepoints.slice(start, end).join("")}${end < codepoints.length ? "…" : ""}`;
}

function page(
  kind: Exclude<SearchGroupKind, "threads">,
  results: SearchResult[],
  limit: number,
  query: string,
  contextProjectId: string,
  cursor?: Cursor,
): SearchGroup {
  const sorted = results.sort(
    (a, b) =>
      a.matchClass - b.matchClass ||
      a.label.localeCompare(b.label) ||
      a.id.localeCompare(b.id),
  );
  const after =
    cursor && cursor.group !== "threads"
      ? sorted.filter(
          (result) =>
            result.matchClass > cursor.lastMatchClass ||
            (result.matchClass === cursor.lastMatchClass &&
              (result.label.localeCompare(cursor.lastLabel) > 0 ||
                (result.label === cursor.lastLabel &&
                  result.id.localeCompare(cursor.lastId) > 0))),
        )
      : sorted;
  const slice = after.slice(0, limit);
  const last = slice.at(-1);
  return {
    kind,
    results: slice,
    ...(last && after.length > limit
      ? {
          nextCursor: encodeCursor({
            query,
            contextProjectId,
            group: kind,
            lastId: last.id,
            lastLabel: last.label,
            lastMatchClass: last.matchClass,
          }),
        }
      : {}),
  };
}

export function registerSearchRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  get(publicApiRoutes.search, (context, input) => {
    const query = normalize(input.query);
    if (Array.from(query).length > 256)
      throw new ApiError(
        400,
        "invalid_request",
        "query must be at most 256 characters",
      );
    const limit =
      input.limitPerGroup === undefined ? 20 : Number(input.limitPerGroup);
    const contextProjectId = input.contextProjectId ?? "";
    const cursor =
      input.cursor === undefined
        ? undefined
        : decodeCursor(input.cursor, query, contextProjectId);
    if (!query)
      return context.json({ query, groups: [] } satisfies SearchResponse);
    const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [query];
    const escapedTokens = tokens.map((token) =>
      token.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_"),
    );
    registerSearchNormalization(deps.db);
    const groups: SearchGroup[] = [];

    if (!cursor || cursor.group === "threads") {
      const rows = searchGlobalThreads(deps.db, {
        query,
        tokens,
        contextProjectId,
        limit: limit + 1,
        after: cursor?.group === "threads" ? cursor.thread : undefined,
      });
      const visible = rows.slice(0, limit);
      const threadEntries = toThreadListEntryResponses(deps, {
        threads: listThreadsWithPendingInteractionStateByIds(
          deps.db,
          visible.map((row) => row.id),
        ),
      });
      const threadsById = new Map(
        threadEntries.map((thread) => [thread.id, thread]),
      );
      const results: SearchResult[] = visible.flatMap((row) => {
        const thread = threadsById.get(row.id);
        if (!thread) return [];
        const label =
          row.title?.trim() ||
          row.titleFallback?.trim() ||
          `Thread ${row.id.slice(0, 8)}`;
        const snippet =
          row.matchClass === 6 && row.messageText
            ? snippetAroundMatch(row.messageText, tokens)
            : undefined;
        return [
          {
            id: `thread:${row.id}`,
            kind: "thread",
            thread,
            label,
            subtitle: row.projectName,
            destination: getThreadRoutePath({
              projectId: row.projectId,
              threadId: row.id,
            }),
            matchClass: row.matchClass as SearchMatchClass,
            highlights: [
              ...highlights(label, query, "label"),
              ...(snippet ? highlights(snippet, query, "snippet") : []),
            ],
            threadId: row.id,
            projectId: row.projectId,
            archived: row.archivedAt !== null,
            status: row.status,
            updatedAt: row.updatedAt,
            ...(snippet ? { snippet } : {}),
            ...(row.matchClass === 6 && row.messageSeq !== null
              ? { messageAnchor: row.messageSeq }
              : {}),
          },
        ];
      });
      const last = visible.at(-1);
      groups.push({
        kind: "threads",
        results,
        ...(last && rows.length > limit
          ? {
              nextCursor: encodeCursor({
                query,
                contextProjectId,
                group: "threads",
                lastId: `thread:${last.id}`,
                thread: {
                  matchClass: last.matchClass,
                  affinity: last.projectId === contextProjectId ? 0 : 1,
                  archived: last.archivedAt === null ? 0 : 1,
                  updatedAt: last.updatedAt,
                  id: last.id,
                },
              }),
            }
          : {}),
      });
    }
    if (!cursor || cursor.group === "projects") {
      const matches = deps.db.all<{
        id: string;
        name: string;
        gitRemoteUrl: string | null;
      }>(
        sql`SELECT id, name, git_remote_url AS gitRemoteUrl FROM projects WHERE deleted_at IS NULL AND kind = 'standard' AND (${sql.join(
          escapedTokens.map(
            (token) =>
              sql`bb_search_normalize(name || ' ' || id || ' ' || coalesce(git_remote_url, '')) LIKE ${`%${token}%`} ESCAPE '!'`,
          ),
          sql` AND `,
        )}) ORDER BY name, id`,
      );
      const results: SearchResult[] = matches.flatMap((row) => {
        const repository = repositoryLabel(row.gitRemoteUrl);
        const matchClass = classify(
          row.name,
          row.id,
          repository ?? "",
          [],
          query,
          tokens,
        );
        return matchClass
          ? [
              {
                id: `project:${row.id}`,
                kind: "project" as const,
                label: row.name,
                subtitle: repository,
                matchClass,
                highlights: highlights(row.name, query, "label"),
                destination: getProjectComposeRoutePath(row.id),
                projectId: row.id,
              },
            ]
          : [];
      });
      groups.push(
        page("projects", results, limit, query, contextProjectId, cursor),
      );
    }
    if (!cursor || cursor.group === "settings") {
      const controlResults: SearchResult[] = CORE_SETTINGS_CATALOG.flatMap(
        (entry) => {
          const matchClass = classify(
            entry.label,
            entry.id,
            `${entry.sectionId} ${entry.description}`,
            entry.aliases,
            query,
            tokens,
          );
          return matchClass
            ? [
                {
                  id: `setting:${entry.id}`,
                  kind: "setting" as const,
                  label: entry.label,
                  subtitle: `${entry.sectionId} · ${entry.description}`,
                  matchClass,
                  highlights: highlights(entry.label, query, "label"),
                  destination: entry.path,
                  settingId: entry.id,
                  availability: entry.availability,
                },
              ]
            : [];
        },
      );
      const pageResults: SearchResult[] = CORE_SETTINGS_PAGES.flatMap(
        (entry) => {
          const matchClass = classify(
            entry.label,
            entry.id,
            entry.description,
            entry.aliases,
            query,
            tokens,
          );
          return matchClass
            ? [
                {
                  id: `settings-page:${entry.id}`,
                  kind: "setting" as const,
                  label: entry.label,
                  subtitle: entry.description,
                  matchClass,
                  highlights: highlights(entry.label, query, "label"),
                  destination: entry.path,
                  settingId: `page:${entry.id}`,
                  availability: "always" as const,
                },
              ]
            : [];
        },
      );
      const results = [...controlResults, ...pageResults];
      groups.push(
        page("settings", results, limit, query, contextProjectId, cursor),
      );
    }
    if (!cursor || cursor.group === "machines") {
      const matches = deps.db.all<{ id: string; name: string; phase: string }>(
        sql`SELECT id, name, phase FROM hosts WHERE destroyed_at IS NULL AND (${sql.join(
          escapedTokens.map(
            (token) =>
              sql`bb_search_normalize(name || ' ' || id) LIKE ${`%${token}%`} ESCAPE '!'`,
          ),
          sql` AND `,
        )}) ORDER BY name, id`,
      );
      const results: SearchResult[] = matches.flatMap((row) => {
        const matchClass = classify(row.name, row.id, "", [], query, tokens);
        return matchClass
          ? [
              {
                id: `machine:${row.id}`,
                kind: "machine" as const,
                label: row.name,
                subtitle: row.phase,
                matchClass,
                highlights: highlights(row.name, query, "label"),
                destination: getSettingsMachineRoutePath(row.id),
                machineId: row.id,
                status: row.phase,
              },
            ]
          : [];
      });
      groups.push(
        page("machines", results, limit, query, contextProjectId, cursor),
      );
    }
    if (!cursor || cursor.group === "actions") {
      const actions = [
        {
          id: "thread.new",
          label: "New thread",
          path: "/threads/new",
          aliases: ["create thread"],
        },
        {
          id: "theme.light",
          label: "Switch to light theme",
          path: getSettingsRoutePath("appearance"),
          aliases: ["light mode"],
        },
        {
          id: "theme.dark",
          label: "Switch to dark theme",
          path: getSettingsRoutePath("appearance"),
          aliases: ["dark mode"],
        },
        {
          id: "theme.system",
          label: "Use system theme",
          path: getSettingsRoutePath("appearance"),
          aliases: ["system appearance"],
        },
      ];
      const results: SearchResult[] = actions.flatMap((entry) => {
        const matchClass = classify(
          entry.label,
          entry.id,
          "",
          entry.aliases,
          query,
          tokens,
        );
        return matchClass
          ? [
              {
                id: `action:${entry.id}`,
                kind: "action" as const,
                label: entry.label,
                matchClass,
                highlights: highlights(entry.label, query, "label"),
                destination: entry.path,
                actionId: entry.id,
                requiresApp: entry.id !== "thread.new",
                ...(entry.id === "thread.new"
                  ? {
                      cliOperation: "bb thread spawn",
                      sdkOperation: "sdk.threads.spawn",
                    }
                  : {}),
              },
            ]
          : [];
      });
      groups.push(
        page("actions", results, limit, query, contextProjectId, cursor),
      );
    }
    return context.json({
      query,
      groups: cursor
        ? groups
        : groups.filter((group) => group.results.length > 0),
    } satisfies SearchResponse);
  });
}
