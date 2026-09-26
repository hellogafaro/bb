import type { InboxSummariesResponse } from "@bb/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface InboxSummariesArgs {
  threadIds: readonly string[];
  signal?: AbortSignal;
}

export type InboxSummariesResult = InboxSummariesResponse;

export interface InboxArea {
  summaries(args: InboxSummariesArgs): Promise<InboxSummariesResult>;
}

export function createInboxArea({ transport }: CreateSdkAreaArgs): InboxArea {
  return {
    async summaries(args) {
      return transport.readJson(
        transport.api.v1.inbox.summaries.$post(
          { json: { threadIds: [...args.threadIds] } },
          ...signalRequestArgs(args.signal),
        ),
      );
    },
  };
}
