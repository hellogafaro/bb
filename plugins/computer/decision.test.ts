import { describe, expect, it } from "vitest";
import { operationChoices, targetChoices, toOperation, type DecisionProvider, type DecisionResponse } from "./decision.js";
import type { Observation } from "./contracts.js";

const observation: Observation = {
  hostId: "host-1",
  surface: "desktop",
  title: "Editor",
  snapshotId: "snap-1",
  observedAt: Date.now(),
  targets: [
    { index: 0, targetId: "t0", role: "button", name: "Save", value: null, bounds: null, ref: null, allowedOperations: ["click"] },
    { index: 1, targetId: "t1", role: "text", name: "Filename", value: "", bounds: null, ref: null, allowedOperations: ["type", "set_value"] },
  ],
};

describe("operationChoices", () => {
  it("only offers operations present in the target table, plus the always-available ones", () => {
    const choices = operationChoices(undefined, observation.targets).map((choice) => choice.choiceId);
    expect(choices).toEqual(expect.arrayContaining(["click", "type", "set_value", "wait", "done", "blocked"]));
    expect(choices).not.toContain("scroll");
  });

  it("respects an explicit allow-list", () => {
    const choices = operationChoices(["click", "done"], observation.targets).map((choice) => choice.choiceId);
    expect(choices).toEqual(["click", "done"]);
  });
});

describe("targetChoices", () => {
  it("filters targets to those compatible with the operation", () => {
    const choices = targetChoices(observation.targets, "type");
    expect(choices).toHaveLength(1);
    expect(choices[0]!.choiceId).toBe("t1");
  });
});

describe("toOperation", () => {
  it("maps a click decision to a click operation carrying the current snapshotId", () => {
    const decision: DecisionResponse = { operationChoiceId: "click", targetChoiceId: "t0", confidence: 0.9 };
    const operation = toOperation(decision, observation, null);
    expect(operation).toEqual({ kind: "click", targetId: "t0", snapshotId: "snap-1" });
  });

  it("blocks a click decision with no target instead of guessing one", () => {
    const decision: DecisionResponse = { operationChoiceId: "click", targetChoiceId: null, confidence: 0.9 };
    const operation = toOperation(decision, observation, null);
    expect(operation.kind).toBe("blocked");
  });

  it("carries generated text into a type operation and never into any other kind", () => {
    const decision: DecisionResponse = { operationChoiceId: "type", targetChoiceId: "t1", confidence: 0.8 };
    const operation = toOperation(decision, observation, "hello world");
    expect(operation).toMatchObject({ kind: "type", text: "hello world" });
  });
});

class ScriptedProvider implements DecisionProvider {
  #script: DecisionResponse[];
  constructor(script: DecisionResponse[]) {
    this.#script = script;
  }
  calls = 0;
  async decide(): Promise<DecisionResponse> {
    const next = this.#script[this.calls];
    this.calls += 1;
    if (next === undefined) throw new Error("Scripted provider ran out of answers");
    return next;
  }
}

describe("ScriptedProvider fixture", () => {
  it("replays exactly the scripted decisions in order", async () => {
    const provider = new ScriptedProvider([
      { operationChoiceId: "click", targetChoiceId: "t0", confidence: 1 },
      { operationChoiceId: "done", targetChoiceId: null, confidence: 1 },
    ]);
    const first = await provider.decide();
    const second = await provider.decide();
    expect(first.operationChoiceId).toBe("click");
    expect(second.operationChoiceId).toBe("done");
    await expect(provider.decide()).rejects.toThrow(/ran out/);
  });
});
