import { randomUUID } from "node:crypto";
import { Command } from "commander";
import type { BbSdk } from "@bb/sdk/node";
import type { ComputerRunMode } from "@bb/server-contract";
import {
  computerHumanInputSchema,
  computerOperationSchema,
  type ComputerHumanInput,
} from "@bb/host-daemon-contract";
import { action } from "../action.js";
import { CliUsageError } from "../cli-usage-error.js";
import { createCliBbSdk } from "../client.js";
import { resolveContextThreadId } from "../context-env.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

type ComputerLiveConnection = ReturnType<BbSdk["computer"]["live"]>;

interface HostOptions extends JsonOutputOptions {
  host: string;
}

interface ObserveOptions extends HostOptions {
  app?: string;
}

interface ActOptions extends HostOptions {
  action: string;
}

interface ScreenshotOptions extends HostOptions {
  app?: string;
  thread?: string;
}

interface RecordOptions extends HostOptions {
  thread?: string;
  action: string;
  run?: string;
}

interface StartOptions extends HostOptions {
  goal: string;
  mode: string;
  app: string[];
  maxSteps: string;
}

interface RunOptions extends JsonOutputOptions {
  run: string;
}

interface ControlOptions extends HostOptions {
  client: string;
}

interface InputOptions extends ControlOptions {
  input: string;
}

interface ClipboardOptions extends ControlOptions {
  action: string;
  text?: string;
  paste?: boolean;
}

function usageError(message: string, hint: string | null = null): never {
  throw new CliUsageError({ code: "invalid_value", hint, message });
}

function requireThread(explicit: string | undefined): string {
  const threadId = explicit ?? resolveContextThreadId();
  if (threadId === undefined) {
    usageError(
      "Missing thread ID.",
      "Pass --thread <id> outside a thread environment.",
    );
  }
  return threadId;
}

function parseMode(value: string): ComputerRunMode {
  return value === "jev" ? "jev" : "agent";
}

function parseAction(raw: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    usageError("--action must be a JSON object");
  }
  const result = computerOperationSchema.safeParse(parsed);
  if (!result.success) {
    usageError(`--action does not match an operation: ${result.error.message}`);
  }
  return result.data;
}

function parseMaxSteps(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    usageError("--max-steps must be a positive integer");
  }
  return parsed;
}

function parseHumanInput(raw: string): ComputerHumanInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    usageError("--input must be a JSON object");
  }
  const result = computerHumanInputSchema.safeParse(parsed);
  if (!result.success) {
    usageError(`--input does not match a human input: ${result.error.message}`);
  }
  return result.data;
}

async function withLiveConnection<T>(
  url: string,
  args: { hostId: string; clientId: string },
  run: (connection: ComputerLiveConnection) => Promise<T>,
): Promise<T> {
  const connection = createCliBbSdk(url).computer.live({
    hostId: args.hostId,
    clientId: args.clientId,
    profile: "thumbnail",
  });
  try {
    await connection.opened;
    return await run(connection);
  } finally {
    connection.close();
  }
}

function hostOption(command: Command): Command {
  return command.requiredOption("--host <id>", "Machine host ID");
}

export function registerComputerCommands(
  program: Command,
  getUrl: () => string,
): void {
  const computer = program
    .command("computer")
    .description(
      "Observe and control a machine's desktop: screenshots, clicks, typing, recordings, and goal-driven runs",
    );

  computer
    .command("machines")
    .description("List machines this thread can observe or control")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOutputOptions) => {
        const result = await createCliBbSdk(getUrl()).computer.machines({
          threadId: resolveContextThreadId(),
        });
        if (outputJson(opts, result)) return;
        console.log(
          result.machines.length === 0
            ? "No machines."
            : result.machines
                .map(
                  (entry) =>
                    `${entry.hostId}  ${entry.name}  ${entry.type}  ${entry.status}${entry.hostId === result.currentHostId ? "  (current)" : ""}`,
                )
                .join("\n"),
        );
      }),
    );

  hostOption(
    computer
      .command("doctor")
      .description(
        "Check the bb computer driver readiness on a machine (binary, daemon, accessibility, windows)",
      )
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: HostOptions) => {
      const report = await createCliBbSdk(getUrl()).computer.doctor({
        hostId: opts.host,
      });
      if (outputJson(opts, report)) return;
      console.log(JSON.stringify(report, null, 2));
    }),
  );

  hostOption(
    computer
      .command("setup")
      .description(
        "Install the bb computer driver on a machine if it is missing, then report readiness",
      )
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: HostOptions) => {
      if (!opts.json) console.log("Installing the bb computer driver...");
      const report = await createCliBbSdk(getUrl()).computer.installDriver({
        hostId: opts.host,
      });
      if (outputJson(opts, report)) return;
      console.log(JSON.stringify(report, null, 2));
    }),
  );

  hostOption(
    computer
      .command("permissions")
      .description(
        "Ask a macOS machine to grant Accessibility or Screen Recording to the bb computer driver, then report readiness",
      )
      .option("--permission <id>", "Which permission to open: accessibility or screen-recording (default: the first missing one)")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: HostOptions & { permission?: string }) => {
      const permission = opts.permission;
      if (permission !== undefined && permission !== "accessibility" && permission !== "screen-recording") {
        throw new Error("--permission must be accessibility or screen-recording");
      }
      if (!opts.json) console.log("Requesting permissions on the machine...");
      const report = await createCliBbSdk(getUrl()).computer.requestPermissions({
        hostId: opts.host,
        permission,
      });
      if (outputJson(opts, report)) return;
      console.log(JSON.stringify(report, null, 2));
    }),
  );

  hostOption(
    computer
      .command("observe")
      .description(
        "Read the target table (clickable/typable elements) for the active window, or a named app",
      )
      .option("--app <name>", "Only observe the first window matching this app name")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: ObserveOptions) => {
      const observation = await createCliBbSdk(getUrl()).computer.observe({
        hostId: opts.host,
        ...(opts.app ? { appId: opts.app } : {}),
      });
      if (outputJson(opts, observation)) return;
      console.log(JSON.stringify(observation, null, 2));
    }),
  );

  hostOption(
    computer
      .command("act")
      .description(
        "Perform one operation (click, type, scroll, ...) against a targetId from the latest observe",
      )
      .requiredOption(
        "--action <json>",
        'The operation as JSON, e.g. \'{"kind":"click","targetId":"3","snapshotId":"..."}\'',
      )
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: ActOptions) => {
      const outcome = await createCliBbSdk(getUrl()).computer.act({
        hostId: opts.host,
        action: parseAction(opts.action),
      });
      if (outputJson(opts, outcome)) return;
      console.log(JSON.stringify(outcome, null, 2));
    }),
  );

  hostOption(
    computer
      .command("screenshot")
      .description("Capture a screenshot of the desktop (or a named app's window) into thread storage")
      .option("--app <name>", "Capture a named app's window instead of the full desktop")
      .option("--thread <id>", "Thread to store the screenshot in (defaults to BB_THREAD_ID)")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: ScreenshotOptions) => {
      const threadId = requireThread(opts.thread);
      const result = await createCliBbSdk(getUrl()).computer.screenshot({
        hostId: opts.host,
        threadId,
        ...(opts.app ? { appId: opts.app } : {}),
      });
      if (outputJson(opts, result)) return;
      console.log(`${result.path}  (${result.mimeType})`);
    }),
  );

  hostOption(
    computer
      .command("record")
      .description("Start or stop a screen recording for a run")
      .option("--thread <id>", "Thread to store the recording in (defaults to BB_THREAD_ID)")
      .requiredOption("--action <start|stop>", "start or stop the recording")
      .option("--run <id>", "Run ID (UUID) to record under (generated and printed if omitted)")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: RecordOptions) => {
      const threadId = requireThread(opts.thread);
      const recordAction = opts.action === "stop" ? "stop" : "start";
      const runId = opts.run ?? randomUUID();
      if (opts.run === undefined && !opts.json) console.log(`Run ID: ${runId}`);
      const result = await createCliBbSdk(getUrl()).computer.record({
        hostId: opts.host,
        threadId,
        action: recordAction,
        runId,
      });
      if (outputJson(opts, { runId, ...result })) return;
      console.log(JSON.stringify(result, null, 2));
    }),
  );

  hostOption(
    computer
      .command("start")
      .description("Start a goal-driven run on a machine")
      .requiredOption("--goal <text>", "The goal to pursue")
      .option(
        "--mode <agent|jev>",
        "agent (default; escalates immediately) or jev (typed-choice decision loop, needs a configured TypeSafe key)",
        "agent",
      )
      .option(
        "--app <name>",
        "Allowed app the run may touch; repeat for more (omit for no restriction)",
        (value: string, previous: string[]) => [...previous, value],
        [],
      )
      .option("--max-steps <n>", "Maximum steps before the run escalates", "40")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: StartOptions) => {
      const status = await createCliBbSdk(getUrl()).computer.start({
        hostId: opts.host,
        goal: opts.goal,
        allowedApps: opts.app,
        maxSteps: parseMaxSteps(opts.maxSteps),
        mode: parseMode(opts.mode),
      });
      if (outputJson(opts, status)) return;
      console.log(JSON.stringify(status, null, 2));
    }),
  );

  computer
    .command("status")
    .description("Read a run's status")
    .requiredOption("--run <id>", "Run ID (UUID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: RunOptions) => {
        const status = await createCliBbSdk(getUrl()).computer.status({
          runId: opts.run,
        });
        if (outputJson(opts, status)) return;
        console.log(JSON.stringify(status, null, 2));
      }),
    );

  computer
    .command("cancel")
    .description("Cancel a run")
    .requiredOption("--run <id>", "Run ID (UUID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: RunOptions) => {
        const status = await createCliBbSdk(getUrl()).computer.cancel({
          runId: opts.run,
        });
        if (outputJson(opts, status)) return;
        console.log(JSON.stringify(status, null, 2));
      }),
    );

  hostOption(
    computer
      .command("active-run")
      .description("Read the active run ID for a machine, if any")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: HostOptions) => {
      const result = await createCliBbSdk(getUrl()).computer.activeRun({
        hostId: opts.host,
      });
      if (outputJson(opts, result)) return;
      console.log(result.runId ?? "No active run.");
    }),
  );

  hostOption(
    computer
      .command("take-control")
      .description("Take human control of a machine, pausing agent actions until released")
      .requiredOption("--client <id>", "Stable client ID identifying who is taking control")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: ControlOptions) => {
      const result = await createCliBbSdk(getUrl()).computer.takeControl({
        hostId: opts.host,
        clientId: opts.client,
      });
      if (outputJson(opts, result)) return;
      console.log(result.owner);
    }),
  );

  hostOption(
    computer
      .command("release-control")
      .description("Release human control of a machine")
      .requiredOption("--client <id>", "Same client ID passed to take-control")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: ControlOptions) => {
      const result = await createCliBbSdk(getUrl()).computer.releaseControl({
        hostId: opts.host,
        clientId: opts.client,
      });
      if (outputJson(opts, result)) return;
      console.log(result.released ? "Released." : "Not held by this client.");
    }),
  );

  hostOption(
    computer
      .command("control-status")
      .description("Check who currently controls a machine")
      .requiredOption("--client <id>", "Client ID to check control from")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: ControlOptions) => {
      const result = await createCliBbSdk(getUrl()).computer.controlStatus({
        hostId: opts.host,
        clientId: opts.client,
      });
      if (outputJson(opts, result)) return;
      console.log(result.owner);
    }),
  );

  hostOption(
    computer
      .command("input")
      .description(
        "Send one human input (click, drag, scroll, move, type, key) to a machine over its live view; requires holding control via take-control first",
      )
      .requiredOption("--client <id>", "Same client ID passed to take-control")
      .requiredOption(
        "--input <json>",
        'The input as JSON, e.g. \'{"kind":"click","frame":{"width":1280,"height":800},"x":100,"y":200,"button":"left","count":1,"modifiers":[]}\'',
      )
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: InputOptions) => {
      const input = parseHumanInput(opts.input);
      await withLiveConnection(getUrl(), { hostId: opts.host, clientId: opts.client }, (connection) =>
        connection.perform(input),
      );
      if (outputJson(opts, { sent: true })) return;
      console.log("Sent.");
    }),
  );

  hostOption(
    computer
      .command("clipboard")
      .description("Read or write the machine's clipboard over its live view; requires holding control via take-control first")
      .requiredOption("--client <id>", "Same client ID passed to take-control")
      .requiredOption("--action <read|write>", "read or write the machine clipboard")
      .option("--text <value>", "Text to write (required for --action write)")
      .option("--paste", "Also press the platform paste shortcut after writing")
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: ClipboardOptions) => {
      if (opts.action !== "read" && opts.action !== "write") {
        usageError("--action must be read or write");
      }
      if (opts.action === "write" && opts.text === undefined) {
        usageError("--text is required for --action write");
      }
      const result = await withLiveConnection(
        getUrl(),
        { hostId: opts.host, clientId: opts.client },
        async (connection) => {
          if (opts.action === "read") {
            return { text: await connection.readClipboard() };
          }
          await connection.writeClipboard(opts.text ?? "", { paste: opts.paste === true });
          return { written: true };
        },
      );
      if (outputJson(opts, result)) return;
      console.log(JSON.stringify(result, null, 2));
    }),
  );
}
