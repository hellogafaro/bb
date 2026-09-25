import type { SearchResponse } from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export type {
  SearchGroup,
  SearchGroupKind,
  SearchResult,
  SearchThreadResult,
  SearchProjectResult,
  SearchSettingResult,
  SearchMachineResult,
  SearchActionResult,
} from "@bb/server-contract";
export type SearchQueryResult = SearchResponse;

export interface SearchQueryArgs {
  query: string;
  contextProjectId?: string;
  limitPerGroup?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface SearchArea {
  query(args: SearchQueryArgs): Promise<SearchQueryResult>;
}

export function createSearchArea({ transport }: CreateSdkAreaArgs): SearchArea {
  return {
    query(args) {
      return transport.readJson(
        transport.api.v1.search.$get(
          {
            query: {
              query: args.query,
              ...(args.contextProjectId
                ? { contextProjectId: args.contextProjectId }
                : {}),
              ...(args.limitPerGroup !== undefined
                ? { limitPerGroup: String(args.limitPerGroup) }
                : {}),
              ...(args.cursor ? { cursor: args.cursor } : {}),
            },
          },
          ...signalRequestArgs(args.signal),
        ),
      );
    },
  };
}
