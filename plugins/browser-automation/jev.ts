import type { DoStep } from "./contracts.js";

export const JEV_ACTIONS = [
  "click",
  "double_click",
  "fill",
  "select",
  "press_key",
  "scroll",
  "goto",
  "wait",
  "done",
  "blocked",
] as const;
export type JevAction = (typeof JEV_ACTIONS)[number];

export const JEV_KEYS = ["Enter", "Escape", "Tab"] as const;
export type JevKey = (typeof JEV_KEYS)[number];

export interface JevDecision {
  readonly action: JevAction;
  readonly ref: string | null;
  readonly value: string | null;
  readonly url: string | null;
  readonly key: string | null;
  readonly submit: boolean;
  readonly goalCompleteAfter: boolean;
  readonly answer: string;
}

export interface JevObservation {
  readonly url: string;
  readonly title: string;
  readonly snapshot: string;
}

export interface JevDecisionRequest {
  readonly goal: string;
  readonly observation: JevObservation;
  readonly recentOutcomes: readonly string[];
}

export interface JevProvider {
  decide(request: JevDecisionRequest, signal: AbortSignal): Promise<JevDecision>;
}

const REF_PATTERN = /^[A-Za-z0-9]+$/;
const MAX_TEXT_LENGTH = 2_000;

function cleanRef(value: unknown): string | null {
  return typeof value === "string" && REF_PATTERN.test(value) ? value : null;
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT_LENGTH ? value : null;
}

function cleanKey(value: unknown): string | null {
  return typeof value === "string" && (JEV_KEYS as readonly string[]).includes(value) ? value : null;
}

export function parseJevDecision(value: unknown): JevDecision {
  if (value === null || typeof value !== "object") throw new Error("OpenRouter Jev omitted a decision");
  const record = value as Record<string, unknown>;
  const action = record.action;
  if (typeof action !== "string" || !(JEV_ACTIONS as readonly string[]).includes(action)) {
    throw new Error("OpenRouter Jev returned an invalid action");
  }
  return {
    action: action as JevAction,
    ref: cleanRef(record.ref),
    value: cleanText(record.value),
    url: cleanText(record.url),
    key: cleanKey(record.key),
    submit: record.submit === true,
    goalCompleteAfter: record.goal_complete_after === true,
    answer: typeof record.answer === "string" ? record.answer.slice(0, 4_000) : "",
  };
}

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const JEV_ROUTER_MODEL = "typesafe/jev-router";

const SYSTEM_PROMPT =
  "You are Jev, the fast decision step of a browser automation loop. You receive a goal, the current page's URL and title, an ARIA accessibility snapshot with element refs like [ref=e6], and recent action outcomes. Pick exactly one next action. Use ref for click/double_click/fill/select/scroll actions, choosing a ref that literally appears in the snapshot. Use value for fill/select text. Use url only for goto. Use key only for press_key. Set submit true only when pressing Enter right after fill should submit the field (a search box or single-field form). Set goal_complete_after true only when this action is expected to fully satisfy the goal. Always fill answer with your best current answer to the goal given what you know so far; it is used verbatim if this is the final step.";

export interface OpenRouterBrowserJevOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class OpenRouterBrowserJevProvider implements JevProvider {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetchImpl: typeof fetch;

  constructor(options: OpenRouterBrowserJevOptions) {
    if (options.apiKey.trim().length === 0) throw new Error("OpenRouter API key is missing");
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? JEV_ROUTER_MODEL;
    this.#endpoint = options.endpoint ?? OPENROUTER_CHAT_COMPLETIONS_URL;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  async decide(request: JevDecisionRequest, signal: AbortSignal): Promise<JevDecision> {
    const state = {
      goal: request.goal,
      page: { url: request.observation.url, title: request.observation.title },
      snapshot: request.observation.snapshot,
      recent_outcomes: request.recentOutcomes,
    };
    const schema = {
      type: "object",
      properties: {
        action: { type: "string", enum: [...JEV_ACTIONS] },
        ref: { type: "string" },
        value: { type: "string" },
        url: { type: "string" },
        key: { type: "string", enum: [...JEV_KEYS] },
        submit: { type: "boolean" },
        goal_complete_after: { type: "boolean" },
        answer: { type: "string" },
      },
      required: ["action", "ref", "value", "url", "key", "submit", "goal_complete_after", "answer"],
      additionalProperties: false,
    };
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const response = await this.#fetchImpl(this.#endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(state) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "browser_decision", strict: true, schema },
        },
        max_tokens: 600,
        reasoning: { effort: "low" },
      }),
      signal: AbortSignal.any([timeout, signal]),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OpenRouter Jev returned HTTP ${response.status}`);
    const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("OpenRouter Jev response omitted content");
    let answers: unknown;
    try {
      answers = JSON.parse(content);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("OpenRouter Jev returned malformed JSON");
      throw error;
    }
    return parseJevDecision(answers);
  }
}

export function resolveJevApiKey(env: NodeJS.ProcessEnv): string | null {
  const key = env.COMPUTER_OPENROUTER_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim();
  return key !== undefined && key.length > 0 ? key : null;
}

export function createOpenRouterBrowserJevProvider(
  env: NodeJS.ProcessEnv = process.env,
): OpenRouterBrowserJevProvider | null {
  const apiKey = resolveJevApiKey(env);
  if (apiKey === null) return null;
  const model = env.COMPUTER_OPENROUTER_DECISION_MODEL?.trim();
  return new OpenRouterBrowserJevProvider({
    apiKey,
    ...(model !== undefined && model.length > 0 ? { model } : {}),
  });
}

function refLiteral(ref: string): string {
  return JSON.stringify(`ref/${ref}`);
}

function actionCode(decision: JevDecision): string {
  switch (decision.action) {
    case "click":
      return decision.ref === null
        ? 'actOk = false; actError = "missing ref";'
        : `try { await page.click(${refLiteral(decision.ref)}); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "double_click":
      return decision.ref === null
        ? 'actOk = false; actError = "missing ref";'
        : `try { await page.click(${refLiteral(decision.ref)}, { count: 2 }); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "fill":
      return decision.ref === null
        ? 'actOk = false; actError = "missing ref";'
        : `try { await page.fill(${refLiteral(decision.ref)}, ${JSON.stringify(decision.value ?? "")}); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "select":
      return decision.ref === null
        ? 'actOk = false; actError = "missing ref";'
        : `try { await page.select(${refLiteral(decision.ref)}, ${JSON.stringify(decision.value ?? "")}); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "press_key":
      return `try { await page.keyboard.press(${JSON.stringify(decision.key ?? "Enter")}); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "scroll":
      return decision.ref === null
        ? 'actOk = false; actError = "missing ref";'
        : `try { await page.$eval(${refLiteral(decision.ref)}, (el) => el.scrollIntoView({ block: "center" })); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "goto":
      return decision.url === null
        ? 'actOk = false; actError = "missing url";'
        : `try { await page.goto(${JSON.stringify(decision.url)}, { waitUntil: "domcontentloaded" }); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "wait":
      return "await new Promise((resolve) => setTimeout(resolve, 500));";
    case "done":
    case "blocked":
      return "";
  }
}

function submitCode(decision: JevDecision): string {
  if (!decision.submit) return "";
  return 'if (actOk) { try { await page.keyboard.press("Enter"); } catch (e) { actOk = false; actError = String((e && e.message) || e); } }';
}

export function buildStepScript(decision: JevDecision | null): string {
  const action = decision === null ? "" : [actionCode(decision), submitCode(decision)].filter(Boolean).join("\n");
  return [
    'const page = await browser.getPage("main");',
    "let actOk = true;",
    "let actError = null;",
    action,
    'try { await page.waitForLoad({ timeout: 2000 }); } catch {}',
    "let snapshot;",
    'try { snapshot = await page.snapshot({ interactive: true, maxChars: 12000 }); } catch (e) { snapshot = "snapshot unavailable: " + String((e && e.message) || e); }',
    'let title = "";',
    "try { title = await page.title(); } catch {}",
    "({ actOk, actError, url: page.url(), title, snapshot });",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

interface StepResult {
  readonly actOk: boolean;
  readonly actError: string | null;
  readonly url: string;
  readonly title: string;
  readonly snapshot: string;
}

function parseStepResult(text: string): StepResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Browser step script returned malformed output");
  }
  if (parsed === null || typeof parsed !== "object") throw new Error("Browser step script returned no data");
  const record = parsed as Record<string, unknown>;
  if (typeof record.url !== "string" || typeof record.snapshot !== "string") {
    throw new Error("Browser step script omitted page state");
  }
  return {
    actOk: record.actOk !== false,
    actError: typeof record.actError === "string" ? record.actError : null,
    url: record.url,
    title: typeof record.title === "string" ? record.title : "",
    snapshot: record.snapshot,
  };
}

export interface JevGoalResult {
  readonly state: "done" | "blocked" | "max_steps";
  readonly answer: string;
  readonly steps: DoStep[];
}

const MAX_STEP_OUTCOME_LENGTH = 400;
const MAX_STEP_TARGET_LENGTH = 200;

function clampStepOutcome(outcome: string): string {
  return outcome.length > MAX_STEP_OUTCOME_LENGTH ? outcome.slice(0, MAX_STEP_OUTCOME_LENGTH) : outcome;
}

function clampStepTarget(target: string | null): string | null {
  if (target === null) return null;
  return target.length > MAX_STEP_TARGET_LENGTH ? target.slice(0, MAX_STEP_TARGET_LENGTH) : target;
}

export interface RunJevGoalArgs {
  readonly goal: string;
  readonly maxSteps: number;
  readonly stepTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly provider: JevProvider;
  readonly runScript: (script: string, timeoutMs: number, signal: AbortSignal) => Promise<{ text: string }>;
}

export async function runJevGoal(args: RunJevGoalArgs): Promise<JevGoalResult> {
  const steps: DoStep[] = [];
  let pendingDecision: JevDecision | null = null;
  let lastAnswer = "";
  for (let index = 0; index < args.maxSteps; index += 1) {
    args.signal.throwIfAborted();
    const raw = await args.runScript(buildStepScript(pendingDecision), args.stepTimeoutMs, args.signal);
    const stepResult = parseStepResult(raw.text);
    if (pendingDecision !== null) {
      const executed = pendingDecision;
      steps.push({
        index: index - 1,
        action: executed.action,
        target: clampStepTarget(executed.ref),
        outcome: clampStepOutcome(stepResult.actOk ? "ok" : `failed: ${stepResult.actError ?? "unknown error"}`),
      });
      if (executed.goalCompleteAfter && stepResult.actOk) {
        return { state: "done", answer: executed.answer, steps };
      }
    }
    args.signal.throwIfAborted();
    const decision = await args.provider.decide(
      {
        goal: args.goal,
        observation: { url: stepResult.url, title: stepResult.title, snapshot: stepResult.snapshot },
        recentOutcomes: steps.slice(-5).map((step) => `${step.action} ${step.target ?? ""}: ${step.outcome}`),
      },
      args.signal,
    );
    lastAnswer = decision.answer;
    if (decision.action === "done" || decision.action === "blocked") {
      steps.push({ index, action: decision.action, target: null, outcome: clampStepOutcome(decision.answer) });
      return { state: decision.action === "done" ? "done" : "blocked", answer: decision.answer, steps };
    }
    pendingDecision = decision;
  }
  return { state: "max_steps", answer: lastAnswer, steps };
}
