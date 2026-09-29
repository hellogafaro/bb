import { describe, expect, it } from "vitest";
import { doOutputSchema } from "./contracts.js";
import {
  buildStepScript,
  createOpenRouterBrowserJevProvider,
  parseJevDecision,
  resolveJevApiKey,
  runJevGoal,
  type JevDecision,
  type JevProvider,
} from "./jev.js";

describe("parseJevDecision", () => {
  it("rejects a missing or invalid action", () => {
    expect(() => parseJevDecision(null)).toThrow(/omitted a decision/);
    expect(() => parseJevDecision({ action: "hover" })).toThrow(
      /invalid action/,
    );
  });

  it("cleans a well-formed decision and drops unsafe fields", () => {
    const decision = parseJevDecision({
      action: "click",
      ref: "e6",
      value: "",
      url: "",
      key: "Enter",
      submit: true,
      goal_complete_after: true,
      answer: "clicked the button",
    });
    expect(decision).toEqual({
      action: "click",
      ref: "e6",
      value: null,
      url: null,
      key: "Enter",
      submit: true,
      goalCompleteAfter: true,
      answer: "clicked the button",
    });
  });

  it("drops a ref that is not a bare snapshot id, to block script injection", () => {
    const decision = parseJevDecision({
      action: "click",
      ref: 'e6"); await page.goto("https://evil.example',
      value: null,
      url: null,
      key: null,
      submit: false,
      goal_complete_after: false,
      answer: "",
    });
    expect(decision.ref).toBeNull();
  });
});

describe("buildStepScript", () => {
  it("only observes when there is no pending decision", () => {
    const script = buildStepScript(null);
    expect(script).not.toContain("page.click");
    expect(script).toContain("page.snapshot(");
    expect(script).toContain(
      "actOk, actError, url: page.url(), title, snapshot",
    );
  });

  it("embeds a click action by ref and always re-observes afterward", () => {
    const decision: JevDecision = {
      action: "click",
      ref: "e6",
      value: null,
      url: null,
      key: null,
      submit: false,
      goalCompleteAfter: false,
      answer: "",
    };
    const script = buildStepScript(decision);
    expect(script).toContain('await page.click("ref/e6")');
    expect(script).toContain("page.snapshot(");
  });

  it("fails the action instead of interpolating a missing ref", () => {
    const decision: JevDecision = {
      action: "fill",
      ref: null,
      value: "hello",
      url: null,
      key: null,
      submit: false,
      goalCompleteAfter: false,
      answer: "",
    };
    const script = buildStepScript(decision);
    expect(script).not.toContain("page.fill");
    expect(script).toContain('actError = "missing ref"');
  });

  it("appends a submit keypress after fill when requested", () => {
    const decision: JevDecision = {
      action: "fill",
      ref: "e3",
      value: "hello",
      url: null,
      key: null,
      submit: true,
      goalCompleteAfter: false,
      answer: "",
    };
    const script = buildStepScript(decision);
    expect(script).toContain('await page.fill("ref/e3", "hello")');
    expect(script).toContain('await page.keyboard.press("Enter")');
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

function decision(partial: Partial<JevDecision>): JevDecision {
  return {
    action: "wait",
    ref: null,
    value: null,
    url: null,
    key: null,
    submit: false,
    goalCompleteAfter: false,
    answer: "",
    ...partial,
  };
}

function observationResult(snapshot: string) {
  return {
    text: JSON.stringify({
      actOk: true,
      actError: null,
      url: "https://example.com",
      title: "Example",
      snapshot,
    }),
  };
}

describe("runJevGoal", () => {
  it("drives click steps to a done decision and reports the final answer", async () => {
    const decisions: JevDecision[] = [
      decision({ action: "click", ref: "e6", answer: "clicking search" }),
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

  it("stops the goal_complete_after action from executing twice and reports done", async () => {
    const provider: JevProvider = {
      decide: async () =>
        decision({
          action: "click",
          ref: "e2",
          goalCompleteAfter: true,
          answer: "Submitted the form",
        }),
    };
    let runs = 0;
    const result = await runJevGoal({
      goal: "submit the form",
      maxSteps: 5,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async () => {
        runs += 1;
        return observationResult('button "Submit" [ref=e2]');
      },
    });
    expect(result.state).toBe("done");
    expect(result.answer).toBe("Submitted the form");
    expect(runs).toBe(2);
  });

  it("gives up after maxSteps and reports the last answer", async () => {
    const provider: JevProvider = {
      decide: async () =>
        decision({ action: "click", ref: "e2", answer: "still looking" }),
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
    expect(result.answer).toBe("still looking");
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
        }),
      }),
    });
    expect(result.state).toBe("done");
  });

  it("clamps a long answer and a long action error into doOutputSchema's step limits", async () => {
    const longAnswer = "a".repeat(1_000);
    const longError = "b".repeat(1_000);
    const decisions: JevDecision[] = [
      decision({ action: "click", ref: "e6", answer: "clicking" }),
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

  it("retries a decision once after a malformed or invalid response, then succeeds", async () => {
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => {
        decideCalls += 1;
        if (decideCalls === 1)
          throw new Error("OpenRouter Jev returned malformed JSON");
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

  it("does not retry an HTTP error", async () => {
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => {
        decideCalls += 1;
        throw new Error("OpenRouter Jev returned HTTP 500");
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
    ).rejects.toThrow("OpenRouter Jev returned HTTP 500");
    expect(decideCalls).toBe(1);
  });

  it("does not retry an abort error", async () => {
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => {
        decideCalls += 1;
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      },
    };
    await expect(
      runJevGoal({
        goal: "fail fast on an abort error",
        maxSteps: 5,
        stepTimeoutMs: 1_000,
        signal: new AbortController().signal,
        provider,
        runScript: async () => observationResult("generic [ref=e1]"),
      }),
    ).rejects.toThrow("The operation was aborted");
    expect(decideCalls).toBe(1);
  });
});
