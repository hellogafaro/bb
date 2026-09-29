import { describe, expect, it } from "vitest";
import {
  EscalateToAgentError,
  JevDecisionProvider,
  createDecisionBackend,
  extractTextCandidates,
  operationChoices,
  postActionWaitMs,
  targetChoices,
  toOperation,
  verifyTargetFresh,
  type DecisionConfig,
  type DecisionProvider,
  type DecisionRequest,
  type DecisionResponse,
} from "./decision.js";
import type { ComputerObservation as Observation } from "@bb/server-contract";

const observation: Observation = {
  hostId: "host-1",
  surface: "desktop",
  title: "Editor",
  snapshotId: "snap-1",
  observedAt: Date.now(),
  hint: null,
  targets: [
    { index: 0, targetId: "t0", role: "button", name: "Save", value: null, bounds: null, ref: null, allowedOperations: ["click"] },
    { index: 1, targetId: "t1", role: "text", name: "Filename", value: "", bounds: null, ref: null, allowedOperations: ["type", "set_value"] },
    { index: 2, targetId: "t2", role: "combobox", name: "Country", value: null, bounds: null, ref: null, allowedOperations: ["select", "click"] },
  ],
};

describe("operationChoices", () => {
  it("only offers operations present in the target table, plus the always-available ones", () => {
    const choices = operationChoices(undefined, observation.targets).map((choice) => choice.choiceId);
    expect(choices).toEqual(expect.arrayContaining(["click", "type", "set_value", "select", "wait", "done", "blocked"]));
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

  it("lets a target satisfy more than one operation", () => {
    const choices = targetChoices(observation.targets, "click");
    expect(choices.map((choice) => choice.choiceId)).toEqual(["t0", "t2"]);
  });
});

describe("toOperation", () => {
  it("maps a click decision to a click operation carrying the current snapshotId", () => {
    const decision: DecisionResponse = { operationChoiceId: "click", targetChoiceId: "t0", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.9, costUsd: null, servedModel: null };
    const operation = toOperation(decision, observation, null);
    expect(operation).toEqual({ kind: "click", targetId: "t0", snapshotId: "snap-1" });
  });

  it("blocks a click decision with no target instead of guessing one", () => {
    const decision: DecisionResponse = { operationChoiceId: "click", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.9, costUsd: null, servedModel: null };
    const operation = toOperation(decision, observation, null);
    expect(operation.kind).toBe("blocked");
  });

  it("carries generated text into a type operation and never into any other kind", () => {
    const decision: DecisionResponse = { operationChoiceId: "type", targetChoiceId: "t1", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.8, costUsd: null, servedModel: null };
    const operation = toOperation(decision, observation, "hello world");
    expect(operation).toMatchObject({ kind: "type", text: "hello world" });
  });

  it("blocks type instead of typing an empty or invalid string", () => {
    const decision: DecisionResponse = { operationChoiceId: "type", targetChoiceId: "t1", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.8, costUsd: null, servedModel: null };
    const operation = toOperation(decision, observation, null);
    expect(operation.kind).toBe("blocked");
  });

  it("maps type_window to a targetless type operation carrying the given text", () => {
    const decision: DecisionResponse = { operationChoiceId: "type_window", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.8, costUsd: null, servedModel: null };
    const operation = toOperation(decision, observation, "echo hello-from-jev");
    expect(operation).toEqual({ kind: "type_window", text: "echo hello-from-jev" });
  });

  it("blocks type_window when no valid text was produced", () => {
    const decision: DecisionResponse = { operationChoiceId: "type_window", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.8, costUsd: null, servedModel: null };
    const operation = toOperation(decision, observation, null);
    expect(operation.kind).toBe("blocked");
  });

  it("maps press_key to the chosen key, defaulting to Enter with no choice", () => {
    const chosen = toOperation(
      { operationChoiceId: "press_key", targetChoiceId: "Escape", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.8, costUsd: null, servedModel: null },
      observation,
      null,
    );
    expect(chosen).toEqual({ kind: "press_key", key: "Escape" });
    const defaulted = toOperation(
      { operationChoiceId: "press_key", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.8, costUsd: null, servedModel: null },
      observation,
      null,
    );
    expect(defaulted).toEqual({ kind: "press_key", key: "Enter" });
  });

  it("maps focus_window to a targetless operation", () => {
    const operation = toOperation(
      { operationChoiceId: "focus_window", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 0.8, costUsd: null, servedModel: null },
      observation,
      null,
    );
    expect(operation).toEqual({ kind: "focus_window" });
  });
});

describe("verifyTargetFresh", () => {
  it("passes through an operation whose target is still in the observation", () => {
    const operation = toOperation({ operationChoiceId: "click", targetChoiceId: "t0", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }, observation, null);
    expect(verifyTargetFresh(observation, operation)).toEqual(operation);
  });

  it("blocks instead of executing against a target that vanished from the observation", () => {
    const operation = toOperation({ operationChoiceId: "click", targetChoiceId: "gone", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }, observation, null);
    const guarded = verifyTargetFresh(observation, operation);
    expect(guarded.kind).toBe("blocked");
  });

  it("leaves target-less operations untouched", () => {
    const operation = toOperation({ operationChoiceId: "done", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }, observation, null);
    expect(verifyTargetFresh(observation, operation)).toEqual(operation);
  });
});

describe("postActionWaitMs", () => {
  it("caps a non-type action to 50ms", () => {
    const operation = toOperation({ operationChoiceId: "click", targetChoiceId: "t0", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }, observation, null);
    expect(postActionWaitMs(operation, observation)).toBe(50);
  });

  it("caps typing into a plain text field to 50ms", () => {
    const operation = toOperation({ operationChoiceId: "type", targetChoiceId: "t1", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }, observation, "hi");
    expect(postActionWaitMs(operation, observation)).toBe(50);
  });

  it("caps typing into a combobox/search field to 200ms", () => {
    const comboObservation: Observation = {
      ...observation,
      targets: [
        { index: 0, targetId: "t3", role: "searchbox", name: "Search", value: "", bounds: null, ref: null, allowedOperations: ["type"] },
      ],
    };
    const operation = toOperation({ operationChoiceId: "type", targetChoiceId: "t3", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null }, comboObservation, "hi");
    expect(postActionWaitMs(operation, comboObservation)).toBe(200);
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
      { operationChoiceId: "click", targetChoiceId: "t0", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null },
      { operationChoiceId: "done", targetChoiceId: null, typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0, confidence: 1, costUsd: null, servedModel: null },
    ]);
    const first = await provider.decide();
    const second = await provider.decide();
    expect(first.operationChoiceId).toBe("click");
    expect(second.operationChoiceId).toBe("done");
    await expect(provider.decide()).rejects.toThrow(/ran out/);
  });
});

describe("extractTextCandidates", () => {
  it("extracts the literal command after 'the command:', trimmed of trailing keystrokes", () => {
    const candidates = extractTextCandidates(
      "In the terminal window titled jev-test, type the command: echo hello-systemone and press Enter",
    );
    expect(candidates).toEqual(["echo hello-systemone"]);
  });

  it("extracts quoted text", () => {
    const candidates = extractTextCandidates('Search for "openai careers" on the site');
    expect(candidates).toContain("openai careers");
  });

  it("extracts text after 'search for'", () => {
    const candidates = extractTextCandidates("Search for bb automation docs");
    expect(candidates).toEqual(["bb automation docs"]);
  });

  it("returns no candidates when the goal has no literal text cue", () => {
    expect(extractTextCandidates("Click the Save button")).toEqual([]);
  });

  it("does not duplicate an identical candidate found by more than one cue", () => {
    const candidates = extractTextCandidates('Type "hello world" into the field');
    expect(candidates.filter((candidate) => candidate === "hello world")).toHaveLength(1);
  });
});

interface RecordedCall {
  readonly url: string;
  readonly authorization: string | null;
  readonly body: Record<string, unknown>;
}

function fakeSystemOne(...answerSets: Array<Record<string, unknown>>): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const answers = answerSets[calls.length] ?? answerSets[answerSets.length - 1];
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(JSON.stringify({ answers }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

function choiceAnswer(choice: string, confidence = 0.98): { type: "choice"; choice: string; confidence: number } {
  return { type: "choice", choice, confidence };
}

function noulAnswer(noul: number): { type: "noul"; noul: number } {
  return { type: "noul", noul };
}

const decisionRequest: DecisionRequest = {
  runId: "run-1",
  goal: "Save the file",
  observation,
  recentSummaries: [],
  operationChoices: operationChoices(undefined, observation.targets),
};

describe("JevDecisionProvider", () => {
  it("asks operation, every compatible target head, submit, and goal_complete_after in a single request", async () => {
    const { fetchImpl, calls } = fakeSystemOne({
      operation: choiceAnswer("click"),
      click_target: choiceAnswer("t2"),
      goal_complete_after: noulAnswer(0.05),
    });
    const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest", apiKey: "key", fetchImpl });
    const decision = await provider.decide(decisionRequest, new AbortController().signal);
    expect(decision).toEqual({ operationChoiceId: "click", targetChoiceId: "t2", typedText: null, submit: false, submitProbability: null, goalCompleteAfter: false, goalCompleteProbability: 0.05, confidence: 0.98, costUsd: null, servedModel: null });
    expect(calls).toHaveLength(1);
    const questions = calls[0]!.body.questions as Record<string, { type: string; criteria: Record<string, unknown> }>;
    expect(questions.click_target!.criteria).toEqual({
      t0: { role: "button", label: "Save", value: null },
      t2: { role: "combobox", label: "Country", value: null },
      none: "Not applicable; a different operation was chosen",
    });
    expect(questions.select_target!.criteria).toEqual({
      t2: { role: "combobox", label: "Country", value: null },
      none: "Not applicable; a different operation was chosen",
    });
    expect(questions.scroll_target).toBeUndefined();
    expect(questions.text_candidate).toBeDefined();
    expect(questions.submit).toBeDefined();
    expect(questions.goal_complete_after).toBeDefined();
  });

  it("ignores a target head that does not match the chosen operation", async () => {
    const { fetchImpl } = fakeSystemOne({
      operation: choiceAnswer("click"),
      click_target: choiceAnswer("t2"),
      select_target: choiceAnswer("t2"),
      goal_complete_after: noulAnswer(0.05),
    });
    const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest", apiKey: "key", fetchImpl });
    const decision = await provider.decide(decisionRequest, new AbortController().signal);
    expect(decision.operationChoiceId).toBe("click");
    expect(decision.targetChoiceId).toBe("t2");
  });

  it("offers a text_candidate head extracted from the goal, and uses the model's choice as typed text", async () => {
    const request: DecisionRequest = {
      runId: "run-1", goal: 'Set the filename field to "hello.txt"',
      observation,
      recentSummaries: [],
      operationChoices: operationChoices(undefined, observation.targets),
    };
    const { fetchImpl, calls } = fakeSystemOne({
      operation: choiceAnswer("type"),
      type_text_target: choiceAnswer("t1"),
      text_candidate: choiceAnswer("c0"),
      submit: noulAnswer(0.05),
      goal_complete_after: noulAnswer(0.05),
    });
    const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest", apiKey: "key", fetchImpl });
    const decision = await provider.decide(request, new AbortController().signal);
    expect(decision.typedText).toBe("hello.txt");
    const questions = calls[0]!.body.questions as Record<string, { criteria: Record<string, string> }>;
    expect(questions.text_candidate!.criteria).toEqual({ c0: "hello.txt", none: "No extracted candidate fits" });
  });

  it("escalates to the agent instead of typing when the chosen operation needs text but no candidate fits", async () => {
    const request: DecisionRequest = {
      runId: "run-1", goal: "Click the Save button",
      observation,
      recentSummaries: [],
      operationChoices: operationChoices(undefined, observation.targets),
    };
    const { fetchImpl } = fakeSystemOne({
      operation: choiceAnswer("type"),
      type_text_target: choiceAnswer("t1"),
      text_candidate: choiceAnswer("none"),
      submit: noulAnswer(0.05),
      goal_complete_after: noulAnswer(0.05),
    });
    const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest", apiKey: "key", fetchImpl });
    await expect(provider.decide(request, new AbortController().signal)).rejects.toThrow(EscalateToAgentError);
  });

  it("asks for submit only alongside type/set_value/type_window, and honors yes", async () => {
    const request: DecisionRequest = {
      runId: "run-1", goal: 'Type the command: echo hi and press Enter',
      observation: { ...observation, targets: [] },
      recentSummaries: [],
      operationChoices: operationChoices(undefined, []),
    };
    const { fetchImpl, calls } = fakeSystemOne({
      operation: choiceAnswer("type_window"),
      press_key_choice: choiceAnswer("none"),
      text_candidate: choiceAnswer("c0"),
      submit: noulAnswer(0.95),
      goal_complete_after: noulAnswer(0.05),
    });
    const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest", apiKey: "key", fetchImpl });
    const decision = await provider.decide(request, new AbortController().signal);
    expect(decision.submit).toBe(true);
    expect(decision.typedText).toBe("echo hi");
    const questions = calls[0]!.body.questions as Record<string, unknown>;
    expect(Object.keys(questions)).toContain("submit");
  });

  it("does not offer a submit head when no offered operation needs one", async () => {
    const request: DecisionRequest = {
      runId: "run-1", goal: "Save the file",
      observation: { ...observation, targets: [] },
      recentSummaries: [],
      operationChoices: operationChoices(["done", "blocked"], []),
    };
    const { fetchImpl, calls } = fakeSystemOne({ operation: choiceAnswer("done"), goal_complete_after: noulAnswer(0.05) });
    const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest", apiKey: "key", fetchImpl });
    await provider.decide(request, new AbortController().signal);
    const questions = calls[0]!.body.questions as Record<string, unknown>;
    expect(Object.keys(questions)).not.toContain("submit");
    expect(Object.keys(questions)).not.toContain("text_candidate");
  });

  it("reports usage.cost and the served model from the response envelope, sending the run id as session_id", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(
        JSON.stringify({
          id: "gen-dec-1",
          model: "typesafe/jev-1.13-20260917",
          provider: "TypeSafe",
          answers: { operation: choiceAnswer("done"), goal_complete_after: noulAnswer(0.05) },
          usage: { cost: 0.000036, input_tokens: 400, output_tokens: 60 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "typesafe/jev-1.13", apiKey: "key", fetchImpl });
    const decision = await provider.decide(decisionRequest, new AbortController().signal);
    expect(decision.costUsd).toBe(0.000036);
    expect(decision.servedModel).toBe("typesafe/jev-1.13-20260917");
    expect(calls[0]!.body.session_id).toBe("run-1");
  });

  it("uses min(operation, target) confidence", async () => {
    const { fetchImpl } = fakeSystemOne({
      operation: choiceAnswer("click", 0.9),
      click_target: choiceAnswer("t0", 0.6),
      goal_complete_after: noulAnswer(0.05),
    });
    const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest", apiKey: "key", fetchImpl });
    const decision = await provider.decide(decisionRequest, new AbortController().signal);
    expect(decision.confidence).toBe(0.6);
  });

  it("rejects an operation outside the supplied choices or an invalid head value", async () => {
    const signal = new AbortController().signal;
    const badAnswerSets = [
      { operation: choiceAnswer("scroll") },
      { operation: choiceAnswer("click"), click_target: choiceAnswer("t1") },
      { operation: choiceAnswer("click") },
    ];
    for (const answers of badAnswerSets) {
      const { fetchImpl } = fakeSystemOne(answers);
      const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest", apiKey: "key", fetchImpl });
      await expect(provider.decide(decisionRequest, signal)).rejects.toThrow(/System One/);
    }
  });

  it("stops waiting when the run is cancelled", async () => {
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const provider = new JevDecisionProvider({ endpoint: "https://openrouter.ai/api/alpha/decisions", model: "~typesafe/jev-latest", apiKey: "key", fetchImpl });
    const abort = new AbortController();
    const pending = provider.decide(decisionRequest, abort.signal);
    abort.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
  });
});

describe("createDecisionBackend", () => {
  const empty: DecisionConfig = {
    computerTypesafeApiKey: "",
    computerTypesafeEndpoint: "https://typesafe.test/v1/systemone",
    computerTypesafeModel: "jev-1",
    computerOpenRouterApiKey: "",
    computerOpenRouterDecisionModel: "typesafe/jev-1.13",
    openRouterApiKey: "",
  };

  it("prefers TypeSafe, then OpenRouter, then no backend", () => {
    const typesafe = createDecisionBackend({ ...empty, computerTypesafeApiKey: "ts", openRouterApiKey: "or" });
    expect(typesafe?.provider).toBeInstanceOf(JevDecisionProvider);
    const openRouter = createDecisionBackend({ ...empty, openRouterApiKey: "or" });
    expect(openRouter?.provider).toBeInstanceOf(JevDecisionProvider);
    expect(createDecisionBackend({ ...empty, computerOpenRouterApiKey: " ", openRouterApiKey: " " })).toBeNull();
  });

  it("uses the OpenRouter Decisions API endpoint and the configured decision model when no TypeSafe key is set", async () => {
    const signal = new AbortController().signal;
    const { fetchImpl, calls } = fakeSystemOne({ operation: choiceAnswer("done"), goal_complete_after: noulAnswer(0.05) });
    const backend = createDecisionBackend({ ...empty, openRouterApiKey: "or" }, fetchImpl)!;
    await backend.provider.decide(
      { runId: "run-1", goal: "Save the file", observation: { ...observation, targets: [] }, recentSummaries: [], operationChoices: operationChoices(["done", "blocked"], []) },
      signal,
    );
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(calls[0]!.body.model).toBe("typesafe/jev-1.13");
    expect(calls[0]!.body.session_id).toBe("run-1");
  });

  it("uses the TypeSafe endpoint and model when a TypeSafe key is configured", async () => {
    const signal = new AbortController().signal;
    const { fetchImpl, calls } = fakeSystemOne({ operation: choiceAnswer("done"), goal_complete_after: noulAnswer(0.05) });
    const backend = createDecisionBackend({ ...empty, computerTypesafeApiKey: "ts" }, fetchImpl)!;
    await backend.provider.decide(
      { runId: "run-1", goal: "Save the file", observation: { ...observation, targets: [] }, recentSummaries: [], operationChoices: operationChoices(["done", "blocked"], []) },
      signal,
    );
    expect(calls[0]!.url).toBe("https://typesafe.test/v1/systemone");
    expect(calls[0]!.body.model).toBe("jev-1");
  });

  it("uses the Computer OpenRouter key and falls back to the server key", async () => {
    const signal = new AbortController().signal;
    for (const [config, expected] of [
      [{ ...empty, computerOpenRouterApiKey: "computer-key", openRouterApiKey: "server-key" }, "Bearer computer-key"],
      [{ ...empty, openRouterApiKey: "server-key" }, "Bearer server-key"],
    ] as const) {
      const { fetchImpl, calls } = fakeSystemOne({ operation: choiceAnswer("click"), click_target: choiceAnswer("t0"), goal_complete_after: noulAnswer(0.05) });
      await createDecisionBackend(config, fetchImpl)!.provider.decide(decisionRequest, signal);
      expect(calls[0]!.authorization).toBe(expected);
      expect(calls[0]!.url).toBe("https://openrouter.ai/api/alpha/decisions");
    }
  });
});
