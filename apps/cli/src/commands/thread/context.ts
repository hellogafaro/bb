import { Command } from "commander";
import type {
  ThreadContextInstructionsResult,
  ThreadContextResult,
} from "@bb/sdk";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

const count = (value: number) => value.toLocaleString("en-US");

function padRight(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

function printTable(rows: readonly string[][]): void {
  const widths = rows[0].map((_, column) =>
    Math.max(...rows.map((row) => row[column].length)),
  );
  for (const row of rows) {
    console.log(
      row
        .map((cell, column) =>
          column === row.length - 1 ? cell : padRight(cell, widths[column]),
        )
        .join("  "),
    );
  }
}

function printUsage(usage: ThreadContextResult["usage"]): void {
  if (!usage) {
    console.log("Context usage is not available yet.");
    return;
  }
  console.log(
    `${usage.estimated ? "Estimated context" : "Context window"}: ${count(usage.usedTokens)} / ${count(usage.modelContextWindow)} tokens`,
  );
  if (!usage.snapshot) return;
  console.log(`Captured: ${usage.snapshot.capturedAt}`);
  for (const category of usage.snapshot.categories) {
    const kind = category.kind === "used" ? "" : ` (${category.kind})`;
    console.log(`${category.label}${kind}: ${count(category.tokens)}`);
    for (const entry of category.entries)
      console.log(`  ${entry.label}: ${count(entry.tokens)}`);
  }
}

function printInstructions(result: ThreadContextInstructionsResult): void {
  console.log(result.instructions);
  console.log("");
  console.log(`Instruction mode: ${result.instructionMode}`);
  printTable([
    ["Group", "Chars", "Est. tokens (chars/4)"],
    ...result.groups.map((group) => [
      `<${group.tag}>`,
      count(group.chars),
      count(group.estimatedTokens),
    ]),
    ["Total", count(result.chars), count(result.estimatedTokens)],
  ]);
  const skillFiles = result.skills.reduce(
    (sum, skill) => sum + (skill.fileCount ?? 0),
    0,
  );
  const skillBytes = result.skills.reduce(
    (sum, skill) => sum + (skill.bytes ?? 0),
    0,
  );
  console.log(
    `Injected skills: ${count(result.skills.length)} roots, ${count(skillFiles)} files, ${count(skillBytes)} bytes`,
  );
  for (const skill of result.skills) {
    const files =
      skill.fileCount === null ? "files=?" : `files=${count(skill.fileCount)}`;
    const bytes =
      skill.bytes === null ? "bytes=?" : `bytes=${count(skill.bytes)}`;
    console.log(
      `  ${skill.name} (${skill.sourceType}) ${files} ${bytes} ${skill.rootPath}`,
    );
  }
  console.log(
    `Dynamic tools: ${result.dynamicTools.length === 0 ? "none" : result.dynamicTools.join(", ")}`,
  );
  console.log(
    `Contributed env: ${result.contributedEnv.length === 0 ? "none" : result.contributedEnv.join(", ")}`,
  );
}

export function registerContextCommand(
  parent: Command,
  getUrl: () => string,
): void {
  parent
    .command("context [id]")
    .description(
      "Show the latest recorded context window usage and available breakdown",
    )
    .option("--self", "Use the current thread")
    .option(
      "--instructions",
      "Print the assembled BB instructions sent to the provider with per-group sizes",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (
          id: string | undefined,
          opts: { self?: boolean; instructions?: boolean; json?: boolean },
        ) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const sdk = createCliBbSdk(getUrl());
          const result = await sdk.threads.context({ threadId });
          if (!opts.instructions) {
            if (outputJson(opts, result)) return;
            printUsage(result.usage);
            return;
          }
          const instructions = await sdk.threads.contextInstructions({
            threadId,
          });
          if (outputJson(opts, { ...instructions, usage: result.usage }))
            return;
          printInstructions(instructions);
          console.log("");
          printUsage(result.usage);
        },
      ),
    );
}
