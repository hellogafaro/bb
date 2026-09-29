import { describe, expect, it } from "vitest";
import { doOutputSchema } from "./contracts.js";
import {
  buildStepScript,
  createOpenRouterBrowserJevProvider,
  extractTextCandidates,
  extractUrlCandidates,
  parseSnapshotTargets,
  resolveJevApiKey,
  RetryableJevDecisionError,
  runJevGoal,
  splitTextSegments,
  TypeSafeDecisionsJevProvider,
  type JevDecision,
  type JevProvider,
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
        selectedOption: null,
      },
      {
        ref: "e2",
        role: "link",
        name: "A Light in the Attic",
        attrs: "",
        selectedOption: null,
      },
      {
        ref: "e3",
        role: "textbox",
        name: "Search",
        attrs: "",
        selectedOption: null,
      },
      {
        ref: "e4",
        role: "button",
        name: "Go",
        attrs: "",
        selectedOption: null,
      },
      {
        ref: "e5",
        role: "combobox",
        name: "Sort by:",
        attrs: "",
        selectedOption: null,
      },
    ]);
  });

  it("keeps unnamed elements (checkboxes, native selects), de-duplicates refs, and caps at maxTargets", () => {
    const snapshot = `
- generic [ref=e1]
- link "Home" [ref=e2]
- link "Home" [ref=e2]
- link "About" [ref=e3]
`;
    expect(parseSnapshotTargets(snapshot).map((t) => t.ref)).toEqual([
      "e1",
      "e2",
      "e3",
    ]);
    expect(parseSnapshotTargets(snapshot, 1)).toHaveLength(1);
  });

  it("parses an unlabeled checkbox and a native select with no quoted name", () => {
    const snapshot = `
- heading "Checkboxes" [level=3] [ref=e9]
- checkbox [ref=e11]
- checkbox [checked] [ref=e12]
- combobox [ref=e10]:
  - option "Option 1"
  - option "Option 2"
`;
    const targets = parseSnapshotTargets(snapshot);
    expect(targets).toEqual([
      {
        ref: "e9",
        role: "heading",
        name: "Checkboxes",
        attrs: "[level=3]",
        selectedOption: null,
      },
      {
        ref: "e11",
        role: "checkbox",
        name: "",
        attrs: "",
        selectedOption: null,
      },
      {
        ref: "e12",
        role: "checkbox",
        name: "",
        attrs: "[checked]",
        selectedOption: null,
      },
      {
        ref: "e10",
        role: "combobox",
        name: "",
        attrs: "",
        selectedOption: null,
      },
    ]);
  });

  it("reads a native select's current value from its nested [selected] option, not its own line", () => {
    const snapshot = `
- combobox [ref=e10]:
  - option "Please select an option" [disabled]
  - option "Option 1"
  - option "Option 2" [selected]
- link "Elemental Selenium" [ref=e15]
`;
    const targets = parseSnapshotTargets(snapshot);
    expect(targets.find((t) => t.ref === "e10")?.selectedOption).toBe(
      "Option 2",
    );
    expect(targets.find((t) => t.ref === "e15")?.selectedOption).toBeNull();
  });
});

describe("extractTextCandidates", () => {
  it("extracts quoted strings from the goal", () => {
    expect(
      extractTextCandidates(
        "log in with username 'tomsmith' and password 'SuperSecretPassword!'",
      ),
    ).toEqual(["tomsmith", "SuperSecretPassword!"]);
  });

  it("extracts text after type/enter/search for/fill keywords when unquoted", () => {
    expect(extractTextCandidates("search for wireless mice")).toContain(
      "wireless mice",
    );
  });

  it("de-duplicates and caps candidates", () => {
    const goal = Array.from({ length: 15 }, (_, i) => `'value${i}'`).join(
      " and ",
    );
    expect(extractTextCandidates(goal).length).toBeLessThanOrEqual(10);
  });
});

describe("extractUrlCandidates", () => {
  it("extracts URLs literally present in the goal and the page text, de-duplicated", () => {
    expect(
      extractUrlCandidates(
        "Go to https://example.com and report the title.",
        "",
      ),
    ).toEqual(["https://example.com"]);
    expect(
      extractUrlCandidates(
        "Go to https://example.com.",
        "See also https://example.com and https://other.com",
      ),
    ).toEqual(["https://example.com", "https://other.com"]);
  });

  it("returns no candidates when neither the goal nor the page names a URL", () => {
    expect(
      extractUrlCandidates("click the first result", "no links here"),
    ).toEqual([]);
  });
});

describe("splitTextSegments", () => {
  it("splits on sentence boundaries and newlines, de-duplicating and capping", () => {
    const segments = splitTextSegments(
      "Price £51.77. In stock.\nFree returns.",
    );
    expect(segments).toEqual(["Price £51.77.", "In stock.", "Free returns."]);
  });

  it("caps at maxSegments", () => {
    const text = Array.from({ length: 10 }, (_, i) => `Sentence ${i}.`).join(
      " ",
    );
    expect(splitTextSegments(text, 3)).toHaveLength(3);
  });
});

function decision(partial: Partial<JevDecision>): JevDecision {
  return {
    action: "scroll_down",
    ref: null,
    value: null,
    url: null,
    answer: "",
    submit: false,
    goalCompleteAfter: false,
    costUsd: 0,
    ...partial,
  };
}

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
    const script = buildStepScript(decision({ action: "click", ref: "e6" }));
    expect(script).toContain('await page.click("ref/e6")');
    expect(script).toContain("setTimeout(resolve, 50)");
  });

  it("fails the action instead of interpolating a missing ref", () => {
    const script = buildStepScript(
      decision({ action: "fill", ref: null, value: "hello" }),
    );
    expect(script).not.toContain("page.fill");
    expect(script).toContain('actError = "missing ref"');
  });

  it("settles 200ms after a fill", () => {
    const script = buildStepScript(
      decision({ action: "fill", ref: "e3", value: "hello" }),
    );
    expect(script).toContain('await page.fill("ref/e3", "hello")');
    expect(script).toContain("setTimeout(resolve, 200)");
  });

  it("scrolls the page without a ref", () => {
    expect(buildStepScript(decision({ action: "scroll_down" }))).toContain(
      "window.scrollBy(0, window.innerHeight * 0.85)",
    );
    expect(buildStepScript(decision({ action: "scroll_up" }))).toContain(
      "window.scrollBy(0, -window.innerHeight * 0.85)",
    );
  });

  it("presses Enter without a ref", () => {
    expect(buildStepScript(decision({ action: "press_enter" }))).toContain(
      'await page.keyboard.press("Enter")',
    );
  });

  it("navigates by URL", () => {
    expect(
      buildStepScript(decision({ action: "goto", url: "https://example.com" })),
    ).toContain('await page.goto("https://example.com"');
  });

  it("selects an option by its visible text instead of page.select's value attribute", () => {
    const script = buildStepScript(
      decision({ action: "select", ref: "e10", value: "Option 2" }),
    );
    expect(script).not.toContain("page.select(");
    expect(script).toContain("page.$eval(");
    expect(script).toContain('"Option 2"');
    expect(script).toContain("candidate.textContent.trim() === label");
    expect(script).toContain('el.dispatchEvent(new Event("change"');
  });

  it("appends a submit keypress only after a fill, not other actions", () => {
    const fillScript = buildStepScript(
      decision({ action: "fill", ref: "e3", value: "hi", submit: true }),
    );
    expect(fillScript).toContain('await page.keyboard.press("Enter")');
    const clickScript = buildStepScript(
      decision({ action: "click", ref: "e2", submit: true }),
    );
    expect(clickScript.match(/keyboard\.press\("Enter"\)/g) ?? []).toHaveLength(
      0,
    );
  });
});

describe("resolveJevApiKey / createOpenRouterBrowserJevProvider", () => {
  it("reads only the shared OPENROUTER_API_KEY", () => {
    expect(resolveJevApiKey({ OPENROUTER_API_KEY: "generic-key" })).toBe(
      "generic-key",
    );
    expect(resolveJevApiKey({})).toBeNull();
  });

  it("returns null and no provider when no key is set", () => {
    expect(resolveJevApiKey({})).toBeNull();
    expect(createOpenRouterBrowserJevProvider({})).toBeNull();
  });

  it("builds a provider when a key is present, always pinned to typesafe/jev-1.13 with no env override", () => {
    expect(
      createOpenRouterBrowserJevProvider({ OPENROUTER_API_KEY: "k" })?.model,
    ).toBe("typesafe/jev-1.13");
    expect(
      createOpenRouterBrowserJevProvider({
        OPENROUTER_API_KEY: "k",
        COMPUTER_OPENROUTER_DECISION_MODEL: "typesafe/jev-2",
      })?.model,
    ).toBe("typesafe/jev-1.13");
  });

  it("builds a provider when a key is present", () => {
    expect(
      createOpenRouterBrowserJevProvider({ OPENROUTER_API_KEY: "k" }),
    ).not.toBeNull();
  });
});

function decisionsFetch(body: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
}

function nouls(
  overrides: Record<string, number> = {},
): Record<string, unknown> {
  return {
    submit: { type: "noul", noul: overrides.submit ?? 0 },
    goal_complete_after: {
      type: "noul",
      noul: overrides.goal_complete_after ?? 0,
    },
  };
}

describe("TypeSafeDecisionsJevProvider", () => {
  it("sends session_id, the goal/url/title/visible_text, and the shared elements table with every request", async () => {
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
            ...nouls(),
          },
          usage: { cost: 0.00002 },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    const decision1 = await provider.decide(
      {
        goal: "open the first book",
        observation: {
          url: "https://books.toscrape.com",
          title: "Books",
          snapshot: BOOKS_SNAPSHOT,
          text: "Price £51.77",
        },
        recentOutcomes: [],
        runId: "run-1",
      },
      new AbortController().signal,
    );
    expect(decision1).toEqual({
      action: "click",
      ref: "e2",
      value: null,
      url: null,
      answer: "",
      submit: false,
      goalCompleteAfter: false,
      costUsd: 0.00002,
    });
    if (typeof requestBody !== "object" || requestBody === null)
      throw new Error("expected a request body");
    const body = requestBody as {
      model: string;
      session_id: string;
      state: Record<string, unknown>;
      questions: Record<string, unknown>;
    };
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.session_id).toBe("run-1");
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
        "submit",
        "goal_complete_after",
        "answer_evidence",
      ]),
    );
    const clickTarget = body.questions.click_target as {
      criteria: Record<string, string>;
    };
    expect(clickTarget.criteria.e2).toContain("A Light in the Attic");
    const elements = body.state.elements as Record<string, unknown>;
    expect(elements.e2).toEqual({
      role: "link",
      name: "A Light in the Attic",
      value: null,
      checked: false,
      selected: false,
      disabled: false,
    });
  });

  it("does not offer goto when the goal and page have no literal URL", async () => {
    let requestBody: unknown;
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          answers: { operation: { choice: "scroll_down" }, ...nouls() },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    await provider.decide(
      {
        goal: "scroll and look around",
        observation: { url: "u", title: "t", snapshot: "", text: "" },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    const body = requestBody as { questions: Record<string, unknown> };
    expect(
      Object.keys(
        (body.questions.operation as { criteria: Record<string, string> })
          .criteria,
      ),
    ).not.toContain("goto");
    expect(body.questions.goto_url).toBeUndefined();
  });

  it("puts checked/selected/value state in the shared elements table, seen by every question", async () => {
    const snapshot = `
- heading "Checkboxes" [level=3] [ref=e9]
- checkbox [ref=e11]
- checkbox [checked] [ref=e12]
`;
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
            click_target: { choice: "e11" },
            ...nouls(),
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    await provider.decide(
      {
        goal: "make sure both checkboxes are checked",
        observation: {
          url: "https://example.com/checkboxes",
          title: "Checkboxes",
          snapshot,
          text: "checkbox 1 checkbox 2",
        },
        recentOutcomes: ["click e11 : ok"],
        runId: "r",
      },
      new AbortController().signal,
    );
    const body = requestBody as {
      state: { elements: Record<string, unknown> };
    };
    expect(body.state.elements).toEqual({
      e9: {
        role: "heading",
        name: "Checkboxes",
        value: null,
        checked: false,
        selected: false,
        disabled: false,
      },
      e11: {
        role: "checkbox",
        name: "",
        value: null,
        checked: false,
        selected: false,
        disabled: false,
      },
      e12: {
        role: "checkbox",
        name: "",
        value: null,
        checked: true,
        selected: false,
        disabled: false,
      },
    });
  });

  it("resolves fill text locally from a goal-quoted candidate, without any text-generation call", async () => {
    let requestBody: unknown;
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          answers: {
            operation: { choice: "fill" },
            fill_target: { choice: "e3" },
            fill_text: { choice: "t0" },
            ...nouls(),
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.decide(
      {
        goal: "search for 'Ada Lovelace'",
        observation: {
          url: "https://en.wikipedia.org",
          title: "Wikipedia",
          snapshot: BOOKS_SNAPSHOT,
          text: "",
        },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      action: "fill",
      ref: "e3",
      value: "Ada Lovelace",
    });
    const body = requestBody as {
      questions: { fill_text: { criteria: Record<string, string> } };
    };
    expect(body.questions.fill_text.criteria.t0).toBe("Ada Lovelace");
  });

  it("resolves a goto URL locally from a literal in the goal, without any text-generation call", async () => {
    const fetchImpl = decisionsFetch({
      answers: {
        operation: { choice: "goto" },
        goto_url: { choice: "u0" },
        ...nouls(),
      },
    });
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.decide(
      {
        goal: "go to https://example.com and report the heading",
        observation: { url: "about:blank", title: "", snapshot: "", text: "" },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      action: "goto",
      url: "https://example.com",
    });
  });

  it("blocks instead of guessing when fill has no offered text candidate", async () => {
    const fetchImpl = decisionsFetch({
      answers: {
        operation: { choice: "fill" },
        fill_target: { choice: "e3" },
        fill_text: { choice: "none" },
        ...nouls(),
      },
    });
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.decide(
      {
        goal: "fill the search box with something relevant",
        observation: {
          url: "u",
          title: "t",
          snapshot: BOOKS_SNAPSHOT,
          text: "",
        },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    expect(result.action).toBe("blocked");
    expect(result.answer).toMatch(/no literal text/i);
  });

  it("resolves the done answer from a locally-segmented visible-text candidate, without any text-generation call", async () => {
    const fetchImpl = decisionsFetch({
      answers: {
        operation: { choice: "done" },
        answer_evidence: { choice: "s1" },
        ...nouls(),
      },
    });
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.decide(
      {
        goal: "report the book's price",
        observation: {
          url: "u",
          title: "Book",
          snapshot: "",
          text: "Price £51.77. In stock.",
        },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    expect(result).toMatchObject({ action: "done", answer: "Price £51.77." });
  });

  it("offers the page title and checked/selected element state as answer_evidence, not just visible text", async () => {
    const snapshot = `
- heading "Checkboxes" [level=3] [ref=e9]
- checkbox [checked] [ref=e11]
- checkbox [checked] [ref=e12]
`;
    let requestBody: unknown;
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          answers: {
            operation: { choice: "done" },
            answer_evidence: { choice: "s0" },
            ...nouls(),
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    await provider.decide(
      {
        goal: "make sure both checkboxes are checked and report their state",
        observation: {
          url: "u",
          title: "Checkboxes",
          snapshot,
          text: "checkbox 1 checkbox 2",
        },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    const body = requestBody as {
      questions: { answer_evidence: { criteria: Record<string, string> } };
    };
    const criteriaValues = Object.values(
      body.questions.answer_evidence.criteria,
    );
    expect(criteriaValues).toContain("Checkboxes");
    expect(criteriaValues).toContain("checkbox 1 checked");
    expect(criteriaValues).toContain("checkbox 2 checked");
    expect(criteriaValues).toContain("checkbox 1 checked, checkbox 2 checked");
  });

  it("falls back to the raw visible text when no segment answers the goal", async () => {
    const fetchImpl = decisionsFetch({
      answers: {
        operation: { choice: "done" },
        answer_evidence: { choice: "none" },
        ...nouls(),
      },
    });
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.decide(
      {
        goal: "report something",
        observation: {
          url: "u",
          title: "t",
          snapshot: "",
          text: "fallback text",
        },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    expect(result.answer).toBe("fallback text");
  });

  it("reads submit and goal_complete_after from noul probabilities against their thresholds", async () => {
    const fetchImpl = decisionsFetch({
      answers: {
        operation: { choice: "fill" },
        fill_target: { choice: "e3" },
        fill_text: { choice: "t0" },
        submit: { type: "noul", noul: 0.9 },
        goal_complete_after: { type: "noul", noul: 0.9 },
      },
    });
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.decide(
      {
        goal: "search for 'cats'",
        observation: {
          url: "u",
          title: "t",
          snapshot: BOOKS_SNAPSHOT,
          text: "",
        },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    expect(result.submit).toBe(true);
    expect(result.goalCompleteAfter).toBe(true);
  });

  it("does not treat a middling goal_complete_after probability as complete", async () => {
    const fetchImpl = decisionsFetch({
      answers: {
        operation: { choice: "click" },
        click_target: { choice: "e2" },
        ...nouls({ goal_complete_after: 0.5 }),
      },
    });
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.decide(
      {
        goal: "open the book",
        observation: {
          url: "u",
          title: "t",
          snapshot: BOOKS_SNAPSHOT,
          text: "",
        },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    expect(result.goalCompleteAfter).toBe(false);
  });

  it("re-asks once with the outcome recorded when the target head answers none, and succeeds", async () => {
    let call = 0;
    const seenRecentOutcomes: string[][] = [];
    const fetchImpl = (async (
      _url: string | URL | Request,
      init?: RequestInit,
    ) => {
      call += 1;
      const body = JSON.parse(String(init?.body)) as {
        state: { recent_outcomes: string[] };
      };
      seenRecentOutcomes.push(body.state.recent_outcomes);
      const choice = call === 1 ? "none" : "e12";
      return new Response(
        JSON.stringify({
          answers: {
            operation: { choice: "click" },
            click_target: { choice },
            ...nouls(),
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.decide(
      {
        goal: "make sure both checkboxes are checked",
        observation: {
          url: "u",
          title: "t",
          snapshot: "- checkbox [ref=e11]\n- checkbox [checked] [ref=e12]",
          text: "",
        },
        recentOutcomes: ["click e11 : ok"],
        runId: "r",
      },
      new AbortController().signal,
    );
    expect(call).toBe(2);
    expect(result).toMatchObject({ action: "click", ref: "e12" });
    expect(seenRecentOutcomes[0]).toEqual(["click e11 : ok"]);
    expect(seenRecentOutcomes[1]).toHaveLength(2);
    expect(seenRecentOutcomes[1]?.[1]).toContain('target answered "none"');
  });

  it("throws a retryable error when the target head answers none twice in a row", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      return new Response(
        JSON.stringify({
          answers: {
            operation: { choice: "click" },
            click_target: { choice: "none" },
            ...nouls(),
          },
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    const provider = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl,
    });
    await expect(
      provider.decide(
        {
          goal: "click something",
          observation: {
            url: "u",
            title: "t",
            snapshot: "- checkbox [ref=e11]",
            text: "",
          },
          recentOutcomes: [],
          runId: "r",
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(RetryableJevDecisionError);
    expect(call).toBe(2);
  });

  it("throws a retryable error on malformed JSON, missing answers, or an invalid choice", async () => {
    const malformed = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: (async () =>
        new Response("not json", { status: 200 })) as typeof fetch,
    });
    await expect(
      malformed.decide(
        {
          goal: "g",
          observation: { url: "u", title: "t", snapshot: "", text: "" },
          recentOutcomes: [],
          runId: "r",
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(RetryableJevDecisionError);

    const missingAnswers = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: decisionsFetch({}),
    });
    await expect(
      missingAnswers.decide(
        {
          goal: "g",
          observation: { url: "u", title: "t", snapshot: "", text: "" },
          recentOutcomes: [],
          runId: "r",
        },
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(RetryableJevDecisionError);

    const invalidChoice = new TypeSafeDecisionsJevProvider({
      apiKey: "k",
      fetchImpl: decisionsFetch({
        answers: { operation: { choice: "fly_to_the_moon" }, ...nouls() },
      }),
    });
    await expect(
      invalidChoice.decide(
        {
          goal: "g",
          observation: { url: "u", title: "t", snapshot: "", text: "" },
          recentOutcomes: [],
          runId: "r",
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
    });
    const promise = provider.decide(
      {
        goal: "g",
        observation: { url: "u", title: "t", snapshot: "", text: "" },
        recentOutcomes: [],
        runId: "r",
      },
      new AbortController().signal,
    );
    await expect(promise).rejects.toThrow(
      "OpenRouter Decisions API returned HTTP 500",
    );
    await expect(promise).rejects.not.toBeInstanceOf(RetryableJevDecisionError);
  });
});

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
  it("drives click steps to a done decision and reports the final answer, url, and title", async () => {
    const decisions: JevDecision[] = [
      decision({ action: "click", ref: "e6", costUsd: 0.00001 }),
      decision({
        action: "done",
        answer: "Found the result",
        costUsd: 0.00002,
      }),
    ];
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => decisions[decideCalls++],
      model: "typesafe/jev-1.13",
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
    expect(result.url).toBe("https://example.com");
    expect(result.title).toBe("Example");
    expect(result.costUsd).toBeCloseTo(0.00003);
    expect(result.model).toBe("typesafe/jev-1.13");
    expect(scripts).toHaveLength(2);
    expect(scripts[1]).toContain('await page.click("ref/e6")');
    expect(result.steps.map((step) => step.action)).toEqual(["click", "done"]);
  });

  it("finishes speculatively on goal_complete_after without a further decide() call", async () => {
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => {
        decideCalls += 1;
        return decision({
          action: "click",
          ref: "e6",
          goalCompleteAfter: true,
          costUsd: 0.00001,
        });
      },
    };
    const result = await runJevGoal({
      goal: "click submit",
      maxSteps: 5,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async () =>
        observationResult('button "Submit" [ref=e6]', "Thanks for submitting!"),
    });
    expect(decideCalls).toBe(1);
    expect(result.state).toBe("done");
    expect(result.answer).toBe("Thanks for submitting!");
    expect(result.costUsd).toBeCloseTo(0.00001);
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
    for (const step of result.steps) {
      expect(step.outcome.length).toBeLessThanOrEqual(400);
      expect(step.target === null || step.target.length <= 200).toBe(true);
    }
    expect(
      doOutputSchema.parse({
        state: result.state,
        answer: result.answer,
        url: result.url,
        title: result.title,
        steps: result.steps,
        image: null,
        costUsd: result.costUsd,
        model: result.model,
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

  it("degrades to blocked instead of crashing the run when a retryable error fails twice in a row", async () => {
    let decideCalls = 0;
    const provider: JevProvider = {
      decide: async () => {
        decideCalls += 1;
        throw new RetryableJevDecisionError(
          "OpenRouter Decisions API returned an invalid click target",
        );
      },
    };
    const result = await runJevGoal({
      goal: "click something that keeps failing validation",
      maxSteps: 5,
      stepTimeoutMs: 1_000,
      signal: new AbortController().signal,
      provider,
      runScript: async () => observationResult("generic [ref=e1]"),
    });
    expect(decideCalls).toBe(2);
    expect(result.state).toBe("blocked");
    expect(result.answer).toContain("invalid click target");
  });
});
