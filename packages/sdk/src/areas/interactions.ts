import type { PendingInteraction } from "@bb/domain";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface InteractionListArgs {
  signal?: AbortSignal;
}

export interface InteractionsArea {
  list(args?: InteractionListArgs): Promise<PendingInteraction[]>;
}

export function createInteractionsArea({
  transport,
}: CreateSdkAreaArgs): InteractionsArea {
  return {
    async list(args) {
      return transport.readJson(
        transport.api.v1.interactions.$get(
          {},
          ...signalRequestArgs(args?.signal),
        ),
      );
    },
  };
}
