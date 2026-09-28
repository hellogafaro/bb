import type {
  ComputerObservation as Observation,
} from "@bb/server-contract";
import type {
  ComputerKeyPress,
  ComputerOperation as Operation,
  ComputerOperationKind as OperationKind,
  ComputerTarget as Target,
} from "@bb/host-daemon-contract";
import type { ServerRuntimeConfig } from "../../types.js";

export interface Choice {
  readonly choiceId: string;
  readonly label: string;
}

export interface DecisionRequest {
  readonly goal: string;
  readonly observation: Observation;
  readonly recentSummaries: readonly string[];
  readonly operationChoices: readonly Choice[];
}

export interface DecisionResponse {
  readonly operationChoiceId: string;
  readonly targetChoiceId: string | null;
  readonly typedText: string | null;
  readonly submit: boolean;
  readonly goalCompleteAfter: boolean;
  readonly confidence: number | null;
}

export interface DecisionProvider {
  decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResponse>;
}

const TARGETLESS_OPERATIONS = ["wait", "done", "blocked", "hotkey", "type_window", "press_key", "focus_window"];

export const KEY_CHOICES: readonly Choice[] = [
  { choiceId: "Enter", label: "Press Enter" },
  { choiceId: "Escape", label: "Press Escape" },
  { choiceId: "Tab", label: "Press Tab" },
  { choiceId: "mod+a", label: "Select all (Ctrl/Cmd+A)" },
  { choiceId: "mod+c", label: "Copy (Ctrl/Cmd+C)" },
  { choiceId: "mod+v", label: "Paste (Ctrl/Cmd+V)" },
];

export function operationChoices(allowed: readonly OperationKind[] | undefined, targets: readonly Target[]): Choice[] {
  const present = new Set<OperationKind>(targets.flatMap((target) => target.allowedOperations));
  const all: OperationKind[] = [
    "click",
    "double_click",
    "type",
    "set_value",
    "select",
    "scroll",
    "hotkey",
    "type_window",
    "press_key",
    "focus_window",
    "wait",
    "done",
    "blocked",
  ];
  const eligible = all.filter((kind) => allowed === undefined || allowed.includes(kind));
  return eligible
    .filter((kind) => TARGETLESS_OPERATIONS.includes(kind) || present.has(kind))
    .map((kind) => ({ choiceId: kind, label: kind }));
}

function choicesForOperation(kind: OperationKind, targets: readonly Target[]): Choice[] {
  if (kind === "press_key") return [...KEY_CHOICES];
  if (isTargetOperationKind(kind)) return targetChoices(targets, kind).slice(0, MAX_TARGET_CHOICES);
  return [];
}

export function targetChoices(targets: readonly Target[], operation: OperationKind): Choice[] {
  return targets
    .filter((target) => target.allowedOperations.includes(operation as never))
    .map((target) => ({ choiceId: target.targetId, label: `${target.role}: ${target.name}` }));
}

export function toOperation(
  decision: DecisionResponse,
  observation: Observation,
  typedText: string | null,
): Operation {
  const kind = decision.operationChoiceId as OperationKind;
  const targetId = decision.targetChoiceId;
  switch (kind) {
    case "done":
      return { kind: "done", summary: "Jev decided the goal is complete" };
    case "blocked":
      return { kind: "blocked", reason: "Jev could not find a safe next step" };
    case "wait":
      return { kind: "wait", ms: 500 };
    case "hotkey":
      return { kind: "hotkey", keys: ["Escape"] };
    case "focus_window":
      return { kind: "focus_window" };
    case "press_key": {
      const key = targetId !== null && targetId !== NONE_TARGET ? (targetId as ComputerKeyPress) : "Enter";
      return { kind: "press_key", key };
    }
    case "type_window": {
      if (typedText === null) return { kind: "blocked", reason: "Jev selected type_window with no valid text" };
      return { kind: "type_window", text: typedText };
    }
    case "click":
    case "double_click":
    case "set_value":
    case "select":
    case "scroll": {
      if (targetId === null) return { kind: "blocked", reason: "Jev selected an operation with no target" };
      if (kind === "click" || kind === "double_click") return { kind, targetId, snapshotId: observation.snapshotId };
      if (kind === "scroll") return { kind: "scroll", targetId, snapshotId: observation.snapshotId, direction: "down", amount: "small" };
      if (typedText === null) return { kind: "blocked", reason: `Jev selected ${kind} with no valid text` };
      if (kind === "select") return { kind: "select", targetId, snapshotId: observation.snapshotId, value: typedText };
      return { kind: "set_value", targetId, snapshotId: observation.snapshotId, value: typedText, protect: false };
    }
    case "type": {
      if (targetId === null) return { kind: "blocked", reason: "Jev selected type with no target" };
      if (typedText === null) return { kind: "blocked", reason: "Jev selected type with no valid text" };
      return { kind: "type", targetId, snapshotId: observation.snapshotId, text: typedText, protect: false };
    }
  }
}

export function verifyTargetFresh(observation: Observation, operation: Operation): Operation {
  if (!("targetId" in operation) || operation.targetId === null || operation.targetId === undefined) return operation;
  const present = observation.targets.some((target) => target.targetId === operation.targetId);
  if (present) return operation;
  return { kind: "blocked", reason: "Selected target is no longer present in the latest observation" };
}

export function postActionWaitMs(operation: Operation, observation: Observation): number {
  if (operation.kind !== "type") return 50;
  const target = observation.targets.find((candidate) => candidate.targetId === operation.targetId);
  const role = target?.role.toLowerCase() ?? "";
  return role.includes("combo") || role.includes("search") ? 200 : 50;
}

const MAX_TARGET_CHOICES = 240;

const TARGET_OPERATIONS = ["click", "double_click", "type", "set_value", "select", "scroll"] as const;
type TargetOperationKind = (typeof TARGET_OPERATIONS)[number];

function isTargetOperationKind(kind: string): kind is TargetOperationKind {
  return (TARGET_OPERATIONS as readonly string[]).includes(kind);
}

export interface JevProviderOptions {
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

interface ChoiceAnswer {
  readonly choice: string;
  readonly confidence: number;
}

function parseChoice(value: unknown, allowed: ReadonlySet<string>): ChoiceAnswer {
  if (value === null || typeof value !== "object") throw new Error("TypeSafe System One omitted a choice");
  const answer = value as { choice?: unknown; confidence?: unknown };
  if (typeof answer.choice !== "string" || !allowed.has(answer.choice)) {
    throw new Error("TypeSafe System One returned an invalid choice");
  }
  const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : 1;
  return { choice: answer.choice, confidence };
}

export class JevDecisionProvider implements DecisionProvider {
  readonly #options: Required<Omit<JevProviderOptions, "fetchImpl">> & { fetchImpl: typeof fetch };

  constructor(options: JevProviderOptions) {
    if (options.apiKey.trim().length === 0) throw new Error("TypeSafe API key is missing");
    this.#options = { ...options, timeoutMs: options.timeoutMs ?? 30_000, fetchImpl: options.fetchImpl ?? fetch };
  }

  async decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResponse> {
    const state = {
      goal: request.goal,
      observation: { title: request.observation.title, targets: request.observation.targets },
      recent_outcomes: request.recentSummaries,
    };
    const operationIds = new Set(request.operationChoices.map((choice) => choice.choiceId));
    const first = await this.#call(state, {
      operation: {
        type: "choice",
        instructions: "Which supplied operation makes the most progress toward goal? Select only a supplied ID.",
        criteria: Object.fromEntries(request.operationChoices.map((choice) => [choice.choiceId, choice.label])),
      },
    }, signal);
    const operation = parseChoice(first.operation, operationIds);
    const compatibleTargets = choicesForOperation(operation.choice as OperationKind, request.observation.targets);
    if (compatibleTargets.length === 0) {
      return {
        operationChoiceId: operation.choice,
        targetChoiceId: null,
        typedText: null,
        submit: false,
        goalCompleteAfter: false,
        confidence: operation.confidence,
      };
    }
    const targetResult = await this.#call(
      { ...state, selected_operation: operation.choice },
      {
        target: {
          type: "choice",
          instructions: "For the selected operation, which compatible supplied target best advances goal?",
          criteria: Object.fromEntries(compatibleTargets.map((choice) => [choice.choiceId, choice.label])),
        },
      },
      signal,
    );
    const target = parseChoice(targetResult.target, new Set(compatibleTargets.map((choice) => choice.choiceId)));
    return {
      operationChoiceId: operation.choice,
      targetChoiceId: target.choice,
      typedText: null,
      submit: false,
      goalCompleteAfter: false,
      confidence: Math.min(operation.confidence, target.confidence),
    };
  }

  async #call(state: unknown, questions: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown>> {
    const timeout = AbortSignal.timeout(this.#options.timeoutMs);
    const response = await this.#options.fetchImpl(this.#options.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ state, model: this.#options.model, questions }),
      signal: AbortSignal.any([timeout, signal]),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`TypeSafe System One returned HTTP ${response.status}`);
    const parsed = JSON.parse(text) as { answers?: unknown };
    if (parsed.answers === null || typeof parsed.answers !== "object") throw new Error("TypeSafe System One omitted typed answers");
    return parsed.answers as Record<string, unknown>;
  }
}

export interface OpenRouterProviderOptions {
  readonly endpoint?: string;
  readonly model: string;
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_JEV_SYSTEM_PROMPT =
  "You are Jev, the decision step of a desktop automation loop. You receive a goal, the current window's target table, recent action outcomes, and questions. Answer every question by selecting exactly one of its supplied choice IDs. Each target question only applies when its matching operation is chosen; otherwise answer it with \"none\".";

const NONE_TARGET = "none";

const TARGET_HEAD_KEY: Record<TargetOperationKind | "press_key", string> = {
  click: "click_target",
  double_click: "double_click_target",
  type: "type_text_target",
  set_value: "set_value_target",
  select: "select_target",
  scroll: "scroll_target",
  press_key: "press_key_choice",
};

const TYPED_TEXT_HEAD_OPERATIONS = ["type", "set_value", "select", "type_window"] as const;
const TYPED_TEXT_INSTRUCTIONS =
  'The literal text to type or set, when the chosen operation is "type", "set_value", "select", or "type_window". Empty string otherwise.';
const MAX_TYPED_TEXT_LENGTH = 2_000;

export function validateTypedText(raw: string | null): string | null {
  if (raw === null) return null;
  if (raw.trim().length === 0 || raw.length > MAX_TYPED_TEXT_LENGTH) return null;
  return raw;
}

export const SUBMIT_OPERATIONS = ["type", "set_value", "type_window"] as const;
const SUBMIT_INSTRUCTIONS =
  'True only if, right after this text is typed, pressing Enter should submit it (a command line, search box, or single-field form); otherwise false. Ignored unless operation is "type", "set_value", or "type_window".';
const GOAL_COMPLETE_INSTRUCTIONS =
  "True if performing the chosen operation is expected to fully satisfy the goal, so no further step will be needed afterward; otherwise false.";

function parseOpenRouterContent(text: string, provider: string): string {
  const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error(`${provider} response omitted content`);
  return content;
}

function requireChoice(answers: Record<string, unknown>, key: string, allowed: readonly Choice[]): string {
  const value = answers[key];
  if (typeof value !== "string") throw new Error(`OpenRouter Jev omitted the ${key} choice`);
  if (!allowed.some((choice) => choice.choiceId === value)) throw new Error(`OpenRouter Jev returned an invalid ${key} choice`);
  return value;
}

interface TargetHead {
  readonly key: string;
  readonly targets: readonly Choice[];
}

export class OpenRouterJevDecisionProvider implements DecisionProvider {
  readonly #options: Required<Omit<OpenRouterProviderOptions, "fetchImpl" | "endpoint">> & { endpoint: string; fetchImpl: typeof fetch };

  constructor(options: OpenRouterProviderOptions) {
    if (options.apiKey.trim().length === 0) throw new Error("OpenRouter API key is missing");
    this.#options = {
      ...options,
      endpoint: options.endpoint ?? OPENROUTER_CHAT_COMPLETIONS_URL,
      timeoutMs: options.timeoutMs ?? 30_000,
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  async decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResponse> {
    const headByOperation = new Map<string, TargetHead>();
    const offeredOperations = request.operationChoices.filter((choice) => {
      const kind = choice.choiceId as OperationKind;
      if (!isTargetOperationKind(kind) && kind !== "press_key") return true;
      const compatible = choicesForOperation(kind, request.observation.targets);
      if (compatible.length === 0) return false;
      headByOperation.set(choice.choiceId, { key: TARGET_HEAD_KEY[kind as TargetOperationKind | "press_key"], targets: compatible });
      return true;
    });
    if (offeredOperations.length === 0) throw new Error("OpenRouter Jev has no eligible operations to offer");
    const needsTypedText = offeredOperations.some((choice) => (TYPED_TEXT_HEAD_OPERATIONS as readonly string[]).includes(choice.choiceId));
    const needsSubmit = offeredOperations.some((choice) => (SUBMIT_OPERATIONS as readonly string[]).includes(choice.choiceId));

    const questions: Record<string, { instructions: string; choices: Record<string, string> } | { instructions: string }> = {
      operation: {
        instructions: "Which supplied operation makes the most progress toward goal? Select only a supplied ID.",
        choices: Object.fromEntries(offeredOperations.map((choice) => [choice.choiceId, choice.label])),
      },
    };
    const properties: Record<string, { type: "string"; enum: string[] } | { type: "string" } | { type: "boolean" }> = {
      operation: { type: "string", enum: offeredOperations.map((choice) => choice.choiceId) },
    };
    for (const [operationId, head] of headByOperation) {
      questions[head.key] = {
        instructions: `If operation is "${operationId}", which compatible supplied choice best advances goal? Answer "${NONE_TARGET}" when a different operation was chosen.`,
        choices: {
          ...Object.fromEntries(head.targets.map((choice) => [choice.choiceId, choice.label])),
          [NONE_TARGET]: "Not applicable; a different operation was chosen",
        },
      };
      properties[head.key] = { type: "string", enum: [...head.targets.map((choice) => choice.choiceId), NONE_TARGET] };
    }
    if (needsTypedText) {
      questions.text = { instructions: TYPED_TEXT_INSTRUCTIONS };
      properties.text = { type: "string" };
    }
    if (needsSubmit) {
      questions.submit = { instructions: SUBMIT_INSTRUCTIONS };
      properties.submit = { type: "boolean" };
    }
    questions.goal_complete_after = { instructions: GOAL_COMPLETE_INSTRUCTIONS };
    properties.goal_complete_after = { type: "boolean" };

    const state = {
      goal: request.goal,
      observation: { title: request.observation.title, targets: request.observation.targets },
      recent_outcomes: request.recentSummaries,
      questions,
    };
    const timeout = AbortSignal.timeout(this.#options.timeoutMs);
    const response = await this.#options.fetchImpl(this.#options.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#options.model,
        messages: [
          { role: "system", content: OPENROUTER_JEV_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(state) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "decision",
            strict: true,
            schema: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
          },
        },
        max_tokens: 1000,
        reasoning: { effort: "low" },
      }),
      signal: AbortSignal.any([timeout, signal]),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OpenRouter Jev returned HTTP ${response.status}`);
    let answers: unknown;
    try {
      answers = JSON.parse(parseOpenRouterContent(text, "OpenRouter Jev"));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("OpenRouter Jev returned malformed JSON");
      throw error;
    }
    if (answers === null || typeof answers !== "object") throw new Error("OpenRouter Jev omitted typed answers");
    const record = answers as Record<string, unknown>;
    const operationChoiceId = requireChoice(record, "operation", offeredOperations);
    const typedText = needsTypedText ? validateTypedText(typeof record.text === "string" ? record.text : null) : null;
    const submit =
      needsSubmit && (SUBMIT_OPERATIONS as readonly string[]).includes(operationChoiceId) && record.submit === true;
    const goalCompleteAfter = record.goal_complete_after === true;
    const head = headByOperation.get(operationChoiceId);
    if (head === undefined) return { operationChoiceId, targetChoiceId: null, typedText, submit, goalCompleteAfter, confidence: null };
    const targetValue = record[head.key];
    if (typeof targetValue !== "string" || !head.targets.some((choice) => choice.choiceId === targetValue)) {
      throw new Error(`OpenRouter Jev selected ${operationChoiceId} but its target head returned an invalid target`);
    }
    return { operationChoiceId, targetChoiceId: targetValue, typedText, submit, goalCompleteAfter, confidence: null };
  }
}

export interface TextHelperInput {
  readonly goal: string;
  readonly targetLabel: string;
}

function textHelperCacheKey(input: TextHelperInput): string {
  return JSON.stringify(input);
}

const TEXT_HELPER_SYSTEM_PROMPT =
  "You write short, literal text to type into a single UI field for a desktop automation loop. Respond only with the requested JSON.";

export class OpenRouterTextGenerator {
  readonly #options: Required<Omit<OpenRouterProviderOptions, "fetchImpl" | "endpoint">> & { endpoint: string; fetchImpl: typeof fetch };
  #cache: { key: string; value: string } | null = null;

  constructor(options: OpenRouterProviderOptions) {
    if (options.apiKey.trim().length === 0) throw new Error("OpenRouter API key is missing");
    this.#options = {
      ...options,
      endpoint: options.endpoint ?? OPENROUTER_CHAT_COMPLETIONS_URL,
      timeoutMs: options.timeoutMs ?? 20_000,
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  async generate(input: TextHelperInput, signal: AbortSignal): Promise<string> {
    const key = textHelperCacheKey(input);
    if (this.#cache !== null && this.#cache.key === key) return this.#cache.value;
    const timeout = AbortSignal.timeout(this.#options.timeoutMs);
    const response = await this.#options.fetchImpl(this.#options.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#options.model,
        temperature: 0.2,
        max_tokens: 200,
        reasoning: { enabled: false },
        messages: [
          { role: "system", content: TEXT_HELPER_SYSTEM_PROMPT },
          { role: "user", content: `Goal: ${input.goal}\nTarget field: ${input.targetLabel}\nReturn the exact text to type into this field.` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "typed_text",
            strict: true,
            schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false },
          },
        },
      }),
      signal: AbortSignal.any([timeout, signal]),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(parseOpenRouterContent(text, "OpenRouter"));
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error("OpenRouter text helper returned malformed JSON");
      throw error;
    }
    if (parsed === null || typeof parsed !== "object" || typeof (parsed as { text?: unknown }).text !== "string") {
      throw new Error("OpenRouter text helper omitted text");
    }
    const value = (parsed as { text: string }).text;
    this.#cache = { key, value };
    return value;
  }
}

export type DecisionConfig = Pick<
  ServerRuntimeConfig,
  | "computerTypesafeApiKey"
  | "computerTypesafeEndpoint"
  | "computerTypesafeModel"
  | "computerOpenRouterApiKey"
  | "computerOpenRouterDecisionModel"
  | "openRouterApiKey"
>;

export interface DecisionBackend {
  readonly provider: DecisionProvider;
  readonly textGenerator: OpenRouterTextGenerator | null;
}

export function createDecisionBackend(config: DecisionConfig, fetchImpl?: typeof fetch): DecisionBackend | null {
  const openRouterApiKey =
    config.computerOpenRouterApiKey.trim().length > 0 ? config.computerOpenRouterApiKey : config.openRouterApiKey;
  if (config.computerTypesafeApiKey.trim().length > 0) {
    return {
      provider: new JevDecisionProvider({
        endpoint: config.computerTypesafeEndpoint,
        model: config.computerTypesafeModel,
        apiKey: config.computerTypesafeApiKey,
        fetchImpl,
      }),
      textGenerator:
        openRouterApiKey.trim().length > 0
          ? new OpenRouterTextGenerator({ model: config.computerOpenRouterDecisionModel, apiKey: openRouterApiKey, fetchImpl })
          : null,
    };
  }
  if (openRouterApiKey.trim().length === 0) return null;
  return {
    provider: new OpenRouterJevDecisionProvider({ model: config.computerOpenRouterDecisionModel, apiKey: openRouterApiKey, fetchImpl }),
    textGenerator: null,
  };
}
