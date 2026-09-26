import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import type { AppDeps } from "../types.js";
import { ApiError } from "../errors.js";
import { isPublicThread } from "../services/lib/entity-lookup.js";

export function registerInteractionRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  get(publicApiRoutes.interactions.list, (context) => {
    const visibleThreads = new Map<string, boolean>();
    const interactions = deps.pendingInteractions
      .listPendingInteractions()
      .filter((interaction) => {
        let visible = visibleThreads.get(interaction.threadId);
        if (visible === undefined) {
          visible = isPublicThread(deps.db, interaction.threadId);
          visibleThreads.set(interaction.threadId, visible);
        }
        return visible;
      });
    return context.json(interactions);
  });
}
