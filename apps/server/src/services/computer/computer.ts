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
  type DecisionRequest,
  type DecisionResponse,
  type OpenRouterTextGenerator,
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

const TYPED_TEXT_OPERATIONS = new Set(["type", "set_value", "select", "type_window"]);
const SUBMIT_OPERATIONS = new Set(["type", "set_value", "type_window"]);

async function decideWithRetry(
  provider: DecisionProvider,
  request: DecisionRequest,
  signal: AbortSignal,
): Promise<DecisionResponse> {
  try {
    return await provider.decide(request, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    return provider.decide(request, signal);
  }
}

export async function runJevLoop(
  deps: WorkSessionDeps,
  run: RunRecord,
  input: StartInput,
  provider: DecisionProvider,
  textGenerator: OpenRouterTextGenerator | null,
  io: JevLoopIo = defaultJevLoopIo,
) {
  const signal = run.abort.signal;
  const recentSummaries: string[] = [];
  let noProgress = 0;
  touchRun(run, { state: "observing" });
  try {
    while (run.status.steps < input.maxSteps && !signal.aborted) {
      let observationResult = await io.observe(deps, input.hostId, undefined);
      touchRun(run, { state: "deciding" });
      let operation: Operation | null = null;
      let outcome: ActionOutcome | null = null;
      let lastDecision: DecisionResponse | null = null;
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
        const decision = await decideWithRetry(
          provider,
          {
            goal: input.goal,
            observation: observationResult,
            recentSummaries,
            operationChoices: opChoices,
          },
          signal,
        );
        lastDecision = decision;
        if (decision.confidence !== null && decision.confidence < 0.35) {
          touchRun(run, {
            state: "escalated",
            lastSummary: `Low confidence (${decision.confidence.toFixed(2)}); escalating to the agent`,
          });
          return;
        }
        let typedText = validateTypedText(decision.typedText);
        if (typedText === null && textGenerator !== null && TYPED_TEXT_OPERATIONS.has(decision.operationChoiceId)) {
          const target = observationResult.targets.find(
            (candidate) => candidate.targetId === decision.targetChoiceId,
          );
          typedText = validateTypedText(
            await textGenerator.generate(
              {
                goal: input.goal,
                targetLabel: target === undefined ? "" : `${target.role}: ${target.name}`,
              },
              signal,
            ),
          );
        }
        operation = verifyTargetFresh(observationResult, toOperation(decision, observationResult, typedText));
        touchRun(run, { state: "acting" });
        outcome = await io.act(deps, input.hostId, operation, signal);
        if (outcome.state === "stale" && outcome.observation !== null && attempt === 0) {
          observationResult = outcome.observation;
          touchRun(run, { state: "deciding" });
          continue;
        }
        break;
      }
      if (operation === null || outcome === null || lastDecision === null) throw new Error("Jev loop failed to produce an action");
      const decision = lastDecision;
      if (decision.submit && outcome.state === "completed" && SUBMIT_OPERATIONS.has(operation.kind)) {
        touchRun(run, { state: "acting" });
        const submitOutcome = await io.act(deps, input.hostId, { kind: "press_key", key: "Enter" }, signal);
        outcome = { ...submitOutcome, summary: `${outcome.summary}; then ${submitOutcome.summary}` };
      }
      run.status.steps += 1;
      recentSummaries.push(outcome.summary);
      if (recentSummaries.length > 5) recentSummaries.shift();
      if (
        outcome.state === "completed" &&
        outcome.observation?.snapshotId === observationResult.snapshotId
      ) {
        noProgress += 1;
      } else {
        noProgress = 0;
      }
      touchRun(run, { lastSummary: outcome.summary, noProgressSteps: noProgress });
      if (operation.kind === "done") {
        try {
          await io.observe(deps, input.hostId, undefined);
          touchRun(run, { state: "done" });
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
      if (noProgress >= 3) {
        touchRun(run, {
          state: "escalated",
          lastSummary: "No progress after 3 steps; escalating to the agent",
        });
        return;
      }
      await wait(postActionWaitMs(operation, observationResult), signal);
      if (decision.goalCompleteAfter && outcome.state !== "error") {
        try {
          await io.observe(deps, input.hostId, undefined);
          touchRun(run, { state: "done" });
          return;
        } catch {
          // The verification re-observe was inconsistent; continue the loop normally below.
        }
      }
    }
    if (!signal.aborted) {
      touchRun(run, {
        state: "escalated",
        lastSummary: "Reached the step limit; escalating to the agent",
      });
    }
  } catch (error) {
    if (!signal.aborted) {
      touchRun(run, {
        state: "error",
        lastSummary: error instanceof Error ? error.message : String(error),
      });
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
  void runJevLoop(deps, run, input, backend.provider, backend.textGenerator);
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
    sendDemand: (hostId, profile) =>
      deps.hub.sendDaemonMessage(hostId, { type: "computer.live.demand", profile }),
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
