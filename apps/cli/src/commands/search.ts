import { Command } from "commander";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

interface Options {
  project?: string;
  limitPerGroup?: string;
  cursor?: string;
  json?: boolean;
}

export function registerSearchCommand(
  program: Command,
  getUrl: () => string,
): void {
  program
    .command("search <query>")
    .description("Search threads, projects, settings, machines, and actions")
    .option("--project <id>", "Rank threads in this project higher")
    .option("--limit-per-group <number>", "Number of results per group (1-50)")
    .option("--cursor <cursor>", "Continue one result group")
    .option("--json", "Print the typed search response")
    .action(
      action(async (query: string, options: Options) => {
        const limitPerGroup =
          options.limitPerGroup === undefined
            ? undefined
            : Number(options.limitPerGroup);
        if (
          options.limitPerGroup !== undefined &&
          !/^(?:[1-9]|[1-4][0-9]|50)$/.test(options.limitPerGroup)
        )
          throw new Error("--limit-per-group must be an integer from 1 to 50");
        const response = await createCliBbSdk(getUrl()).search.query({
          query,
          ...(options.project ? { contextProjectId: options.project } : {}),
          ...(limitPerGroup ? { limitPerGroup } : {}),
          ...(options.cursor ? { cursor: options.cursor } : {}),
        });
        if (outputJson(options, response)) return;
        if (response.groups.every((group) => group.results.length === 0)) {
          console.log("No results");
          return;
        }
        for (const group of response.groups) {
          if (group.results.length === 0) continue;
          console.log(`${group.kind[0]?.toUpperCase()}${group.kind.slice(1)}`);
          for (const result of group.results) {
            console.log(
              `  ${result.label}  [${result.kind}]${result.subtitle ? `  ${result.subtitle}` : ""}${result.kind === "action" ? (result.requiresApp ? "  (app required)" : result.cliOperation ? `  (${result.cliOperation})` : "") : ""}  ${result.destination}`,
            );
          }
          if (group.nextCursor)
            console.log(`  More cursor: ${group.nextCursor}`);
        }
      }),
    );
}
