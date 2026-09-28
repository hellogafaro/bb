import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  hostContract,
  rpcContract,
  type ActionOutcome,
  type DoctorReport,
  type Observation,
  type Operation,
  type RunStatus,
  type StartInput,
} from "./contracts.js";
import { controlGateForHost } from "./control-gate.js";
import { copyIntoEvidence, threadStorageLocation, writeEvidence } from "./evidence.js";
import {
  JevDecisionProvider,
  OpenRouterTextGenerator,
  operationChoices,
  targetChoices,
  toOperation,
  type DecisionProvider,
} from "./decision.js";

interface RunRecord {
  status: RunStatus;
  abort: AbortController;
}

export default async function computerPlugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({ contract: hostContract });
  const runs = new Map<string, RunRecord>();
  const lifecycle = new AbortController();

  const settings = bb.settings.define({
    typesafeApiKey: { type: "string", label: "TypeSafe API key", secret: true },
    typesafeEndpoint: {
      type: "string",
      label: "TypeSafe System One endpoint",
      default: "https://api.typesafe.ai/v1/systemone",
    },
    typesafeModel: { type: "string", label: "TypeSafe Jev model", default: "jev-1" },
    openrouterApiKey: { type: "string", label: "OpenRouter API key", secret: true },
    openrouterModel: { type: "string", label: "OpenRouter model for typed text", default: "openai/gpt-4o-mini" },
  });

  async function listMachines(threadId: string | undefined) {
    const hosts = await bb.sdk.hosts.list();
    const currentHostId =
      threadId === undefined
        ? null
        : await bb.sdk.threads
            .get({ threadId, include: "host" })
            .then((thread) => ("host" in thread ? (thread.host?.id ?? null) : null))
            .catch(() => null);
    return {
      machines: hosts.map((entry) => ({
        hostId: entry.id,
        name: entry.name,
        status: entry.status,
        type: entry.type,
        lastSeenAt: entry.lastSeenAt,
      })),
      currentHostId,
    };
  }

  async function doctor(hostId: string, signal: AbortSignal): Promise<DoctorReport> {
    const report = await host.call("doctor", {}, { hostId, signal });
    return { hostId, ...report };
  }

  async function observe(hostId: string, appId: string | undefined, signal: AbortSignal): Promise<Observation> {
    const observation = await host.call("observe", { appId }, { hostId, signal });
    return { hostId, ...observation };
  }

  async function act(hostId: string, action: Operation, signal: AbortSignal): Promise<ActionOutcome> {
    const outcome = await controlGateForHost(hostId).runAgent(signal, () => host.call("act", { action }, { hostId, signal }));
    return {
      state: outcome.state,
      summary: outcome.summary,
      observation: outcome.observation === null ? null : { hostId, ...outcome.observation },
    };
  }

  async function screenshot(hostId: string, threadId: string, appId: string | undefined, signal: AbortSignal) {
    const image = await host.call("capture", { kind: appId === undefined ? "desktop" : "window", appId }, { hostId, signal });
    const extension = image.mimeType === "image/png" ? "png" : "jpg";
    const path = await writeEvidence(bb, threadId, "adhoc", `screenshot-${Date.now()}.${extension}`, image.dataBase64);
    return { path, mimeType: image.mimeType };
  }

  async function record(hostId: string, threadId: string, action: "start" | "stop", runId: string, signal: AbortSignal) {
    if (action === "start") {
      await host.call("recordStart", { runId }, { hostId, signal });
      return { recording: true, path: null, trajectoryPath: null };
    }
    const result = await host.call("recordStop", { runId }, { hostId, signal });
    const videoPath = result.videoPath === null
      ? null
      : await copyIntoEvidence(bb, threadId, runId, "recording.mp4", hostId, result.videoPath);
    return { recording: false, path: videoPath, trajectoryPath: result.trajectoryPath };
  }

  function requireRun(runId: string): RunRecord {
    const run = runs.get(runId);
    if (run === undefined) throw new Error(`Unknown run ${runId}`);
    return run;
  }

  const TERMINAL_STATES = new Set(["done", "cancelled", "error"]);
  const activeRunByHost = new Map<string, string>();

  function touchRun(run: RunRecord, patch: Partial<RunStatus>): void {
    run.status = { ...run.status, ...patch, updatedAt: Date.now() };
    if (TERMINAL_STATES.has(run.status.state) && activeRunByHost.get(run.status.hostId) === run.status.runId) {
      activeRunByHost.delete(run.status.hostId);
    }
  }

  async function runJevLoop(run: RunRecord, input: StartInput, provider: DecisionProvider, textGenerator: OpenRouterTextGenerator | null) {
    const signal = run.abort.signal;
    const recentSummaries: string[] = [];
    let noProgress = 0;
    touchRun(run, { state: "observing" });
    try {
      while (run.status.steps < input.maxSteps && !signal.aborted) {
        const observation = await observe(input.hostId, undefined, signal);
        touchRun(run, { state: "deciding" });
        const opChoices = operationChoices(input.allowedOperations, observation.targets);
        if (opChoices.length === 0) {
          touchRun(run, { state: "blocked", lastSummary: "No allowed operation matches the current target table" });
          return;
        }
        const decision = await provider.decide(
          {
            goal: input.goal,
            observation,
            recentSummaries,
            operationChoices: opChoices,
            targetChoices: opChoices.some((choice) => choice.choiceId === "click" || choice.choiceId === "type")
              ? targetChoices(observation.targets, (opChoices[0]?.choiceId ?? "click") as never)
              : [],
          },
          signal,
        );
        if (decision.confidence !== null && decision.confidence < 0.35) {
          touchRun(run, { state: "escalated", lastSummary: `Low confidence (${decision.confidence.toFixed(2)}); escalating to the agent` });
          return;
        }
        let typedText: string | null = null;
        if (decision.operationChoiceId === "type" && textGenerator !== null) {
          typedText = await textGenerator.generate(
            `Goal: ${input.goal}\nWrite only the exact text to type into the target field. No quotes, no explanation.`,
            signal,
          );
        }
        const operation = toOperation(decision, observation, typedText);
        touchRun(run, { state: "acting" });
        const outcome = await act(input.hostId, operation, signal);
        run.status.steps += 1;
        recentSummaries.push(outcome.summary);
        if (recentSummaries.length > 5) recentSummaries.shift();
        if (outcome.state === "completed" && outcome.observation?.snapshotId === observation.snapshotId) {
          noProgress += 1;
        } else {
          noProgress = 0;
        }
        touchRun(run, { lastSummary: outcome.summary, noProgressSteps: noProgress });
        if (operation.kind === "done") {
          touchRun(run, { state: "done" });
          return;
        }
        if (operation.kind === "blocked" || outcome.state === "blocked") {
          touchRun(run, { state: "blocked" });
          return;
        }
        if (noProgress >= 3) {
          touchRun(run, { state: "escalated", lastSummary: "No progress after 3 steps; escalating to the agent" });
          return;
        }
      }
      if (!signal.aborted) touchRun(run, { state: "escalated", lastSummary: "Reached the step limit; escalating to the agent" });
    } catch (error) {
      if (!signal.aborted) touchRun(run, { state: "error", lastSummary: error instanceof Error ? error.message : String(error) });
    }
  }

  async function start(input: StartInput): Promise<RunStatus> {
    const runId = randomUUID();
    const abort = new AbortController();
    const base: RunStatus = {
      runId,
      hostId: input.hostId,
      mode: input.mode,
      goal: input.goal,
      state: "idle",
      steps: 0,
      noProgressSteps: 0,
      lastSummary: null,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    const run: RunRecord = { status: base, abort };
    runs.set(runId, run);
    activeRunByHost.set(input.hostId, runId);
    if (input.mode === "agent") {
      touchRun(run, { state: "escalated", lastSummary: "Agent mode: drive this goal with computer_observe/computer_act, then report computer_status." });
      return run.status;
    }
    const { typesafeApiKey, typesafeEndpoint, typesafeModel, openrouterApiKey, openrouterModel } = await settings.get();
    if (typesafeApiKey === undefined || typesafeApiKey.trim().length === 0) {
      touchRun(run, {
        mode: "agent",
        state: "escalated",
        lastSummary: "No TypeSafe API key is configured for this plugin; falling back to agent mode. Drive this goal with computer_observe/computer_act.",
      });
      return run.status;
    }
    const provider = new JevDecisionProvider({ endpoint: typesafeEndpoint, model: typesafeModel, apiKey: typesafeApiKey });
    const textGenerator =
      openrouterApiKey !== undefined && openrouterApiKey.trim().length > 0
        ? new OpenRouterTextGenerator({ model: openrouterModel, apiKey: openrouterApiKey })
        : null;
    void runJevLoop(run, input, provider, textGenerator);
    return run.status;
  }

  bb.rpc.register(rpcContract, {
    machines: async ({ threadId }) => listMachines(threadId),
    doctor: async ({ hostId }) => doctor(hostId, lifecycle.signal),
    observe: async ({ hostId, appId }) => observe(hostId, appId, lifecycle.signal),
    act: async ({ hostId, action }) => act(hostId, action, lifecycle.signal),
    screenshot: async ({ hostId, threadId, appId }) => screenshot(hostId, threadId, appId, lifecycle.signal),
    record: async ({ hostId, threadId, action, runId }) => record(hostId, threadId, action, runId, lifecycle.signal),
    start: async (input) => start(input),
    status: async ({ runId }) => requireRun(runId).status,
    cancel: async ({ runId }) => {
      const run = requireRun(runId);
      run.abort.abort();
      touchRun(run, { state: "cancelled" });
      return run.status;
    },
    activeRun: async ({ hostId }) => ({ runId: activeRunByHost.get(hostId) ?? null }),
    takeControl: async ({ hostId, clientId }) => ({ owner: await controlGateForHost(hostId).acquire(clientId, lifecycle.signal) }),
    releaseControl: async ({ hostId, clientId }) => ({ released: controlGateForHost(hostId).release(clientId) }),
    controlStatus: async ({ hostId, clientId }) => ({ owner: controlGateForHost(hostId).statusFor(clientId) }),
    preview: async ({ hostId, viewerId, size, afterSequence }) => {
      await host.call("previewTouch", { viewerId, size }, { hostId, signal: lifecycle.signal });
      return host.call("previewLatest", { afterSequence }, { hostId, signal: lifecycle.signal });
    },
  });

  bb.agents.registerTool({
    name: "computer_machines",
    description: "List machines this thread can observe or control with the Computer plugin.",
    parameters: z.object({}),
    async execute(_input, ctx) {
      return JSON.stringify(await listMachines(ctx.threadId));
    },
  });
  bb.agents.registerTool({
    name: "computer_doctor",
    description: "Check Cua Driver readiness on a machine (binary, daemon, accessibility, windows).",
    parameters: z.object({ hostId: z.string().min(1) }),
    async execute({ hostId }, ctx) {
      return JSON.stringify(await doctor(hostId, ctx.signal));
    },
  });
  bb.agents.registerTool({
    name: "computer_observe",
    description:
      "Return the current target table (indexed clickable/typable elements with bounds) for the active window on a machine, or a named app.",
    parameters: z.object({ hostId: z.string().min(1), appId: z.string().max(160).optional() }),
    async execute({ hostId, appId }, ctx) {
      return JSON.stringify(await observe(hostId, appId, ctx.signal));
    },
  });
  bb.agents.registerTool({
    name: "computer_act",
    description:
      "Perform one operation (click/double_click/type/set_value/select/scroll/hotkey/wait) against a targetId from the latest computer_observe, identified by its snapshotId. Re-observe after acting.",
    parameters: z.object({ hostId: z.string().min(1), action: rpcContract.act.input.shape.action }),
    async execute({ hostId, action }, ctx) {
      return JSON.stringify(await act(hostId, action, ctx.signal));
    },
  });
  bb.agents.registerTool({
    name: "computer_screenshot",
    description: "Capture a screenshot of the machine's desktop (or a named app's window) into this thread's storage.",
    parameters: z.object({ hostId: z.string().min(1), appId: z.string().max(160).optional() }),
    async execute({ hostId, appId }, ctx) {
      return JSON.stringify(await screenshot(hostId, ctx.threadId, appId, ctx.signal));
    },
  });
  bb.agents.registerTool({
    name: "computer_record",
    description: "Start or stop a screen recording for a run; the finished MP4 and trajectory land in this thread's storage.",
    parameters: z.object({ hostId: z.string().min(1), action: z.enum(["start", "stop"]), runId: z.string().uuid() }),
    async execute({ hostId, action, runId }, ctx) {
      return JSON.stringify(await record(hostId, ctx.threadId, action, runId, ctx.signal));
    },
  });
  bb.agents.registerTool({
    name: "computer_start",
    description:
      "Start a goal-driven run on a machine. In agent mode (default, and the only mode without a configured TypeSafe key) this immediately escalates: drive the goal yourself with computer_observe/computer_act and report computer_status. In jev mode it runs a typed-choice decision loop in the background.",
    parameters: rpcContract.start.input,
    async execute(input) {
      return JSON.stringify(await start(input));
    },
  });
  bb.agents.registerTool({
    name: "computer_status",
    description: "Read a run's status (state, step count, last action summary).",
    parameters: z.object({ runId: z.string().uuid() }),
    async execute({ runId }) {
      return JSON.stringify(requireRun(runId).status);
    },
  });
  bb.agents.registerTool({
    name: "computer_cancel",
    description: "Cancel a run.",
    parameters: z.object({ runId: z.string().uuid() }),
    async execute({ runId }) {
      const run = requireRun(runId);
      run.abort.abort();
      touchRun(run, { state: "cancelled" });
      return JSON.stringify(run.status);
    },
  });
  bb.agents.configure(() => ({
    tools: [
      "computer_machines",
      "computer_doctor",
      "computer_observe",
      "computer_act",
      "computer_screenshot",
      "computer_record",
      "computer_start",
      "computer_status",
      "computer_cancel",
    ],
    skills: ["computer"],
  }));

  const usage = [
    "Usage:",
    "  bb computer machines [--json]",
    "  bb computer doctor --host <id> [--json]",
    "  bb computer observe --host <id> [--app <name>] [--json]",
    "  bb computer act --host <id> --action <json> [--json]",
    "  bb computer screenshot --host <id> [--app <name>] --thread <id> [--json]",
    "  bb computer record --host <id> --thread <id> --action start|stop --run <id> [--json]",
    "  bb computer start --host <id> --goal <text> [--mode agent|jev] [--json]",
    "  bb computer status --run <id> [--json]",
    "  bb computer cancel --run <id> [--json]",
  ].join("\n");
  function flag(args: string[], name: string): string | undefined {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? undefined : args[index + 1];
  }
  bb.cli.register({
    name: "computer",
    summary: "Observe and control a machine through the Computer plugin",
    commands: [
      { name: "machines", summary: "List machines", usage: "bb computer machines [--json]" },
      { name: "doctor", summary: "Check Cua Driver readiness", usage: "bb computer doctor --host <id>" },
      { name: "observe", summary: "Read the target table", usage: "bb computer observe --host <id> [--app <name>]" },
      { name: "act", summary: "Perform one operation", usage: "bb computer act --host <id> --action <json>" },
      { name: "screenshot", summary: "Capture a screenshot into thread storage", usage: "bb computer screenshot --host <id> --thread <id>" },
      { name: "record", summary: "Start or stop a recording", usage: "bb computer record --host <id> --thread <id> --action start|stop --run <id>" },
      { name: "start", summary: "Start a goal-driven run", usage: "bb computer start --host <id> --goal <text>" },
      { name: "status", summary: "Read a run's status", usage: "bb computer status --run <id>" },
      { name: "cancel", summary: "Cancel a run", usage: "bb computer cancel --run <id>" },
    ],
    async run(argv, ctx) {
      const signal = ctx.signal ?? lifecycle.signal;
      const json = argv.includes("--json");
      const args = argv.filter((arg) => arg !== "--json");
      const [command] = args;
      const reply = (value: unknown) => ({ exitCode: 0, stdout: json ? JSON.stringify(value) : JSON.stringify(value, null, 2) });
      const hostId = flag(args, "host");
      const threadId = flag(args, "thread") ?? ctx.threadId;
      try {
        switch (command) {
          case undefined:
          case "help":
          case "--help":
            return { exitCode: 0, stdout: usage };
          case "machines":
            return reply(await listMachines(threadId));
          case "doctor":
            if (hostId === undefined) return { exitCode: 1, stderr: "computer doctor requires --host <id>" };
            return reply(await doctor(hostId, signal));
          case "observe":
            if (hostId === undefined) return { exitCode: 1, stderr: "computer observe requires --host <id>" };
            return reply(await observe(hostId, flag(args, "app"), signal));
          case "act": {
            if (hostId === undefined) return { exitCode: 1, stderr: "computer act requires --host <id>" };
            const raw = flag(args, "action");
            if (raw === undefined) return { exitCode: 1, stderr: "computer act requires --action <json>" };
            const action = rpcContract.act.input.shape.action.parse(JSON.parse(raw));
            return reply(await act(hostId, action, signal));
          }
          case "screenshot":
            if (hostId === undefined || threadId === undefined) return { exitCode: 1, stderr: "computer screenshot requires --host <id> and a thread (--thread <id> outside a thread)" };
            return reply(await screenshot(hostId, threadId, flag(args, "app"), signal));
          case "record": {
            if (hostId === undefined || threadId === undefined) return { exitCode: 1, stderr: "computer record requires --host <id> and a thread (--thread <id> outside a thread)" };
            const recordAction = flag(args, "action") === "stop" ? "stop" : "start";
            const runId = flag(args, "run");
            if (runId === undefined) return { exitCode: 1, stderr: "computer record requires --run <id>" };
            return reply(await record(hostId, threadId, recordAction, runId, signal));
          }
          case "start": {
            if (hostId === undefined) return { exitCode: 1, stderr: "computer start requires --host <id>" };
            const goal = flag(args, "goal");
            if (goal === undefined) return { exitCode: 1, stderr: "computer start requires --goal <text>" };
            const mode = flag(args, "mode") === "jev" ? "jev" : "agent";
            return reply(await start({ hostId, goal, allowedApps: [], maxSteps: 40, mode }));
          }
          case "status": {
            const runId = flag(args, "run");
            if (runId === undefined) return { exitCode: 1, stderr: "computer status requires --run <id>" };
            return reply(requireRun(runId).status);
          }
          case "cancel": {
            const runId = flag(args, "run");
            if (runId === undefined) return { exitCode: 1, stderr: "computer cancel requires --run <id>" };
            const run = requireRun(runId);
            run.abort.abort();
            touchRun(run, { state: "cancelled" });
            return reply(run.status);
          }
          default:
            return { exitCode: 1, stderr: usage };
        }
      } catch (error) {
        return { exitCode: 1, stderr: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  bb.onDispose(() => {
    lifecycle.abort();
    for (const run of runs.values()) run.abort.abort();
  });
}
