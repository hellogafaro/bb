import { describe, expect, it } from "vitest";
import {
  JevDecisionProvider,
  OpenRouterJevDecisionProvider,
  OpenRouterTextGenerator,
  createDecisionBackend,
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

describe("verifyTargetFresh", () => {
  it("passes through an operation whose target is still in the observation", () => {
    const operation = toOperation({ operationChoiceId: "click", targetChoiceId: "t0", confidence: 1 }, observation, null);
    expect(verifyTargetFresh(observation, operation)).toEqual(operation);
  });

  it("blocks instead of executing against a target that vanished from the observation", () => {
    const operation = toOperation({ operationChoiceId: "click", targetChoiceId: "gone", confidence: 1 }, observation, null);
    const guarded = verifyTargetFresh(observation, operation);
    expect(guarded.kind).toBe("blocked");
  });

  it("leaves target-less operations untouched", () => {
    const operation = toOperation({ operationChoiceId: "done", targetChoiceId: null, confidence: 1 }, observation, null);
    expect(verifyTargetFresh(observation, operation)).toEqual(operation);
  });
});

describe("postActionWaitMs", () => {
  it("caps a non-type action to 50ms", () => {
    const operation = toOperation({ operationChoiceId: "click", targetChoiceId: "t0", confidence: 1 }, observation, null);
    expect(postActionWaitMs(operation, observation)).toBe(50);
  });

  it("caps typing into a plain text field to 50ms", () => {
    const operation = toOperation({ operationChoiceId: "type", targetChoiceId: "t1", confidence: 1 }, observation, "hi");
    expect(postActionWaitMs(operation, observation)).toBe(50);
  });

  it("caps typing into a combobox/search field to 200ms", () => {
    const comboObservation: Observation = {
      ...observation,
      targets: [
        { index: 0, targetId: "t3", role: "searchbox", name: "Search", value: "", bounds: null, ref: null, allowedOperations: ["type"] },
      ],
    };
    const operation = toOperation({ operationChoiceId: "type", targetChoiceId: "t3", confidence: 1 }, comboObservation, "hi");
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

interface RecordedCall {
  readonly url: string;
  readonly authorization: string | null;
  readonly body: Record<string, unknown>;
}

function fakeOpenRouter(...contents: unknown[]): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const content = contents[calls.length] ?? contents[contents.length - 1];
    calls.push({
      url: String(input),
      authorization: new Headers(init?.headers).get("authorization"),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const messageContent = typeof content === "string" ? content : JSON.stringify(content);
    return new Response(JSON.stringify({ choices: [{ message: { content: messageContent } }] }), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const decisionRequest: DecisionRequest = {
  goal: "Save the file",
  observation,
  recentSummaries: [],
  operationChoices: operationChoices(undefined, observation.targets),
};

interface DecisionSchema {
  properties: Record<string, { enum: string[] }>;
  required: string[];
}

function responseSchema(call: RecordedCall): DecisionSchema {
  const format = call.body.response_format as { json_schema: { strict: boolean; schema: DecisionSchema } };
  expect(format.json_schema.strict).toBe(true);
  return format.json_schema.schema;
}

describe("OpenRouterJevDecisionProvider", () => {
  it("emits one speculative target head per operation that needs one, each filtered to compatible targets plus none", async () => {
    const { fetchImpl, calls } = fakeOpenRouter({
      operation: "select",
      click_target: "none",
      type_text_target: "none",
      set_value_target: "none",
      select_target: "t2",
    });
    const provider = new OpenRouterJevDecisionProvider({ model: "typesafe/jev-router", apiKey: "key", fetchImpl });
    const decision = await provider.decide(decisionRequest, new AbortController().signal);
    expect(decision).toEqual({ operationChoiceId: "select", targetChoiceId: "t2", confidence: null });
    const schema = responseSchema(calls[0]!);
    expect(schema.properties.operation!.enum).toEqual(expect.arrayContaining(["click", "type", "set_value", "select", "wait", "done", "blocked"]));
    expect(schema.properties.click_target!.enum).toEqual(["t0", "t2", "none"]);
    expect(schema.properties.type_text_target!.enum).toEqual(["t1", "none"]);
    expect(schema.properties.set_value_target!.enum).toEqual(["t1", "none"]);
    expect(schema.properties.select_target!.enum).toEqual(["t2", "none"]);
    expect(schema.properties.scroll_target).toBeUndefined();
    expect(schema.required.sort()).toEqual(
      ["operation", "click_target", "type_text_target", "set_value_target", "select_target"].sort(),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.model).toBe("typesafe/jev-router");
    expect(calls[0]!.body.reasoning).toEqual({ effort: "low" });
  });

  it("executes the target from the head matching the chosen operation, ignoring other heads", async () => {
    const { fetchImpl } = fakeOpenRouter({
      operation: "click",
      click_target: "t2",
      type_text_target: "t1",
      set_value_target: "t1",
      select_target: "t2",
    });
    const provider = new OpenRouterJevDecisionProvider({ model: "typesafe/jev-router", apiKey: "key", fetchImpl });
    const decision = await provider.decide(decisionRequest, new AbortController().signal);
    expect(decision).toEqual({ operationChoiceId: "click", targetChoiceId: "t2", confidence: null });
  });

  it("does not offer an operation with no compatible target and emits no head for it", async () => {
    const noSelectObservation: Observation = {
      ...observation,
      targets: observation.targets.map((target) =>
        target.targetId === "t2" ? { ...target, allowedOperations: ["click" as const] } : target,
      ),
    };
    const request: DecisionRequest = {
      ...decisionRequest,
      observation: noSelectObservation,
      operationChoices: operationChoices(undefined, noSelectObservation.targets),
    };
    const { fetchImpl, calls } = fakeOpenRouter({ operation: "click", click_target: "t0" });
    const provider = new OpenRouterJevDecisionProvider({ model: "typesafe/jev-router", apiKey: "key", fetchImpl });
    await provider.decide(request, new AbortController().signal);
    const schema = responseSchema(calls[0]!);
    expect(schema.properties.select_target).toBeUndefined();
    expect(schema.properties.operation!.enum).not.toContain("select");
  });

  it("omits target heads entirely when no operation needs one", async () => {
    const noTargetObservation: Observation = { ...observation, targets: [] };
    const request: DecisionRequest = {
      goal: "Save the file",
      observation: noTargetObservation,
      recentSummaries: [],
      operationChoices: operationChoices(undefined, noTargetObservation.targets),
    };
    const { fetchImpl, calls } = fakeOpenRouter({ operation: "done" });
    const provider = new OpenRouterJevDecisionProvider({ model: "typesafe/jev-router", apiKey: "key", fetchImpl });
    const decision = await provider.decide(request, new AbortController().signal);
    expect(decision.targetChoiceId).toBeNull();
    expect(Object.keys(responseSchema(calls[0]!).properties)).toEqual(["operation"]);
  });

  it("rejects an operation outside the supplied choices, an invalid head value, or malformed JSON", async () => {
    const signal = new AbortController().signal;
    const badAnswers = [
      { operation: "scroll" },
      { operation: "click", click_target: "t1" },
      { operation: "click", click_target: "none" },
      { operation: "click" },
      "not json",
    ];
    for (const content of badAnswers) {
      const { fetchImpl } = fakeOpenRouter(content);
      const provider = new OpenRouterJevDecisionProvider({ model: "typesafe/jev-router", apiKey: "key", fetchImpl });
      await expect(provider.decide(decisionRequest, signal)).rejects.toThrow(/OpenRouter Jev/);
    }
  });

  it("stops waiting when the run is cancelled", async () => {
    const fetchImpl = ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const provider = new OpenRouterJevDecisionProvider({ model: "typesafe/jev-router", apiKey: "key", fetchImpl });
    const abort = new AbortController();
    const pending = provider.decide(decisionRequest, abort.signal);
    abort.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
  });
});

describe("JevDecisionProvider", () => {
  function fakeTypesafe(...answers: Array<Record<string, unknown>>): { fetchImpl: typeof fetch; calls: RecordedCall[] } {
    const calls: RecordedCall[] = [];
    const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
      const answer = answers[calls.length] ?? answers[answers.length - 1];
      calls.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ answers: answer }), { status: 200 });
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  it("asks for a target only among choices compatible with the operation it just decided", async () => {
    const { fetchImpl, calls } = fakeTypesafe(
      { operation: { choice: "select", confidence: 0.9 } },
      { target: { choice: "t2", confidence: 0.8 } },
    );
    const provider = new JevDecisionProvider({ endpoint: "https://typesafe.test/v1/systemone", model: "jev-1", apiKey: "key", fetchImpl });
    const decision = await provider.decide(decisionRequest, new AbortController().signal);
    expect(decision).toEqual({ operationChoiceId: "select", targetChoiceId: "t2", confidence: 0.8 });
    expect(calls).toHaveLength(2);
    const secondQuestions = calls[1]!.body.questions as { target: { criteria: Record<string, string> } };
    expect(Object.keys(secondQuestions.target.criteria)).toEqual(["t2"]);
  });

  it("skips the second call entirely when the decided operation needs no target", async () => {
    const { fetchImpl, calls } = fakeTypesafe({ operation: { choice: "done", confidence: 1 } });
    const provider = new JevDecisionProvider({ endpoint: "https://typesafe.test/v1/systemone", model: "jev-1", apiKey: "key", fetchImpl });
    const decision = await provider.decide(decisionRequest, new AbortController().signal);
    expect(decision).toEqual({ operationChoiceId: "done", targetChoiceId: null, confidence: 1 });
    expect(calls).toHaveLength(1);
  });
});

describe("OpenRouterTextGenerator", () => {
  it("parses a strict JSON {text} object, disables reasoning, and rejects malformed content", async () => {
    const { fetchImpl, calls } = fakeOpenRouter({ text: "hello.txt" });
    const generator = new OpenRouterTextGenerator({ model: "inception/mercury-2.5", apiKey: "key", fetchImpl });
    const value = await generator.generate({ goal: "Save the file", targetLabel: "text: Filename" }, new AbortController().signal);
    expect(value).toBe("hello.txt");
    expect(calls[0]!.body.reasoning).toEqual({ enabled: false });
    const format = calls[0]!.body.response_format as { json_schema: { strict: boolean; schema: { required: string[] } } };
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema.required).toEqual(["text"]);

    const { fetchImpl: badFetch } = fakeOpenRouter({ notText: "oops" });
    const badGenerator = new OpenRouterTextGenerator({ model: "inception/mercury-2.5", apiKey: "key", fetchImpl: badFetch });
    await expect(
      badGenerator.generate({ goal: "Save the file", targetLabel: "text: Filename" }, new AbortController().signal),
    ).rejects.toThrow(/text/);
  });

  it("reuses the cached value on a stale retry when the whole input is unchanged, and regenerates when it changes", async () => {
    const { fetchImpl, calls } = fakeOpenRouter({ text: "first" }, { text: "second" });
    const generator = new OpenRouterTextGenerator({ model: "inception/mercury-2.5", apiKey: "key", fetchImpl });
    const signal = new AbortController().signal;
    const input = { goal: "Save the file", targetLabel: "text: Filename" };
    const first = await generator.generate(input, signal);
    const retry = await generator.generate({ ...input }, signal);
    expect(retry).toBe(first);
    expect(calls).toHaveLength(1);

    const changed = await generator.generate({ goal: "Save the file", targetLabel: "text: Other field" }, signal);
    expect(changed).toBe("second");
    expect(calls).toHaveLength(2);
  });
});

describe("createDecisionBackend", () => {
  const empty: DecisionConfig = {
    computerTypesafeApiKey: "",
    computerTypesafeEndpoint: "https://typesafe.test/v1/systemone",
    computerTypesafeModel: "jev-1",
    computerOpenRouterApiKey: "",
    computerOpenRouterDecisionModel: "typesafe/jev-router",
    computerOpenRouterTextModel: "inception/mercury-2.5",
    openRouterApiKey: "",
  };

  it("prefers TypeSafe, then OpenRouter, then no backend", () => {
    const typesafe = createDecisionBackend({ ...empty, computerTypesafeApiKey: "ts", openRouterApiKey: "or" });
    expect(typesafe?.provider).toBeInstanceOf(JevDecisionProvider);
    expect(typesafe?.textGenerator).not.toBeNull();
    const openRouter = createDecisionBackend({ ...empty, openRouterApiKey: "or" });
    expect(openRouter?.provider).toBeInstanceOf(OpenRouterJevDecisionProvider);
    expect(createDecisionBackend({ ...empty, computerOpenRouterApiKey: " ", openRouterApiKey: " " })).toBeNull();
  });

  it("decides with the decision model and generates text with the text model", async () => {
    const signal = new AbortController().signal;
    const { fetchImpl, calls } = fakeOpenRouter({ operation: "done" }, { text: "hi" });
    const noTargetObservation: Observation = { ...observation, targets: [] };
    const backend = createDecisionBackend({ ...empty, openRouterApiKey: "or" }, fetchImpl)!;
    await backend.provider.decide(
      { goal: "Save the file", observation: noTargetObservation, recentSummaries: [], operationChoices: operationChoices(undefined, []) },
      signal,
    );
    expect(calls[0]!.body.model).toBe("typesafe/jev-router");
    await backend.textGenerator!.generate({ goal: "Save the file", targetLabel: "text: Filename" }, signal);
    expect(calls[1]!.body.model).toBe("inception/mercury-2.5");
  });

  it("uses the Computer OpenRouter key and falls back to the server key", async () => {
    const signal = new AbortController().signal;
    for (const [config, expected] of [
      [{ ...empty, computerOpenRouterApiKey: "computer-key", openRouterApiKey: "server-key" }, "Bearer computer-key"],
      [{ ...empty, openRouterApiKey: "server-key" }, "Bearer server-key"],
    ] as const) {
      const { fetchImpl, calls } = fakeOpenRouter({ operation: "click", click_target: "t0" });
      await createDecisionBackend(config, fetchImpl)!.provider.decide(decisionRequest, signal);
      expect(calls[0]!.authorization).toBe(expected);
      expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    }
  });
});
