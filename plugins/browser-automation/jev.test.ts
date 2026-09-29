import { describe, expect, it } from "vitest";
import { doOutputSchema } from "./contracts.js";
import {
  buildStepScript,
  createOpenRouterBrowserJevProvider,
  OpenRouterTextGenerator,
  parseSnapshotTargets,
  resolveJevApiKey,
  RetryableJevDecisionError,
  runJevGoal,
  TypeSafeDecisionsJevProvider,
  type JevDecision,
  type JevProvider,
  type TextGenerator,
} from "./jev.js";

const BOOKS_SNAPSHOT = `
- heading "Books to Scrape" [level=1] [ref=e1]
- link "A Light in the Attic" [ref=e2]
- textbox "Search" [ref=e3]
- button "Go" [ref=e4]
- combobox "Sort by:" [ref=e5]
`;

describe("parseSnapshotTargets", () => {
  it("extracts role, name, and ref from an ARIA snapshot", () => {
    const targets = parseSnapshotTargets(BOOKS_SNAPSHOT);
    expect(targets).toEqual([
      {
        ref: "e1",
        role: "heading",
        name: "Books to Scrape",
        attrs: "[level=1]",
      },
      { ref: "e2", role: "link", name: "A Light in the Attic", attrs: "" },
      { ref: "e3", role: "textbox", name: "Search", attrs: "" },
      { ref: "e4", role: "button", name: "Go", attrs: "" },
      { ref: "e5", role: "combobox", name: "Sort by:", attrs: "" },
    ]);
  });

  it("skips unnamed elements and de-duplicates refs, and caps at maxTargets", () => {
    const snapshot = `
- generic [ref=e1]
- link "Home" [ref=e2]
- link "Home" [ref=e2]
- link "About" [ref=e3]
`;
    expect(parseSnapshotTargets(snapshot).map((t) => t.ref)).toEqual([
      "e2",
      "e3",
    ]);
    expect(parseSnapshotTargets(snapshot, 1)).toHaveLength(1);
  });
});

describe("buildStepScript", () => {
  it("only observes when there is no pending decision, with no fixed waitForLoad", () => {
    const script = buildStepScript(null);
    expect(script).not.toContain("page.click");
    expect(script).toContain("page.snapshot(");
    expect(script).toContain(
      "actOk, actError, url: page.url(), title, snapshot, text",
    );
    expect(script).toContain("if (page.url() !== urlBefore)");
  });

  it("extracts visible page text with a bounded page.evaluate call", () => {
    const script = buildStepScript(null);
    expect(script).toContain("await page.evaluate(");
    expect(script).toContain("document.body.innerText");
    expect(script).toContain(", 3000)");
  });

  it("embeds a click action by ref and settles 50ms before the next observation", () => {
    const decision: JevDecision = {
      action: "click",
      ref: "e6",
      value: null,
      url: null,
      answer: "",
    };
    const script = buildStepScript(decision);
    expect(script).toContain('await page.click("ref/e6")');
    expect(script).toContain("setTimeout(resolve, 50)");
  });

  it("fails the action instead of interpolating a missing ref", () => {
    const decision: JevDecision = {
      action: "fill",
      ref: null,
      value: "hello",
      url: null,
      answer: "",
    };
    const script = buildStepScript(decision);
    expect(script).not.toContain("page.fill");
    expect(script).toContain('actError = "missing ref"');
  });

  it("settles 200ms after a fill", () => {
    const decision: JevDecision = {
      action: "fill",
      ref: "e3",
      value: "hello",
      url: null,
      answer: "",
    };
    const script = buildStepScript(decision);
    expect(script).toContain('await page.fill("ref/e3", "hello")');
    expect(script).toContain("setTimeout(resolve, 200)");
  });

  it("scrolls the page without a ref", () => {
    expect(
      buildStepScript({
        action: "scroll_down",
        ref: null,
        value: null,
        url: null,
        answer: "",
      }),
    ).toContain("window.scrollBy(0, window.innerHeight * 0.85)");
    expect(
      buildStepScript({
        action: "scroll_up",
        ref: null,
        value: null,
        url: null,
        answer: "",
      }),
    ).toContain("window.scrollBy(0, -window.innerHeight * 0.85)");
  });

  it("presses Enter without a ref", () => {
    const script = buildStepScript({
      action: "press_enter",
      ref: null,
      value: null,
      url: null,
      answer: "",
    });
    expect(script).toContain('await page.keyboard.press("Enter")');
  });

  it("navigates by URL", () => {
    const script = buildStepScript({
      action: "goto",
      ref: null,
      value: null,
      url: "https://example.com",
      answer: "",
    });
    expect(script).toContain('await page.goto("https://example.com"');
  });
});

describe("resolveJevApiKey / createOpenRouterBrowserJevProvider", () => {
  it("prefers COMPUTER_OPENROUTER_API_KEY over OPENROUTER_API_KEY", () => {
    expect(
      resolveJevApiKey({
        COMPUTER_OPENROUTER_API_KEY: "computer-key",
        OPENROUTER_API_KEY: "generic-key",
      }),
    ).toBe("computer-key");
    expect(resolveJevApiKey({ OPENROUTER_API_KEY: "generic-key" })).toBe(
      "generic-key",
    );
  });

  it("returns null and no provider when neither key is set", () => {
    expect(resolveJevApiKey({})).toBeNull();
    expect(createOpenRouterBrowserJevProvider({})).toBeNull();
  });

  it("builds a provider when a key is present", () => {
    expect(
      createOpenRouterBrowserJevProvider({ OPENROUTER_API_KEY: "k" }),
    ).not.toBeNull();
  });
});

describe("TypeSafeDecisionsJevProvider", () => {
  function fakeTextGenerator(
    value: string | ((input: { instructions: string }) => string),
  ): TextGenerator {
    return {
      async generate(input) {
        return typeof value === "function" ? value(input) : value;
      },
    };
  }

  function decisionsFetch(body: unknown): typeof fetch {
    return (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
  }

  it("offers click/fill/select targets and sends the goal, url, title, and visible text", async () => {
    let requestBody: unknown;
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          answers: {
            operation: { choice: "click" },
            click_target: { choice: "e2" },
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
      textGenerator: fakeTextGenerator(""),
    });
    const decision = await provider.decide(
      {
        goal: "open the first book",
        observation: {
          url: "https://books.toscrape.com",
          title: "Books",
          snapshot: BOOKS_SNAPSHOT,
          text: "Price £51.77",
        },
        recentOutcomes: [],
      },
      new AbortController().signal,
    );
    expect(decision).toEqual({
      action: "click",
      ref: "e2",
      value: null,
      url: null,
      answer: "",
    });
    if (typeof requestBody !== "object" || requestBody === null)
      throw new Error("expected a request body");
    const body = requestBody as {
      model: string;
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    };
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.state).toMatchObject({
      goal: "open the first book",
      page: { url: "https://books.toscrape.com", title: "Books" },
      visible_text: "Price £51.77",
    });
    expect(Object.keys(body.questions)).toEqual(
      expect.arrayContaining([
        "operation",
        "click_target",
        "fill_target",
        "select_target",
      ]),
    );
    const clickTarget = body.questions.click_target as {
      criteria: Record<string, string>;
    };
    expect(clickTarget.criteria.e2).toContain("A Light in the Attic");
    expect(clickTarget.criteria.none).toBeDefined();
  });

  it("resolves a fill value from the text generator using the target's label", async () => {
    const seenInstructions: string[] = [];
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: decisionsFetch({
        answers: {
          operation: { choice: "fill" },
          fill_target: { choice: "e3" },
        },
      }),
      textGenerator: fakeTextGenerator((input) => {
        seenInstructions.push(input.instructions);
        return "Ada Lovelace";
      }),
    });
    const decision = await provider.decide(
      {
        goal: "search for Ada Lovelace",
        observation: {
          url: "https://en.wikipedia.org",
          title: "Wikipedia",
          snapshot: BOOKS_SNAPSHOT,
          text: "",
        },
        recentOutcomes: [],
      },
      new AbortController().signal,
    );
    expect(decision).toEqual({
      action: "fill",
      ref: "e3",
      value: "Ada Lovelace",
      url: null,
      answer: "",
    });
    expect(seenInstructions[0]).toMatch(/type into this field/i);
  });

  it("resolves a goto URL and a done answer from the text generator", async () => {
    const gotoProvider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: decisionsFetch({ answers: { operation: { choice: "goto" } } }),
      textGenerator: fakeTextGenerator("https://example.com"),
    });
    const gotoDecision = await gotoProvider.decide(
      {
        goal: "go to example.com",
        observation: { url: "about:blank", title: "", snapshot: "", text: "" },
        recentOutcomes: [],
      },
      new AbortController().signal,
    );
    expect(gotoDecision).toEqual({
      action: "goto",
      ref: null,
      value: null,
      url: "https://example.com",
      answer: "",
    });

    const doneProvider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: decisionsFetch({ answers: { operation: { choice: "done" } } }),
      textGenerator: fakeTextGenerator("Example Domain"),
    });
    const doneDecision = await doneProvider.decide(
      {
        goal: "report the heading",
        observation: {
          url: "https://example.com",
          title: "Example Domain",
          snapshot: "",
          text: "Example Domain",
        },
        recentOutcomes: [],
      },
      new AbortController().signal,
    );
    expect(doneDecision).toEqual({
      action: "done",
      ref: null,
      value: null,
      url: null,
      answer: "Example Domain",
    });
  });

  it("answers blocked without calling the text generator", async () => {
    let generateCalls = 0;
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: decisionsFetch({
        answers: { operation: { choice: "blocked" } },
      }),
      textGenerator: {
        async generate() {
          generateCalls += 1;
          return "";
        },
      },
    });
    const decision = await provider.decide(
      {
        goal: "log in",
        observation: {
          url: "https://example.com",
          title: "",
          snapshot: "",
          text: "",
        },
        recentOutcomes: [],
      },
      new AbortController().signal,
    );
    expect(decision.action).toBe("blocked");
    expect(decision.answer.length).toBeGreaterThan(0);
    expect(generateCalls).toBe(0);
  });

  it("throws a retryable error on malformed JSON, missing answers, or an invalid choice", async () => {
    const textGenerator = fakeTextGenerator("");
    const malformed = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: (async () =>
        new Response("not json", { status: 200 })) as typeof fetch,
      textGenerator,
    });
    await expect(
      malformed.decide(
        {
          goal: "g",
          observation: { url: "u", title: "t", snapshot: "", text: "" },
          recentOutcomes: [],
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(RetryableJevDecisionError);

    const missingAnswers = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: decisionsFetch({}),
      textGenerator,
    });
    await expect(
      missingAnswers.decide(
        {
          goal: "g",
          observation: { url: "u", title: "t", snapshot: "", text: "" },
          recentOutcomes: [],
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(RetryableJevDecisionError);

    const invalidChoice = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: decisionsFetch({
        answers: { operation: { choice: "fly_to_the_moon" } },
      }),
      textGenerator,
    });
    await expect(
      invalidChoice.decide(
        {
          goal: "g",
          observation: { url: "u", title: "t", snapshot: "", text: "" },
          recentOutcomes: [],
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(RetryableJevDecisionError);
  });

  it("throws a non-retryable error on an HTTP failure", async () => {
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: (async () =>
        new Response("server error", { status: 500 })) as typeof fetch,
      textGenerator: fakeTextGenerator(""),
    });
    const promise = provider.decide(
      {
        goal: "g",
        observation: { url: "u", title: "t", snapshot: "", text: "" },
        recentOutcomes: [],
      },
      new AbortController().signal,
    );
    await expect(promise).rejects.toThrow(
      "OpenRouter Decisions API returned HTTP 500",
    );
    await expect(promise).rejects.not.toBeInstanceOf(RetryableJevDecisionError);
  });

  it("wraps a text-generator failure as retryable", async () => {
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: decisionsFetch({ answers: { operation: { choice: "done" } } }),
      textGenerator: {
        async generate() {
          throw new Error("network blip");
        },
      },
    });
    await expect(
      provider.decide(
        {
          goal: "g",
          observation: { url: "u", title: "t", snapshot: "", text: "" },
          recentOutcomes: [],
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(RetryableJevDecisionError);
  });
});

describe("OpenRouterTextGenerator", () => {
  it("disables reasoning, requests strict JSON, and caches identical inputs", async () => {
    let calls = 0;
    let requestBody: Record<string, unknown> | undefined;
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      calls += 1;
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          choices: [
            { message: { content: JSON.stringify({ text: "Ada Lovelace" }) } },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const generator = new OpenRouterTextGenerator({ apiKey: "k", fetchImpl });
    const input = {
      goal: "search",
      instructions: "type this",
      context: "Search box",
    };
    const first = await generator.generate(input, new AbortController().signal);
    const second = await generator.generate(
      input,
      new AbortController().signal,
    );
    expect(first).toBe("Ada Lovelace");
    expect(second).toBe("Ada Lovelace");
    expect(calls).toBe(1);
    expect(requestBody?.model).toBe("inception/mercury-2.5");
    expect(requestBody?.reasoning).toEqual({ enabled: false });
  });
});

function decision(partial: Partial<JevDecision>): JevDecision {
  return {
    action: "scroll_down",
    ref: null,
    value: null,
    url: null,
    answer: "",
    ...partial,
  };
}

function observationResult(snapshot: string, pageText = "") {
  return {
    text: JSON.stringify({
      actOk: true,
      actError: null,
      url: "https://example.com",
      title: "Example",
      snapshot,
      text: pageText,
    }),
  };
}

describe("runJevGoal", () => {
  it("drives click steps to a done decision and reports the final answer", async () => {
    const decisions: JevDecision[] = [
      decision({ action: "click", ref: "e6" }),
      decision({ action: "done", answer: "Found the result" }),
    ];
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => decisions[decideCalls++],
    };
    const scripts: string[] = [];
    const result = await runJevGoal({
      goal: "find the result",
      maxSteps: 5,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async (script) => {
        scripts.push(script);
        return observationResult('heading "Result" [ref=e9]');
      },
    });
    expect(result.state).toBe("done");
    expect(result.answer).toBe("Found the result");
    expect(scripts).toHaveLength(2);
    expect(scripts[1]).toContain('await page.click("ref/e6")');
    expect(result.steps.map((step) => step.action)).toEqual(["click", "done"]);
  });

  it("stops immediately on a blocked decision without acting", async () => {
    const provider: JevProvider = {
      decide: async () =>
        decision({
          action: "blocked",
          answer: "Cannot proceed: a CAPTCHA is blocking the page",
        }),
    };
    const result = await runJevGoal({
      goal: "buy the item",
      maxSteps: 5,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async () => observationResult("generic [ref=e1]"),
    });
    expect(result.state).toBe("blocked");
    expect(result.steps).toHaveLength(1);
  });

  it("gives up after maxSteps and reports the last answer", async () => {
    const provider: JevProvider = {
      decide: async () => decision({ action: "click", ref: "e2" }),
    };
    const result = await runJevGoal({
      goal: "an impossible task",
      maxSteps: 3,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async () => observationResult('button "Next" [ref=e2]'),
    });
    expect(result.state).toBe("max_steps");
    expect(result.steps).toHaveLength(2);
  });

  it("records a failed action outcome instead of throwing", async () => {
    const provider: JevProvider = {
      decide: async () => decision({ action: "done", answer: "gave up" }),
    };
    const result = await runJevGoal({
      goal: "click a stale ref",
      maxSteps: 5,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async () => ({
        text: JSON.stringify({
          actOk: false,
          actError: 'Ref "e6" is stale or unknown',
          url: "https://example.com",
          title: "Example",
          snapshot: "generic [ref=e1]",
          text: "",
        }),
      }),
    });
    expect(result.state).toBe("done");
  });

  it("passes the extracted visible page text through to the decision request", async () => {
    const seen: string[] = [];
    const provider: JevProvider = {
      decide: async (request) => {
        seen.push(request.observation.text);
        return decision({ action: "done", answer: "$19.99" });
      },
    };
    const result = await runJevGoal({
      goal: "report the book's price",
      maxSteps: 5,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async () =>
        observationResult(
          'heading "A Light in the Attic" [ref=e3]',
          "Price £51.77 In stock",
        ),
    });
    expect(result.state).toBe("done");
    expect(seen).toEqual(["Price £51.77 In stock"]);
  });

  it("clamps a long answer and a long action error into doOutputSchema's step limits", async () => {
    const longAnswer = "a".repeat(1_000);
    const longError = "b".repeat(1_000);
    const decisions: JevDecision[] = [
      decision({ action: "click", ref: "e6" }),
      decision({ action: "done", answer: longAnswer }),
    ];
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => decisions[decideCalls++],
    };
    const result = await runJevGoal({
      goal: "trigger a long error and a long final answer",
      maxSteps: 5,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async () => ({
        text: JSON.stringify({
          actOk: false,
          actError: longError,
          url: "https://example.com",
          title: "Example",
          snapshot: "generic [ref=e1]",
          text: "",
        }),
      }),
    });
    expect(result.state).toBe("done");
    expect(result.answer).toBe(longAnswer);
    expect(result.answer.length).toBe(1_000);
    for (const step of result.steps) {
      expect(step.outcome.length).toBeLessThanOrEqual(400);
      expect(step.target === null || step.target.length <= 200).toBe(true);
    }
    expect(
      doOutputSchema.parse({
        state: result.state,
        answer: result.answer,
        steps: result.steps,
        image: null,
      }),
    ).toMatchObject({ state: "done" });
  });

  it("retries a decision once after a retryable error, then succeeds", async () => {
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => {
        decideCalls += 1;
        if (decideCalls === 1)
          throw new RetryableJevDecisionError(
            "OpenRouter Decisions API returned malformed JSON",
          );
        return decision({ action: "done", answer: "recovered" });
      },
    };
    const result = await runJevGoal({
      goal: "recover from a truncated decision",
      maxSteps: 5,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async () => observationResult("generic [ref=e1]"),
    });
    expect(decideCalls).toBe(2);
    expect(result.state).toBe("done");
    expect(result.answer).toBe("recovered");
  });

  it("does not retry a plain HTTP error", async () => {
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => {
        decideCalls += 1;
        throw new Error("OpenRouter Decisions API returned HTTP 500");
      },
    };
    await expect(
      runJevGoal({
        goal: "fail fast on an HTTP error",
        maxSteps: 5,
        stepTimeoutMs: 1_000,
        signal: new AbortController().signal,
        provider,
        runScript: async () => observationResult("generic [ref=e1]"),
      }),
    ).rejects.toThrow("OpenRouter Decisions API returned HTTP 500");
    expect(decideCalls).toBe(1);
  });

  it("does not retry once the run signal is already aborted", async () => {
    let decideCalls = 0;
    const controller = new AbortController();
    const provider: JevProvider = {
      decide: async () => {
        decideCalls += 1;
        controller.abort();
        throw new RetryableJevDecisionError(
          "OpenRouter Decisions API decision timed out",
        );
      },
    };
    await expect(
      runJevGoal({
        goal: "fail fast once aborted",
        maxSteps: 5,
        stepTimeoutMs: 1_000,
        signal: controller.signal,
        provider,
        runScript: async () => observationResult("generic [ref=e1]"),
      }),
    ).rejects.toBeInstanceOf(RetryableJevDecisionError);
    expect(decideCalls).toBe(1);
  });
});
