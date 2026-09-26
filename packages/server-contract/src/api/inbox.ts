import {
  INBOX_SUMMARY_REQUEST_MAX_THREADS,
  inboxSummarySchema,
} from "@bb/domain";
import { z } from "zod";

export const inboxSummariesRequestSchema = z
  .object({
    threadIds: z
      .array(z.string().min(1))
      .max(INBOX_SUMMARY_REQUEST_MAX_THREADS)
      .transform((ids) => [...new Set(ids)]),
  })
  .strict();
export type InboxSummariesRequest = z.input<typeof inboxSummariesRequestSchema>;

export const inboxSummariesResponseSchema = z
  .object({
    summaries: z.array(inboxSummarySchema),
    pending: z.array(z.string()),
  })
  .strict();
export type InboxSummariesResponse = z.infer<
  typeof inboxSummariesResponseSchema
>;
