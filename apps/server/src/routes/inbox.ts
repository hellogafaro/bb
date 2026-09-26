import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { InboxSummaryService } from "../services/inbox/inbox-summaries.js";

export function registerInboxRoutes(
  app: Hono,
  inboxSummaries: InboxSummaryService,
): void {
  const { post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post(publicApiRoutes.inbox.summaries, (context, body) =>
    context.json(inboxSummaries.request(body.threadIds)),
  );
}
