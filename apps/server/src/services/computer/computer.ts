import { randomUUID } from "node:crypto";
import { getEnvironment, getThread } from "@bb/db";
import { COMMAND_TIMEOUT_MS, COMPUTER_DRIVER_INSTALL_TIMEOUT_MS } from "../../constants.js";
import type { WorkSessionDeps } from "../../types.js";
import {
  listPublicHostsWithStatus,
  requireNonDestroyedHostWithStatus,
  requirePublicThread,
} from "../lib/entity-lookup.js";
import { callHostOnlineRpcForWork } from "../hosts/online-rpc.js";
import { controlGateForHost } from "./control-gate.js";
import { ComputerLiveHub } from "./live.js";
import { copyIntoEvidence, writeEvidence } from "./evidence.js";
import {
  createDecisionBackend,
  EscalateToAgentError,
  type DecisionRequest,
  type DecisionResponse,
  operationChoices,
  postActionWaitMs,
  toOperation,
  validateTypedText,
  verifyTargetFresh,
  type DecisionProvider,
} from "./decision.js";
import type {
  ComputerActionOutcome as ActionOutcome,
  ComputerDoctorReport as DoctorReport,
  ComputerMachineSummary as MachineSummary,
  ComputerObservation as Observation,
  ComputerRunStatus as RunStatus,
  ComputerStartRequest as StartInput,
} from "@bb/server-contract";
import type {
  ComputerHumanInput,
  ComputerOperation as Operation,
} from "@bb/host-daemon-contract";

export interface RunRecord {
  status: RunStatus;
  abort: AbortController;
}

const runs = new Map<string, RunRecord>();
const activeRunByHost = new Map<string, string>();
const TERMINAL_STATES = new Set(["done", "cancelled", "error"]);
const activeRunListeners = new Set<(hostId: string) => void>();

export function onActiveRunChange(listener: (hostId: string) => void): () => void {
  activeRunListeners.add(listener);
  return () => activeRunListeners.delete(listener);
}

function emitActiveRunChange(hostId: string): void {
  for (const listener of [...activeRunListeners]) listener(hostId);
}

function currentHostIdForThread(
  deps: WorkSessionDeps,
  threadId: string,
): string | null {
  const thread = getThread(deps.db, threadId);
  if (thread === null || thread.environmentId === null) return null;
  const environment = getEnvironment(deps.db, thread.environmentId);
  return environment?.hostId ?? null;
}

export async function listMachines(
  deps: WorkSessionDeps,
  threadId: string | undefined,
): Promise<{ machines: MachineSummary[]; currentHostId: string | null }> {
  const hosts = listPublicHostsWithStatus(deps);
  return {
    machines: hosts.map((host) => ({
      hostId: host.id,
      name: host.name,
      status: host.status,
      type: host.type,
      lastSeenAt: host.lastSeenAt,
    })),
    currentHostId:
      threadId === undefined ? null : currentHostIdForThread(deps, threadId),
  };
}

export async function doctor(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<DoctorReport> {
  requireNonDestroyedHostWithStatus(deps, hostId);
  const report = await callHostOnlineRpcForWork(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "computer.doctor" },
  });
  return { hostId, ...report };
}

export async function installDriver(
  deps: WorkSessionDeps,
  hostId: string,
): Promise<DoctorReport> {
  requireNonDestroyedHostWithStatus(deps, hostId);
  const report = await callHostOnlineRpcForWork(deps, {
    hostId,
    timeoutMs: COMPUTER_DRIVER_INSTALL_TIMEOUT_MS,
    command: { type: "computer.install_driver" },
  });
  return { hostId, ...report };
}

export async function requestPermissions(
  deps: WorkSessionDeps,
  hostId: string,
  permission: "accessibility" | "screen-recording" | undefined,
): Promise<DoctorReport> {
  requireNonDestroyedHostWithStatus(deps, hostId);
  const report = await callHostOnlineRpcForWork(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "computer.request_permissions", permission },
  });
  return { hostId, ...report };
}

export async function observe(
  deps: WorkSessionDeps,
  hostId: string,
  appId: string | undefined,
): Promise<Observation> {
  requireNonDestroyedHostWithStatus(deps, hostId);
  const observation = await callHostOnlineRpcForWork(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "computer.observe", appId },
  });
  return { hostId, ...observation };
}

export async function act(
  deps: WorkSessionDeps,
  hostId: string,
  action: Operation,
  signal: AbortSignal,
): Promise<ActionOutcome> {
  requireNonDestroyedHostWithStatus(deps, hostId);
  const outcome = await controlGateForHost(hostId).runAgent(signal, () =>
    callHostOnlineRpcForWork(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { type: "computer.act", action },
    }),
  );
  return {
    state: outcome.state,
    summary: outcome.summary,
    observation:
      outcome.observation === null ? null : { hostId, ...outcome.observation },
  };
}

export async function screenshot(
  deps: WorkSessionDeps,
  hostId: string,
  threadId: string,
  appId: string | undefined,
): Promise<{ path: string; mimeType: "image/jpeg" | "image/png" }> {
  requirePublicThread(deps.db, threadId);
  requireNonDestroyedHostWithStatus(deps, hostId);
  const image = await callHostOnlineRpcForWork(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "computer.capture",
      kind: appId === undefined ? "desktop" : "window",
      appId,
    },
  });
  const storageHostId = currentHostIdForThread(deps, threadId) ?? hostId;
  const extension = image.mimeType === "image/png" ? "png" : "jpg";
  const path = await writeEvidence(
    deps,
    threadId,
    storageHostId,
    "adhoc",
    `screenshot-${Date.now()}.${extension}`,
    image.dataBase64,
  );
  return { path, mimeType: image.mimeType };
}

export async function record(
  deps: WorkSessionDeps,
  hostId: string,
  threadId: string,
  action: "start" | "stop",
  runId: string,
): Promise<{
  recording: boolean;
  path: string | null;
  trajectoryPath: string | null;
}> {
  requirePublicThread(deps.db, threadId);
  requireNonDestroyedHostWithStatus(deps, hostId);
  if (action === "start") {
    await callHostOnlineRpcForWork(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: { type: "computer.record_start", runId },
    });
    return { recording: true, path: null, trajectoryPath: null };
  }
  const result = await callHostOnlineRpcForWork(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "computer.record_stop", runId },
  });
  const storageHostId = currentHostIdForThread(deps, threadId) ?? hostId;
  const videoPath =
    result.videoPath === null
      ? null
      : await copyIntoEvidence(
          deps,
          threadId,
          storageHostId,
          runId,
          "recording.mp4",
          hostId,
          result.videoPath,
        );
  return { recording: false, path: videoPath, trajectoryPath: result.trajectoryPath };
}

function requireRun(runId: string): RunRecord {
  const run = runs.get(runId);
  if (run === undefined) throw new Error(`Unknown run ${runId}`);
  return run;
}

function touchRun(run: RunRecord, patch: Partial<RunStatus>): void {
  run.status = { ...run.status, ...patch, updatedAt: Date.now() };
  if (
    TERMINAL_STATES.has(run.status.state) &&
    activeRunByHost.get(run.status.hostId) === run.status.runId
  ) {
    activeRunByHost.delete(run.status.hostId);
    emitActiveRunChange(run.status.hostId);
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface JevLoopIo {
  readonly observe: typeof observe;
  readonly act: typeof act;
}

const defaultJevLoopIo: JevLoopIo = { observe, act };

const SUBMIT_OPERATIONS = new Set(["type", "set_value", "type_window"]);

// Below this many steps in a row where the window hasn't changed and Jev keeps repeating
// the same action, it is spinning without making progress; escalating quickly here
// (instead of burning the full step budget) is what lets the calling agent take over fast.
const NO_PROGRESS_ESCALATION_STEPS = 5;

async function decideWithRetry(
  provider: DecisionProvider,
  request: DecisionRequest,
  signal: AbortSignal,
): Promise<DecisionResponse> {
  try {
    return await provider.decide(request, signal);
  } catch (error) {
    if (signal.aborted || error instanceof EscalateToAgentError) throw error;
    return provider.decide(request, signal);
  }
}

// Keyed on the window title alone, not the target-table snapshotId: the snapshotId can
// churn from harmless redraw noise (cursor blink, timestamps) even when nothing about the
// window changed, which would mask a real stuck loop. A title change (new tab, new window,
// a dialog opening) is a much more reliable "something changed" signal.
function windowKey(observation: Observation): string {
  return observation.title;
}

function actionKey(operation: Operation): string {
  const clone: Record<string, unknown> = { ...operation };
  delete clone.snapshotId;
  return JSON.stringify(clone);
}

// Keep this bounded but longer than a single stuck-loop window (NO_PROGRESS_ESCALATION_STEPS):
// Jev otherwise re-clicks a control it already used a few steps ago because that outcome
// scrolled out of recent_outcomes, not because it made progress since.
const MAX_RECENT_OUTCOMES = 8;

function targetLabel(observation: Observation, operation: Operation): string | null {
  if (!("targetId" in operation) || operation.targetId === null || operation.targetId === undefined) return null;
  const target = observation.targets.find((candidate) => candidate.targetId === operation.targetId);
  if (target === undefined) return null;
  const name = target.name.trim().length > 0 ? target.name : "(unlabeled)";
  return `'${name}' (${target.role})`;
}

function describeAction(operation: Operation, observation: Observation, typedText: string | null): string {
  const label = targetLabel(observation, operation);
  switch (operation.kind) {
    case "click":
      return `clicked ${label ?? "an element"}`;
    case "double_click":
      return `double-clicked ${label ?? "an element"}`;
    case "type":
      return `typed '${typedText ?? ""}' into ${label ?? "an element"}`;
    case "set_value":
      return `set ${label ?? "an element"} to '${typedText ?? ""}'`;
    case "select":
      return `selected '${typedText ?? ""}' in ${label ?? "an element"}`;
    case "scroll":
      return `scrolled ${label ?? "the window"} ${operation.direction}`;
    case "type_window":
      return `typed '${typedText ?? ""}' into the focused window`;
    case "press_key":
      return `pressed ${operation.key}`;
    case "hotkey":
      return `pressed ${operation.keys.join("+")}`;
    case "focus_window":
      return "brought the window to focus";
    case "wait":
      return "waited for the UI to settle";
    case "done":
      return "marked the goal complete";
    case "blocked":
      return "reported blocked";
  }
}

function describeWindowChange(before: Observation, outcome: ActionOutcome): string {
  if (outcome.state === "error") return `failed: ${outcome.summary}`;
  if (outcome.state === "blocked") return `blocked: ${outcome.summary}`;
  const after = outcome.observation;
  if (after === null) return "no new observation was taken";
  if (after.title !== before.title) return `window changed to '${after.title}'`;
  return "same window, no title change";
}

function describeStepOutcome(
  step: number,
  operation: Operation,
  before: Observation,
  typedText: string | null,
  outcome: ActionOutcome,
  submitted: boolean,
): string {
  const action = describeAction(operation, before, typedText);
  const submitSuffix = submitted ? " and pressed Enter" : "";
  return `step ${step}: ${action}${submitSuffix} -> ${describeWindowChange(before, outcome)}`;
}

function pushTrace(run: RunRecord, entry: RunStatus["trace"][number]): void {
  const trace = [...run.status.trace, entry];
  if (trace.length > 50) trace.shift();
  touchRun(run, { trace });
}

function escalationSummary(run: RunStatus, reason: string): string {
  return `Completed ${run.steps} step(s) toward "${run.goal}". Last action: ${run.lastSummary ?? "none"}. ${reason} Continue from the current observation with computer_observe/computer_act instead of restarting the goal.`;
}

export async function runJevLoop(
  deps: WorkSessionDeps,
  run: RunRecord,
  input: StartInput,
  provider: DecisionProvider,
  io: JevLoopIo = defaultJevLoopIo,
) {
  const signal = run.abort.signal;
  const recentSummaries: string[] = [];
  let noProgress = 0;
  let previousWindowKey: string | null = null;
  let previousActionKey: string | null = null;
  touchRun(run, { state: "observing" });
  try {
    while (run.status.steps < input.maxSteps && !signal.aborted) {
      const observeStart = Date.now();
      let observationResult = await io.observe(deps, input.hostId, undefined);
      const observeMs = Date.now() - observeStart;
      touchRun(run, { state: "deciding", lastObservation: observationResult });
      let operation: Operation | null = null;
      let outcome: ActionOutcome | null = null;
      let lastDecision: DecisionResponse | null = null;
      let typedText: string | null = null;
      let decideMs = 0;
      let actMs = 0;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const opChoices = operationChoices(
          input.allowedOperations,
          observationResult.targets,
        );
        if (opChoices.length === 0) {
          touchRun(run, {
            state: "blocked",
            lastSummary: "No allowed operation matches the current target table",
          });
          return;
        }
        const decideStart = Date.now();
        const decision = await decideWithRetry(
          provider,
          {
            runId: run.status.runId,
            goal: input.goal,
            observation: observationResult,
            recentSummaries: [...recentSummaries],
            operationChoices: opChoices,
          },
          signal,
        );
        decideMs += Date.now() - decideStart;
        lastDecision = decision;
        touchRun(run, {
          jevCostUsd: run.status.jevCostUsd + (decision.costUsd ?? 0),
          jevModel: decision.servedModel ?? run.status.jevModel,
        });
        deps.logger.debug(
          { runId: run.status.runId, model: decision.servedModel, costUsd: decision.costUsd },
          "Jev decision cost",
        );
        if (decision.confidence !== null && decision.confidence < 0.35) {
          touchRun(run, {
            state: "escalated",
            lastSummary: escalationSummary(run.status, `Low confidence (${decision.confidence.toFixed(2)}).`),
          });
          return;
        }
        typedText = validateTypedText(decision.typedText);
        operation = verifyTargetFresh(observationResult, toOperation(decision, observationResult, typedText));
        touchRun(run, { state: "acting" });
        const actStart = Date.now();
        outcome = await io.act(deps, input.hostId, operation, signal);
        actMs += Date.now() - actStart;
        if (outcome.state === "stale" && outcome.observation !== null && attempt === 0) {
          observationResult = outcome.observation;
          touchRun(run, { state: "deciding", lastObservation: observationResult });
          continue;
        }
        break;
      }
      if (operation === null || outcome === null || lastDecision === null) throw new Error("Jev loop failed to produce an action");
      const decision = lastDecision;
      let submitted = false;
      if (decision.submit && outcome.state === "completed" && SUBMIT_OPERATIONS.has(operation.kind)) {
        touchRun(run, { state: "acting" });
        const submitStart = Date.now();
        const submitOutcome = await io.act(deps, input.hostId, { kind: "press_key", key: "Enter" }, signal);
        actMs += Date.now() - submitStart;
        submitted = submitOutcome.state === "completed";
        outcome = { ...submitOutcome, summary: `${outcome.summary}; then ${submitOutcome.summary}` };
      }
      if (outcome.observation !== null) touchRun(run, { lastObservation: outcome.observation });
      run.status.steps += 1;
      recentSummaries.push(describeStepOutcome(run.status.steps, operation, observationResult, typedText, outcome, submitted));
      if (recentSummaries.length > MAX_RECENT_OUTCOMES) recentSummaries.shift();

      const currentWindowKey = windowKey(observationResult);
      const currentActionKey = actionKey(operation);
      const stuck = currentWindowKey === previousWindowKey && currentActionKey === previousActionKey;
      noProgress = stuck ? noProgress + 1 : 0;
      previousWindowKey = currentWindowKey;
      previousActionKey = currentActionKey;

      touchRun(run, { lastSummary: outcome.summary, noProgressSteps: noProgress });

      const waitMs = operation.kind === "done" || operation.kind === "blocked" ? 0 : postActionWaitMs(operation, observationResult);
      pushTrace(run, {
        step: run.status.steps,
        windowTitle: observationResult.title,
        targetCount: observationResult.targets.length,
        offeredOperations: operationChoices(input.allowedOperations, observationResult.targets).map(
          (choice) => choice.choiceId as Operation["kind"],
        ),
        chosenOperation: operation.kind,
        chosenTargetId: "targetId" in operation ? (operation.targetId ?? null) : null,
        chosenConfidence: decision.confidence,
        textCandidate: decision.typedText,
        submitProbability: decision.submitProbability,
        goalCompleteProbability: decision.goalCompleteProbability,
        outcomeState: outcome.state,
        outcomeSummary: outcome.summary,
        costUsd: decision.costUsd,
        timingsMs: { observe: observeMs, decide: decideMs, act: actMs, wait: waitMs },
      });

      if (operation.kind === "done") {
        try {
          const finalObservation = await io.observe(deps, input.hostId, undefined);
          touchRun(run, { state: "done", lastObservation: finalObservation });
        } catch (error) {
          touchRun(run, {
            state: "error",
            lastSummary: error instanceof Error ? error.message : String(error),
          });
        }
        return;
      }
      if (operation.kind === "blocked" || outcome.state === "blocked") {
        touchRun(run, { state: "blocked" });
        return;
      }
      if (noProgress >= NO_PROGRESS_ESCALATION_STEPS) {
        touchRun(run, {
          state: "escalated",
          lastSummary: escalationSummary(
            run.status,
            `No progress after ${NO_PROGRESS_ESCALATION_STEPS} steps (same window, repeating the same action).`,
          ),
        });
        return;
      }
      await wait(waitMs, signal);
      if (decision.goalCompleteAfter && outcome.state !== "error") {
        try {
          const finalObservation = await io.observe(deps, input.hostId, undefined);
          touchRun(run, { state: "done", lastObservation: finalObservation });
          return;
        } catch {}
      }
    }
    if (!signal.aborted) {
      touchRun(run, {
        state: "escalated",
        lastSummary: escalationSummary(run.status, "Reached the step limit."),
      });
    }
  } catch (error) {
    if (!signal.aborted) {
      if (error instanceof EscalateToAgentError) {
        touchRun(run, { state: "escalated", lastSummary: escalationSummary(run.status, error.message) });
      } else {
        touchRun(run, {
          state: "error",
          lastSummary: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

export async function start(
  deps: WorkSessionDeps,
  input: StartInput,
): Promise<RunStatus> {
  requireNonDestroyedHostWithStatus(deps, input.hostId);
  const runId = randomUUID();
  const abort = new AbortController();
  const backend = input.mode === "agent" ? null : createDecisionBackend(deps.config);
  const mode = input.mode ?? (backend !== null ? "jev" : "agent");
  const base: RunStatus = {
    runId,
    hostId: input.hostId,
    mode,
    goal: input.goal,
    state: "idle",
    steps: 0,
    noProgressSteps: 0,
    lastSummary: null,
    lastObservation: null,
    trace: [],
    jevCostUsd: 0,
    jevModel: null,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
  const run: RunRecord = { status: base, abort };
  runs.set(runId, run);
  activeRunByHost.set(input.hostId, runId);
  emitActiveRunChange(input.hostId);
  if (mode === "agent") {
    touchRun(run, {
      state: "escalated",
      lastSummary:
        "Agent mode: drive this goal with computer_observe/computer_act, then report computer_status.",
    });
    return run.status;
  }
  if (backend === null) {
    touchRun(run, {
      mode: "agent",
      state: "escalated",
      lastSummary:
        "No TypeSafe or OpenRouter API key is configured for Computer; falling back to agent mode. Drive this goal with computer_observe/computer_act.",
    });
    return run.status;
  }
  void runJevLoop(deps, run, input, backend.provider);
  return run.status;
}

export function status(runId: string): RunStatus {
  return requireRun(runId).status;
}

export function cancel(runId: string): RunStatus {
  const run = requireRun(runId);
  run.abort.abort();
  touchRun(run, { state: "cancelled" });
  return run.status;
}

export function activeRun(hostId: string): { runId: string | null } {
  return { runId: activeRunByHost.get(hostId) ?? null };
}

export async function takeControl(
  deps: WorkSessionDeps,
  hostId: string,
  clientId: string,
  signal: AbortSignal,
): Promise<{ owner: "human" | "busy" }> {
  requireNonDestroyedHostWithStatus(deps, hostId);
  return { owner: await controlGateForHost(hostId).acquire(clientId, signal) };
}

export function releaseControl(
  hostId: string,
  clientId: string,
): { released: boolean } {
  return { released: controlGateForHost(hostId).release(clientId) };
}

export function controlStatus(
  hostId: string,
  clientId: string,
): { owner: "you" | "other" | "agent" } {
  return { owner: controlGateForHost(hostId).statusFor(clientId) };
}

export function createComputerLiveHub(deps: WorkSessionDeps): ComputerLiveHub {
  const hub = new ComputerLiveHub({
    sendDemand: (hostId, profile, options) =>
      deps.hub.sendDaemonMessage(hostId, { type: "computer.live.demand", profile, resync: options?.resync }),
    input: (hostId, input: ComputerHumanInput) =>
      callHostOnlineRpcForWork(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: { type: "computer.input", input },
      }),
    clipboardRead: (hostId) =>
      callHostOnlineRpcForWork(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: { type: "computer.clipboard_read" },
      }),
    clipboardWrite: (hostId, text, paste) =>
      callHostOnlineRpcForWork(deps, {
        hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: { type: "computer.clipboard_write", text, paste },
      }),
    controlGate: controlGateForHost,
    activeRunId: (hostId) => activeRunByHost.get(hostId) ?? null,
  });
  onActiveRunChange((hostId) => hub.broadcastStatus(hostId));
  return hub;
}
