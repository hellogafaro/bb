import { Command } from "commander";
import { formatPendingInteractionSummary } from "@bb/core-ui";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { printBorderlessTable } from "../table.js";
import { outputJson } from "./helpers.js";
import { formatInteractionKind } from "./thread/interactions.js";

export function registerInboxCommand(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("inbox")
    .description(
      "List every pending approval and question across threads, newest first",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: { json?: boolean }) => {
        const sdk = createCliBbSdk(getUrl());
        const [interactions, threads] = await Promise.all([
          sdk.interactions.list(),
          sdk.threads.list({ includeHidden: true }),
        ]);
        const summaries = await sdk.inbox.summaries({
          threadIds: [
            ...new Set(interactions.map((interaction) => interaction.threadId)),
          ],
        });
        const goals = new Map(
          summaries.summaries.map((summary) => [
            summary.threadId,
            summary.goal,
          ]),
        );
        const titles = new Map(
          threads.map((thread) => [
            thread.id,
            thread.title ?? thread.titleFallback ?? thread.id,
          ]),
        );
        if (
          outputJson(opts, {
            interactions,
            summaries: summaries.summaries,
            pendingSummaries: summaries.pending,
          })
        )
          return;
        if (interactions.length === 0) {
          console.log("Inbox is empty");
          return;
        }
        printBorderlessTable(
          {
            head: ["ID", "Thread", "Kind", "Summary", "Goal"],
            colWidths: [20, 24, 12, 44, 40],
            trimTrailingWhitespace: true,
          },
          interactions.map((interaction) => [
            interaction.id,
            titles.get(interaction.threadId) ?? interaction.threadId,
            formatInteractionKind(interaction),
            formatPendingInteractionSummary({ interaction }),
            goals.get(interaction.threadId) ?? "",
          ]),
        );
      }),
    );
}
