import { z } from "zod";

export const INBOX_SUMMARY_REQUEST_MAX_THREADS = 500;

export const inboxSummarySchema = z.object({
  threadId: z.string().min(1),
  goal: z.string(),
  state: z.string(),
  needs: z.string().nullable(),
  sourceVersion: z.number(),
  updatedAt: z.number(),
});
export type InboxSummary = z.infer<typeof inboxSummarySchema>;
