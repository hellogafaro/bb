import { describe, expect, it } from "vitest";
import { runJevLoop, type JevLoopIo, type RunRecord } from "./computer.js";
import {
  DONE_CONFIRM_THRESHOLD,
  EscalateToAgentError,
  GOAL_COMPLETE_THRESHOLD,
  type ConfirmGoalCompleteRequest,
  type ConfirmGoalCompleteResponse,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResponse,
} from "./decision.js";
import type {
  ComputerActionOutcome as ActionOutcome,
  ComputerObservation as Observation,
  ComputerRunStatus as RunStatus,
  ComputerStartRequest as StartInput,
} from "@bb/server-contract";
import type { WorkSessionDeps } from "../../types.js";

const fakeDeps = {
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
} as unknown as WorkSessionDeps;

function observationFixture(overrides: Partial<Observation> = {}): Observation {
  return {
    hostId: "host-1",
    surface: "desktop",
    title: "Editor",
    snapshotId: "snap-1",
    observedAt: Date.now(),
    hint: null,
    targets: [
      { index: 0, targetId: "t0", role: "button", name: "Save", value: null, bounds: null, ref: null, allowedOperations: ["click"] },
    ],
    ...overrides,
  };
}

function startInputFixture(overrides: Partial<StartInput> = {}): StartInput {
  return {
    hostId: "host-1",
    goal: "Save the file",
    allowedApps: [],
    maxSteps: 10,
    mode: "jev",
    ...overrides,
  };
}

function runFixture(): RunRecord {
  const abort = new AbortController();
  const status: RunStatus = {
    runId: "00000000-0000-4000-8000-000000000000",
    hostId: "host-1",
    mode: "jev",
    goal: "Save the file",
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
  return { status, abort };
}

function outcomeFixture(overrides: Partial<ActionOutcome> = {}): ActionOutcome {
  return { state: "completed", summary: "did it", observation: null, ...overrides };
}

class ScriptedProvider implements DecisionProvider {
  #script: DecisionResponse[];
  #confirmResults: boolean[];
  requests: DecisionRequest[] = [];
  confirmRequests: ConfirmGoalCompleteRequest[] = [];
  constructor(script: DecisionResponse[], confirmResults: boolean[] = []) {
    this.#script = script;
    this.#confirmResults = confirmResults;
  }
  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    this.requests.push(request);
    const next = this.#script[this.requests.length - 1];
    if (next === undefined) throw new Error("ScriptedProvider ran out of answers");
    return next;
  }
  async confirmGoalComplete(request: ConfirmGoalCompleteRequest): Promise<ConfirmGoalCompleteResponse> {
    this.confirmRequests.push(request);
    const complete = this.#confirmResults[this.confirmRequests.length - 1] ?? true;
    return { complete, probability: complete ? 1 : 0 };
  }
}

class ProbabilityScriptedProvider implements DecisionProvider {
  #script: DecisionResponse[];
  #probabilities: number[];
  requests: DecisionRequest[] = [];
  confirmRequests: ConfirmGoalCompleteRequest[] = [];
  constructor(script: DecisionResponse[], probabilities: number[]) {
    this.#script = script;
    this.#probabilities = probabilities;
  }
  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    this.requests.push(request);
    const next = this.#script[this.requests.length - 1];
    if (next === undefined) throw new Error("ProbabilityScriptedProvider ran out of answers");
    return next;
  }
  async confirmGoalComplete(request: ConfirmGoalCompleteRequest): Promise<ConfirmGoalCompleteResponse> {
    this.confirmRequests.push(request);
    const probability = this.#probabilities[this.confirmRequests.length - 1] ?? 1;
    return { complete: probability >= request.threshold, probability };
  }
}

describe("runJevLoop", () => {
  it("retries once against the fresh observation when act() reports the snapshot went stale, without reobserving separately", async () => {
    const initial = observationFixture();
    const fresh = observationFixture({ snapshotId: "snap-2" });
    const provider = new ScriptedProvider([
      { operationChoiceId: "click", targetChoiceId: "t0", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null },
      { operationChoiceId: "click", targetChoiceId: "t0", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null },
    ]);
    let observeCalls = 0;
    let actCalls = 0;
    const io: JevLoopIo = {
      observe: async () => {
        observeCalls += 1;
        return initial;
      },
      act: async () => {
        actCalls += 1;
        if (actCalls === 1) return outcomeFixture({ state: "stale", observation: fresh });
        return outcomeFixture({ state: "completed", observation: fresh });
      },
    };
    const run = runFixture();
    run.status.steps = 0;
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 1 }), provider, io);
    expect(observeCalls).toBe(1);
    expect(actCalls).toBe(2);
    expect(provider.requests[1]!.observation.snapshotId).toBe("snap-2");
    expect(run.status.steps).toBe(1);
  });

  it("re-observes before reporting DONE and escalates to error instead if that re-observe fails", async () => {
    const observation = observationFixture();
    const provider = new ScriptedProvider([{ operationChoiceId: "done", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }]);
    let observeCalls = 0;
    const io: JevLoopIo = {
      observe: async () => {
        observeCalls += 1;
        return observation;
      },
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture(), provider, io);
    expect(observeCalls).toBe(2);
    expect(run.status.state).toBe("done");
  });

  it("does not report done when the verification re-observe fails", async () => {
    const observation = observationFixture();
    const provider = new ScriptedProvider([{ operationChoiceId: "done", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }]);
    let observeCalls = 0;
    const io: JevLoopIo = {
      observe: async () => {
        observeCalls += 1;
        if (observeCalls === 2) throw new Error("host went offline");
        return observation;
      },
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture(), provider, io);
    expect(run.status.state).toBe("error");
    expect(run.status.lastSummary).toMatch(/host went offline/);
  });

  it("blocks instead of acting when the provider returns a target that is not in the observation", async () => {
    const observation = observationFixture();
    const provider = new ScriptedProvider([{ operationChoiceId: "click", targetChoiceId: "ghost", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }]);
    let actedOperation: unknown = null;
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async (_deps, _hostId, action) => {
        actedOperation = action;
        return outcomeFixture({ state: "blocked" });
      },
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture(), provider, io);
    expect(actedOperation).toMatchObject({ kind: "blocked" });
    expect(run.status.state).toBe("blocked");
  });

  it("carries the decision's typed text straight into the action on a stale retry, re-deciding against the fresh observation", async () => {
    const initial = observationFixture({
      targets: [{ index: 0, targetId: "t1", role: "text", name: "Filename", value: "", bounds: null, ref: null, allowedOperations: ["type"] }],
    });
    const fresh = observationFixture({
      snapshotId: "snap-2",
      targets: [{ index: 0, targetId: "t1", role: "text", name: "Filename", value: "", bounds: null, ref: null, allowedOperations: ["type"] }],
    });
    const provider = new ScriptedProvider([
      { operationChoiceId: "type", targetChoiceId: "t1", typedText: "hello.txt", submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null },
      { operationChoiceId: "type", targetChoiceId: "t1", typedText: "hello.txt", submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null },
    ]);
    let actCalls = 0;
    const io: JevLoopIo = {
      observe: async () => initial,
      act: async (_deps, _hostId, action) => {
        actCalls += 1;
        expect(action).toMatchObject({ kind: "type", text: "hello.txt" });
        if (actCalls === 1) return outcomeFixture({ state: "stale", observation: fresh });
        return outcomeFixture({ state: "completed" });
      },
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 1 }), provider, io);
    expect(actCalls).toBe(2);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]!.observation.snapshotId).toBe("snap-2");
  });

  it("presses Enter immediately after a submit:true type_window, without spending another decide() on it", async () => {
    const observation = observationFixture({ targets: [] });
    const provider = new ScriptedProvider([
      { operationChoiceId: "type_window", targetChoiceId: null, typedText: "echo hi", submit: true, submitProbability: 1, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: null, costUsd: null, servedModel: null },
    ]);
    const actedActions: unknown[] = [];
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async (_deps, _hostId, action) => {
        actedActions.push(action);
        return outcomeFixture({ state: "completed", summary: `did ${(action as { kind: string }).kind}` });
      },
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 1 }), provider, io);
    expect(actedActions).toEqual([
      { kind: "type_window", text: "echo hi" },
      { kind: "press_key", key: "Enter" },
    ]);
    expect(provider.requests).toHaveLength(1);
    expect(run.status.steps).toBe(1);
  });

  it("does not submit when the type action itself did not complete", async () => {
    const observation = observationFixture({ targets: [] });
    const provider = new ScriptedProvider([
      { operationChoiceId: "type_window", targetChoiceId: null, typedText: "echo hi", submit: true, submitProbability: 1, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: null, costUsd: null, servedModel: null },
      { operationChoiceId: "done", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: null, costUsd: null, servedModel: null },
    ]);
    const actedActions: unknown[] = [];
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async (_deps, _hostId, action) => {
        actedActions.push(action);
        return outcomeFixture({ state: "error", summary: "boom" });
      },
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(actedActions[0]).toEqual({ kind: "type_window", text: "echo hi" });
    expect(actedActions).not.toContainEqual({ kind: "press_key", key: "Enter" });
  });

  it("finishes as done after one verification observe and a fresh confirmation question, when goalCompleteAfter is true, without another decide()", async () => {
    const observation = observationFixture({ targets: [] });
    const provider = new ScriptedProvider([
      { operationChoiceId: "press_key", targetChoiceId: "Enter", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: true, goalCompleteProbability: 1, confidence: null, costUsd: null, servedModel: null },
    ]);
    let observeCalls = 0;
    const io: JevLoopIo = {
      observe: async () => {
        observeCalls += 1;
        return observation;
      },
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(run.status.state).toBe("done");
    expect(observeCalls).toBe(2);
    expect(provider.requests).toHaveLength(1);
    expect(provider.confirmRequests).toHaveLength(1);
  });

  it("does not finish and keeps looping when goalCompleteAfter is true but the fresh confirmation question says the goal is not yet complete", async () => {
    const observation = observationFixture({ targets: [] });
    const provider = new ScriptedProvider(
      [
        { operationChoiceId: "press_key", targetChoiceId: "Enter", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: true, goalCompleteProbability: 1, confidence: null, costUsd: null, servedModel: null },
        { operationChoiceId: "press_key", targetChoiceId: "Enter", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: null, costUsd: null, servedModel: null },
      ],
      [false],
    );
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 2 }), provider, io);
    expect(run.status.state).not.toBe("done");
    expect(provider.confirmRequests).toHaveLength(1);
    expect(provider.requests).toHaveLength(2);
  });

  it("continues the loop normally when the goalCompleteAfter verification observe is inconsistent", async () => {
    const observation = observationFixture({ targets: [] });
    const provider = new ScriptedProvider([
      { operationChoiceId: "press_key", targetChoiceId: "Enter", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: true, goalCompleteProbability: 1, confidence: null, costUsd: null, servedModel: null },
      { operationChoiceId: "done", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: null, costUsd: null, servedModel: null },
    ]);
    let observeCalls = 0;
    const io: JevLoopIo = {
      observe: async () => {
        observeCalls += 1;
        if (observeCalls === 2) throw new Error("window vanished");
        return observation;
      },
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(run.status.state).toBe("done");
    expect(provider.requests).toHaveLength(2);
  });

  it("accepts done at the lower 0.5 bar when Jev's own operation choice was done", async () => {
    const observation = observationFixture({ targets: [] });
    const provider = new ProbabilityScriptedProvider(
      [{ operationChoiceId: "done", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }],
      [0.6],
    );
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(run.status.state).toBe("done");
    expect(provider.confirmRequests).toHaveLength(1);
    expect(provider.confirmRequests[0]!.threshold).toBe(DONE_CONFIRM_THRESHOLD);
  });

  it("does not finish when the provider chose done but confirmation stays below the 0.5 bar", async () => {
    const observation = observationFixture({ targets: [] });
    const provider = new ProbabilityScriptedProvider(
      [
        { operationChoiceId: "done", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null },
        { operationChoiceId: "wait", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null },
      ],
      [0.3],
    );
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(run.status.state).not.toBe("done");
    expect(provider.confirmRequests).toHaveLength(1);
  });

  it("keeps the higher 0.8 bar for the speculative goalCompleteAfter path, unlike the done path", async () => {
    const observation = observationFixture({ targets: [] });
    const provider = new ProbabilityScriptedProvider(
      [
        { operationChoiceId: "press_key", targetChoiceId: "Enter", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: true, goalCompleteProbability: 1, confidence: null, costUsd: null, servedModel: null },
        { operationChoiceId: "wait", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: null, costUsd: null, servedModel: null },
      ],
      [0.6],
    );
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(run.status.state).not.toBe("done");
    expect(provider.confirmRequests).toHaveLength(1);
    expect(provider.confirmRequests[0]!.threshold).toBe(GOAL_COMPLETE_THRESHOLD);
  });

  it("escalates to the agent, without retrying, when the provider cannot find literal text to type", async () => {
    const observation = observationFixture({ targets: [] });
    let decideCalls = 0;
    const provider: DecisionProvider = {
      decide: async () => {
        decideCalls += 1;
        throw new EscalateToAgentError("no candidate text fits the goal");
      },
      confirmGoalComplete: async () => {
        throw new Error("confirmGoalComplete should not be called");
      },
    };
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(run.status.state).toBe("escalated");
    expect(run.status.lastSummary).toMatch(/no candidate text fits the goal/);
    expect(decideCalls).toBe(1);
  });

  it("records a bounded per-step trace with the offered operations, chosen target, probabilities, timings, and cost", async () => {
    const observation = observationFixture();
    const provider = new ScriptedProvider([
      {
        operationChoiceId: "click",
        targetChoiceId: "t0",
        typedText: null,
        submit: false,
        submitProbability: null,
        goalCompleteAfter: false,
        goalCompleteProbability: 0.2,
        confidence: 0.9,
        costUsd: 0.001,
        servedModel: "typesafe/jev-1.13",
      },
    ]);
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async () => outcomeFixture({ state: "blocked", summary: "no safe next step" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(run.status.trace).toHaveLength(1);
    const step = run.status.trace[0]!;
    expect(step).toMatchObject({
      step: 1,
      windowTitle: "Editor",
      targetCount: 1,
      chosenOperation: "click",
      chosenTargetId: "t0",
      chosenConfidence: 0.9,
      goalCompleteProbability: 0.2,
      outcomeState: "blocked",
      outcomeSummary: "no safe next step",
      costUsd: 0.001,
    });
    expect(step.offeredOperations).toContain("click");
    expect(step.timingsMs.observe).toBeGreaterThanOrEqual(0);
    expect(step.timingsMs.decide).toBeGreaterThanOrEqual(0);
    expect(step.timingsMs.act).toBeGreaterThanOrEqual(0);
  });

  it("passes the decision provider a specific, cumulative outcome naming the target's role/label and what changed, not a generic 'Executed click'", async () => {
    const first = observationFixture({ title: "jev-test" });
    const second = observationFixture({ title: "jev-test (new tab)" });
    const decisions: DecisionResponse[] = [
      { operationChoiceId: "click", targetChoiceId: "t0", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0.1, confidence: 0.9, costUsd: null, servedModel: null },
      { operationChoiceId: "click", targetChoiceId: "t0", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0.1, confidence: 0.9, costUsd: null, servedModel: null },
    ];
    const provider = new ScriptedProvider(decisions);
    let observeCalls = 0;
    const io: JevLoopIo = {
      observe: async () => {
        observeCalls += 1;
        return observeCalls === 1 ? first : second;
      },
      act: async () => outcomeFixture({ state: "completed", observation: second, summary: "Executed click" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 2 }), provider, io);
    expect(provider.requests[1]!.recentSummaries).toEqual([
      "step 1: clicked 'Save' (button) -> window changed to 'jev-test (new tab)'",
    ]);
  });

  it("names typed text and a pressed Enter submit in the recent outcome", async () => {
    const observation = observationFixture({ targets: [] });
    const decisions: DecisionResponse[] = [
      { operationChoiceId: "type_window", targetChoiceId: null, typedText: "echo ok", submit: true, submitProbability: 1, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: null, costUsd: null, servedModel: null },
      { operationChoiceId: "done", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: null, costUsd: null, servedModel: null },
    ];
    const provider = new ScriptedProvider(decisions);
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async (_deps, _hostId, action) =>
        outcomeFixture({ state: "completed", observation, summary: `did ${(action as { kind: string }).kind}` }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(provider.requests[1]!.recentSummaries).toEqual([
      "step 1: typed 'echo ok' into the focused window and pressed Enter -> same window, no title change",
    ]);
  });

  it("keeps recentSummaries bounded to the last 8 outcomes", async () => {
    const decisions: DecisionResponse[] = Array.from({ length: 10 }, () => ({
      operationChoiceId: "click" as const,
      targetChoiceId: "t0",
      typedText: null,
      submit: false,
      submitProbability: null,
      goalCompleteAfter: false,
      goalCompleteProbability: 0,
      confidence: 0.9,
      costUsd: null,
      servedModel: null,
    }));
    const provider = new ScriptedProvider(decisions);
    let observeCalls = 0;
    const io: JevLoopIo = {
      observe: async () => {
        observeCalls += 1;
        // A different title each step keeps this from tripping the no-progress
        // escalation, which is exercised separately; this test is only about bounding.
        return observationFixture({ title: `window-${observeCalls}` });
      },
      act: async (_deps, _hostId, _action) => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 10 }), provider, io);
    const lastRequest = provider.requests[provider.requests.length - 1]!;
    expect(lastRequest.recentSummaries).toHaveLength(8);
    expect(lastRequest.recentSummaries[0]).toMatch(/^step 2:/);
    expect(lastRequest.recentSummaries[7]).toMatch(/^step 9:/);
  });

  it("keeps the latest observation on the run status so an escalation can be continued without re-observing", async () => {
    const observation = observationFixture();
    const provider = new ScriptedProvider([
      { operationChoiceId: "click", targetChoiceId: "t0", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.05, costUsd: null, servedModel: null },
    ]);
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 5 }), provider, io);
    expect(run.status.state).toBe("escalated");
    expect(run.status.lastObservation).toEqual(observation);
    expect(run.status.lastSummary).toMatch(/Completed 0 step\(s\) toward "Save the file"/);
  });

  it("escalates quickly once the same action repeats, well before the step limit, instead of spinning for 12 steps", async () => {
    const observation = observationFixture();
    const repeatedDecision: DecisionResponse = {
      operationChoiceId: "click",
      targetChoiceId: "t0",
      typedText: null,
      submit: false,
      submitProbability: null,
      goalCompleteAfter: false,
      goalCompleteProbability: 0,
      confidence: 0.9,
      costUsd: null,
      servedModel: null,
    };
    const provider = new ScriptedProvider(Array.from({ length: 12 }, () => repeatedDecision));
    let actCalls = 0;
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async () => {
        actCalls += 1;
        return outcomeFixture({ state: "completed", observation, summary: `click attempt ${actCalls}` });
      },
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 12 }), provider, io);
    expect(run.status.state).toBe("escalated");
    expect(run.status.lastSummary).toMatch(/No progress after 5 steps/);
    expect(run.status.steps).toBeLessThan(12);
  });

  it("treats a changed window title as progress, even repeating the same click, instead of counting it toward the no-progress escalation", async () => {
    const first = observationFixture({ title: "jev-test" });
    const second = observationFixture({ title: "jev-test (new tab)" });
    let observeCalls = 0;
    const sameClickTwice = Array.from({ length: 2 }, () => ({
      operationChoiceId: "click" as const,
      targetChoiceId: "t0",
      typedText: null,
      submit: false,
      submitProbability: null,
      goalCompleteAfter: false,
      goalCompleteProbability: 0,
      confidence: 0.9,
      costUsd: null,
      servedModel: null,
    }));
    const provider = new ScriptedProvider(sameClickTwice);
    const io: JevLoopIo = {
      observe: async () => {
        observeCalls += 1;
        return observeCalls === 1 ? first : second;
      },
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 2 }), provider, io);
    expect(run.status.trace.map((entry) => entry.windowTitle)).toEqual(["jev-test", "jev-test (new tab)"]);
    expect(run.status.noProgressSteps).toBe(0);
  });

  it("escalates on repeating the same click in the same window even though the target-table snapshotId changes on every observe", async () => {
    let snapshotCounter = 0;
    const provider = new ScriptedProvider(
      Array.from({ length: 6 }, () => ({
        operationChoiceId: "click" as const,
        targetChoiceId: "t0",
        typedText: null,
        submit: false,
        submitProbability: null,
        goalCompleteAfter: false,
        goalCompleteProbability: 0,
        confidence: 0.9,
        costUsd: null,
        servedModel: null,
      })),
    );
    const io: JevLoopIo = {
      observe: async () => {
        snapshotCounter += 1;
        return observationFixture({ snapshotId: `noisy-${snapshotCounter}` });
      },
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 6 }), provider, io);
    expect(run.status.state).toBe("escalated");
    expect(run.status.lastSummary).toMatch(/No progress after 5 steps/);
  });
});
