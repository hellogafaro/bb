import type { SearchResult } from "@bb/server-contract";
import { fuzzyMatchText } from "@bb/fuzzy-match";
import type { PaletteAction } from "./palette-action";

export type SearchGroupKind =
  | "threads"
  | "projects"
  | "settings"
  | "machines"
  | "actions";
export const SEARCH_GROUP_ORDER: readonly SearchGroupKind[] = [
  "threads",
  "projects",
  "settings",
  "machines",
  "actions",
];
export const SEARCH_GROUP_LABELS: Record<SearchGroupKind, string> = {
  threads: "Threads",
  projects: "Projects",
  settings: "Settings",
  machines: "Machines",
  actions: "Actions",
};

export type SearchEntry =
  | SearchResult
  | {
      id: string;
      kind: "local-action";
      label: string;
      subtitle?: string;
      matchClass: 1 | 2 | 3 | 4 | 5 | 6;
      action: PaletteAction;
    };

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/gu, " ");
}

export function matchClass(
  label: string,
  secondary: string,
  query: string,
  aliases: readonly string[] = [],
): 1 | 2 | 3 | 4 | 5 | 6 | null {
  const needle = normalize(query);
  if (!needle) return null;
  const name = normalize(label);
  const tokens = needle.split(" ");
  if (name === needle) return 1;
  if (
    aliases.some((alias) => normalize(alias) === needle) ||
    name.split(/[^\p{L}\p{N}]+/u).some((word) => word.startsWith(needle))
  )
    return 2;
  if (tokens.every((word) => name.includes(word))) return 3;
  if (
    fuzzyMatchText({
      items: [label],
      query: needle,
      getText: (value) => value,
      limit: 1,
    }).length > 0
  )
    return 4;
  if (
    tokens.every((word) =>
      normalize(`${label} ${secondary} ${aliases.join(" ")}`).includes(word),
    )
  )
    return 5;
  return null;
}

export function localActionResults(
  actions: readonly PaletteAction[],
  query: string,
): SearchEntry[] {
  return actions
    .flatMap((action) => {
      if (
        action.id === "app:palette.open" ||
        action.id === "app:thread.search" ||
        action.id === "app:settings.open"
      )
        return [];
      const rank = matchClass(
        action.title,
        action.group,
        query,
        action.aliases,
      );
      return rank === null
        ? []
        : [
            {
              id: action.id,
              kind: "local-action" as const,
              label: action.title,
              ...(action.group === "Actions" ? {} : { subtitle: action.group }),
              matchClass: rank,
              action,
            },
          ];
    })
    .sort(
      (a, b) => a.matchClass - b.matchClass || a.label.localeCompare(b.label),
    );
}

const RECENT_LIMIT = 50;
function recentKey(server: string, type: "destinations" | "actions"): string {
  return `bb.search.${encodeURIComponent(server)}.${type}`;
}
export function readSearchRecents(
  server: string,
  type: "destinations" | "actions",
): string[] {
  try {
    const key = recentKey(server, type);
    if (type === "actions" && localStorage.getItem(key) === null) {
      const legacy = localStorage.getItem("bb.palette.recents");
      if (legacy !== null) {
        const parsed: unknown = JSON.parse(legacy);
        const migrated = Array.isArray(parsed)
          ? parsed.filter((id): id is string => typeof id === "string")
          : [];
        localStorage.setItem(
          key,
          JSON.stringify(migrated.slice(0, RECENT_LIMIT)),
        );
        localStorage.removeItem("bb.palette.recents");
      }
    }
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value
          .filter((id): id is string => typeof id === "string")
          .slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
}
export function recordSearchRecent(
  server: string,
  type: "destinations" | "actions",
  id: string,
): void {
  const next = [
    id,
    ...readSearchRecents(server, type).filter((entry) => entry !== id),
  ].slice(0, RECENT_LIMIT);
  try {
    localStorage.setItem(recentKey(server, type), JSON.stringify(next));
  } catch {}
}

export function sortSearchGroups(
  groups: { kind: SearchGroupKind; results: readonly SearchEntry[] }[],
): SearchGroupKind[] {
  return [...groups]
    .filter((group) => group.results.length > 0)
    .sort(
      (a, b) =>
        (a.results[0]?.matchClass ?? 6) - (b.results[0]?.matchClass ?? 6) ||
        SEARCH_GROUP_ORDER.indexOf(a.kind) - SEARCH_GROUP_ORDER.indexOf(b.kind),
    )
    .map((group) => group.kind);
}
