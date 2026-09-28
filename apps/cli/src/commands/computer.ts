import { randomUUID } from "node:crypto";
import { Command } from "commander";
import type { ComputerRunMode } from "@bb/server-contract";
import { computerOperationSchema } from "@bb/host-daemon-contract";
import { action } from "../action.js";
import { CliUsageError } from "../cli-usage-error.js";
import { createCliBbSdk } from "../client.js";
import { resolveContextThreadId } from "../context-env.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

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

interface PreviewOptions extends HostOptions {
  viewer: string;
  size: string;
  afterSequence?: string;
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

function parseAfterSequence(value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    usageError("--after-sequence must be a non-negative integer");
  }
  return parsed;
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
        "Check Cua Driver readiness on a machine (binary, daemon, accessibility, windows)",
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
        "Install the pinned Cua Driver on a machine if it is missing, then report readiness",
      )
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: HostOptions) => {
      if (!opts.json) console.log("Installing Cua Driver...");
      const report = await createCliBbSdk(getUrl()).computer.installDriver({
        hostId: opts.host,
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
      .command("preview")
      .description("Poll the machine's live preview stream for a frame after a given sequence")
      .requiredOption("--viewer <id>", "Stable viewer ID for this preview session")
      .option("--size <thumbnail|full>", "Frame size", "thumbnail")
      .option(
        "--after-sequence <n>",
        "Only return a frame newer than this sequence (omit for the latest)",
      )
      .option("--json", "Print machine-readable JSON output"),
  ).action(
    action(async (opts: PreviewOptions) => {
      const size = opts.size === "full" ? "full" : "thumbnail";
      const frame = await createCliBbSdk(getUrl()).computer.preview({
        hostId: opts.host,
        viewerId: opts.viewer,
        size,
        afterSequence: parseAfterSequence(opts.afterSequence),
      });
      if (outputJson(opts, frame)) return;
      console.log(JSON.stringify(frame, null, 2));
    }),
  );
}
