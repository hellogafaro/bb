import { describe, expect, it } from "vitest";
import { runJevLoop, type JevLoopIo, type RunRecord } from "./computer.js";
import type { DecisionProvider, DecisionRequest, DecisionResponse } from "./decision.js";
import type {
  ComputerActionOutcome as ActionOutcome,
  ComputerObservation as Observation,
  ComputerRunStatus as RunStatus,
  ComputerStartRequest as StartInput,
} from "@bb/server-contract";
import type { WorkSessionDeps } from "../../types.js";

const fakeDeps = {} as WorkSessionDeps;

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
  requests: DecisionRequest[] = [];
  constructor(script: DecisionResponse[]) {
    this.#script = script;
  }
  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    this.requests.push(request);
    const next = this.#script[this.requests.length - 1];
    if (next === undefined) throw new Error("ScriptedProvider ran out of answers");
    return next;
  }
}

describe("runJevLoop", () => {
  it("retries once against the fresh observation when act() reports the snapshot went stale, without reobserving separately", async () => {
    const initial = observationFixture();
    const fresh = observationFixture({ snapshotId: "snap-2" });
    const provider = new ScriptedProvider([
      { operationChoiceId: "click", targetChoiceId: "t0", confidence: 1 },
      { operationChoiceId: "click", targetChoiceId: "t0", confidence: 1 },
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
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 1 }), provider, null, io);
    expect(observeCalls).toBe(1);
    expect(actCalls).toBe(2);
    expect(provider.requests[1]!.observation.snapshotId).toBe("snap-2");
    expect(run.status.steps).toBe(1);
  });

  it("re-observes before reporting DONE and escalates to error instead if that re-observe fails", async () => {
    const observation = observationFixture();
    const provider = new ScriptedProvider([{ operationChoiceId: "done", targetChoiceId: null, confidence: 1 }]);
    let observeCalls = 0;
    const io: JevLoopIo = {
      observe: async () => {
        observeCalls += 1;
        return observation;
      },
      act: async () => outcomeFixture({ state: "completed" }),
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture(), provider, null, io);
    expect(observeCalls).toBe(2);
    expect(run.status.state).toBe("done");
  });

  it("does not report done when the verification re-observe fails", async () => {
    const observation = observationFixture();
    const provider = new ScriptedProvider([{ operationChoiceId: "done", targetChoiceId: null, confidence: 1 }]);
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
    await runJevLoop(fakeDeps, run, startInputFixture(), provider, null, io);
    expect(run.status.state).toBe("error");
    expect(run.status.lastSummary).toMatch(/host went offline/);
  });

  it("blocks instead of acting when the provider returns a target that is not in the observation", async () => {
    const observation = observationFixture();
    const provider = new ScriptedProvider([{ operationChoiceId: "click", targetChoiceId: "ghost", confidence: 1 }]);
    let actedOperation: unknown = null;
    const io: JevLoopIo = {
      observe: async () => observation,
      act: async (_deps, _hostId, action) => {
        actedOperation = action;
        return outcomeFixture({ state: "blocked" });
      },
    };
    const run = runFixture();
    await runJevLoop(fakeDeps, run, startInputFixture(), provider, null, io);
    expect(actedOperation).toMatchObject({ kind: "blocked" });
    expect(run.status.state).toBe("blocked");
  });

  it("passes the same goal/targetLabel input to the text helper on a stale retry, so it can reuse its cache", async () => {
    const initial = observationFixture({
      targets: [{ index: 0, targetId: "t1", role: "text", name: "Filename", value: "", bounds: null, ref: null, allowedOperations: ["type"] }],
    });
    const fresh = observationFixture({
      snapshotId: "snap-2",
      targets: [{ index: 0, targetId: "t1", role: "text", name: "Filename", value: "", bounds: null, ref: null, allowedOperations: ["type"] }],
    });
    const provider = new ScriptedProvider([
      { operationChoiceId: "type", targetChoiceId: "t1", confidence: 1 },
      { operationChoiceId: "type", targetChoiceId: "t1", confidence: 1 },
    ]);
    const generateInputs: unknown[] = [];
    const textGenerator = {
      generate: async (input: unknown) => {
        generateInputs.push(input);
        return "hello.txt";
      },
    } as unknown as import("./decision.js").OpenRouterTextGenerator;
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
    await runJevLoop(fakeDeps, run, startInputFixture({ maxSteps: 1 }), provider, textGenerator, io);
    expect(actCalls).toBe(2);
    expect(generateInputs).toHaveLength(2);
    expect(generateInputs[0]).toEqual(generateInputs[1]);
    expect(generateInputs[0]).toEqual({ goal: "Save the file", targetLabel: "text: Filename" });
  });
});
