import { z } from "zod";
import type { ThreadListEntry } from "@bb/domain";

export const searchGroupKinds = [
  "threads",
  "projects",
  "settings",
  "machines",
  "actions",
] as const;
export type SearchGroupKind = (typeof searchGroupKinds)[number];
export type SearchMatchClass = 1 | 2 | 3 | 4 | 5 | 6;

export const searchQuerySchema = z.object({
  query: z
    .string()
    .refine(
      (value) => Array.from(value).length <= 256,
      "query must be at most 256 Unicode characters",
    ),
  contextProjectId: z.string().optional(),
  limitPerGroup: z
    .string()
    .regex(
      /^(?:[1-9]|[1-4][0-9]|50)$/,
      "limitPerGroup must be an integer from 1 to 50",
    )
    .optional(),
  cursor: z.string().max(4096).optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export interface SearchHighlight {
  field: "label" | "subtitle" | "snippet";
  start: number;
  end: number;
}

interface SearchResultBase {
  id: string;
  label: string;
  subtitle?: string;
  matchClass: SearchMatchClass;
  highlights: SearchHighlight[];
  destination: string;
}

export interface SearchThreadResult extends SearchResultBase {
  kind: "thread";
  thread: ThreadListEntry;
  threadId: string;
  projectId: string;
  archived: boolean;
  status: string;
  updatedAt: number;
  messageAnchor?: number;
  snippet?: string;
}

export interface SearchProjectResult extends SearchResultBase {
  kind: "project";
  projectId: string;
}

export interface SearchSettingResult extends SearchResultBase {
  kind: "setting";
  settingId: string;
  availability:
    | "always"
    | "desktop-browser"
    | "system-config"
    | "local-helper-setup"
    | "local-daemon";
}

export interface SearchMachineResult extends SearchResultBase {
  kind: "machine";
  machineId: string;
  status: string;
}

export interface SearchActionResult extends SearchResultBase {
  kind: "action";
  actionId: string;
  requiresApp: boolean;
  cliOperation?: string;
  sdkOperation?: string;
}

export type SearchResult =
  | SearchThreadResult
  | SearchProjectResult
  | SearchSettingResult
  | SearchMachineResult
  | SearchActionResult;

export interface SearchGroup {
  kind: SearchGroupKind;
  results: SearchResult[];
  nextCursor?: string;
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
}
