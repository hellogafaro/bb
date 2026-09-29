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
  readonly runId: string;
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
  readonly submitProbability: number | null;
  readonly goalCompleteAfter: boolean;
  readonly goalCompleteProbability: number;
  readonly confidence: number | null;
  readonly costUsd: number | null;
  readonly servedModel: string | null;
}

export interface ConfirmGoalCompleteRequest {
  readonly runId: string;
  readonly goal: string;
  readonly observation: Observation;
  readonly recentSummaries: readonly string[];
  readonly threshold: number;
}

export interface ConfirmGoalCompleteResponse {
  readonly complete: boolean;
  readonly probability: number;
}

export interface DecisionProvider {
  decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResponse>;
  confirmGoalComplete(request: ConfirmGoalCompleteRequest, signal: AbortSignal): Promise<ConfirmGoalCompleteResponse>;
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
  if (value === null || typeof value !== "object") throw new Error("System One omitted a choice");
  const answer = value as { choice?: unknown; confidence?: unknown };
  if (typeof answer.choice !== "string" || !allowed.has(answer.choice)) {
    throw new Error("System One returned an invalid choice");
  }
  const confidence = typeof answer.confidence === "number" && Number.isFinite(answer.confidence) ? answer.confidence : 1;
  return { choice: answer.choice, confidence };
}

function parseNoul(value: unknown): number {
  if (value === null || typeof value !== "object") throw new Error("System One omitted a noul");
  const answer = value as { noul?: unknown };
  if (typeof answer.noul !== "number" || !Number.isFinite(answer.noul)) {
    throw new Error("System One returned an invalid noul");
  }
  return answer.noul;
}

export class EscalateToAgentError extends Error {}

const NONE_TARGET = "none";
const NOUL_TRUE_THRESHOLD = 0.5;
// Speculative "this step will finish the goal" and its post-action confirmation both need
// strong evidence before the loop stops: at 0.5 Jev ended runs on a single focus_window/done
// guess (confidence ~0.6) after nothing in the goal had actually happened yet.
export const GOAL_COMPLETE_THRESHOLD = 0.8;
// When Jev's action head itself already chose "done", its post-action confirmation only needs
// to agree rather than independently clear the higher speculative bar: replaying real done/not-done
// runs put every not-done confirmation at 0.02-0.18 and every finished one at 0.57-0.88, so 0.5
// separates them cleanly without the false escalations the 0.8 bar caused on genuinely finished runs.
export const DONE_CONFIRM_THRESHOLD = 0.5;

const TARGET_HEAD_KEY: Record<TargetOperationKind | "press_key", string> = {
  click: "click_target",
  double_click: "double_click_target",
  type: "type_text_target",
  set_value: "set_value_target",
  select: "select_target",
  scroll: "scroll_target",
  press_key: "press_key_choice",
};

const OPERATION_DESCRIPTIONS: Record<OperationKind, string> = {
  click: "Single left-click the chosen on-screen target element.",
  double_click: "Double-click the chosen on-screen target element.",
  type: "Type literal text into the chosen target text field, appending to any existing content.",
  set_value: "Directly replace the chosen target element's value with literal text.",
  select: "Choose an option by literal text in the chosen target dropdown/combobox.",
  scroll: "Scroll the chosen target element or its container.",
  hotkey: "Press Escape as a general-purpose dismiss/cancel action; use only when no other operation fits.",
  type_window: "Type literal text into the currently focused window with no specific element targeted (for example, a terminal).",
  press_key: "Press a single named key (Enter, Escape, Tab, or a copy/paste/select-all shortcut); prefer clicking a visible on-screen control over this when one exists for the same purpose.",
  focus_window: "Bring the current window to focus and take no other action this step. Do not choose this to skip past concrete steps the goal names (a click, a typed command, a new tab/window) that recent_outcomes does not yet show as done.",
  wait: "Take no action this step and wait briefly for the UI to settle.",
  done: "Every concrete step the goal names has already happened, per recent_outcomes and the current observation; take no further action. Do not choose this because a remaining step merely looks reachable from here.",
  blocked: "No safe next step is available; stop and escalate to a human or agent.",
};

const TYPED_TEXT_HEAD_OPERATIONS = ["type", "set_value", "select", "type_window"] as const;
const TEXT_CANDIDATE_INSTRUCTIONS =
  'Which locally extracted candidate is the literal text to type or set, when the chosen operation is "type", "set_value", "select", or "type_window"? Answer "none" if no candidate fits.';
const MAX_TYPED_TEXT_LENGTH = 2_000;

export function validateTypedText(raw: string | null): string | null {
  if (raw === null) return null;
  if (raw.trim().length === 0 || raw.length > MAX_TYPED_TEXT_LENGTH) return null;
  return raw;
}

export const SUBMIT_OPERATIONS = ["type", "set_value", "type_window"] as const;
const SUBMIT_INSTRUCTIONS =
  'Should pressing Enter right after this text is typed submit it? Ignored unless operation is "type", "set_value", or "type_window".';
const SUBMIT_NOUL_CRITERIA = {
  true: "This is a command line, search box, or single-field form where pressing Enter right after typing should submit it.",
  false: "Pressing Enter after typing should not happen automatically this step.",
};
const GOAL_COMPLETE_INSTRUCTIONS =
  "Is performing the chosen operation expected to fully satisfy the goal, so no further step will be needed afterward?";
const GOAL_COMPLETE_NOUL_CRITERIA = {
  true: "The chosen operation is expected to fully satisfy the goal; no further step will be needed afterward.",
  false: "Further steps will still be needed after the chosen operation.",
};
const CONFIRM_GOAL_COMPLETE_INSTRUCTIONS = "Has every concrete step the goal names been performed, according to recent_outcomes?";
const CONFIRM_GOAL_COMPLETE_NOUL_CRITERIA = {
  true: "recent_outcomes shows every concrete step the goal named was performed without error.",
  false: "At least one concrete step the goal named is missing from recent_outcomes or failed.",
};

const MAX_TEXT_CANDIDATES = 6;
const QUOTED_TEXT_PATTERN = /"([^"]+)"|'([^']+)'/g;
const TEXT_CUE_PATTERNS: readonly RegExp[] = [
  /\bthe command:\s*(.+)$/i,
  /\btype the command\s+(.+)$/i,
  /\bsearch for\s+(.+)$/i,
  /\btype\s*:?\s+(.+)$/i,
  /\benter\s*:?\s+(.+)$/i,
];
const TEXT_CANDIDATE_STOP_PHRASES = [
  " and press",
  " then press",
  " and hit",
  " then hit",
  " and click",
  " then click",
  ", then",
  ". ",
];

function trimTextCandidate(raw: string): string {
  let text = raw.trim();
  let cut = text.length;
  for (const stop of TEXT_CANDIDATE_STOP_PHRASES) {
    const index = text.toLowerCase().indexOf(stop);
    if (index !== -1 && index < cut) cut = index;
  }
  return text
    .slice(0, cut)
    .trim()
    .replace(/^[:\-]+/, "")
    .trim()
    .replace(/[.,;:]+$/, "");
}

export function extractTextCandidates(goal: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (raw: string): void => {
    const text = trimTextCandidate(raw);
    if (text.length === 0 || seen.has(text)) return;
    seen.add(text);
    candidates.push(text);
  };
  for (const match of goal.matchAll(QUOTED_TEXT_PATTERN)) {
    addCandidate(match[1] ?? match[2] ?? "");
  }
  for (const pattern of TEXT_CUE_PATTERNS) {
    const match = pattern.exec(goal);
    if (match?.[1] !== undefined) {
      addCandidate(match[1]);
      break;
    }
  }
  return candidates.slice(0, MAX_TEXT_CANDIDATES);
}

interface TargetHead {
  readonly key: string;
  readonly targets: readonly Choice[];
}

function targetCriterion(target: Target): { readonly role: string; readonly label: string; readonly value: string | null } {
  return { role: target.role, label: target.name, value: target.value };
}

type SystemOneQuestion =
  | { readonly type: "choice"; readonly instructions: string; readonly criteria: Record<string, unknown> }
  | { readonly type: "noul"; readonly instructions: string; readonly criteria: { readonly true: string; readonly false: string } };

export class JevDecisionProvider implements DecisionProvider {
  readonly #options: Required<Omit<JevProviderOptions, "fetchImpl">> & { fetchImpl: typeof fetch };

  constructor(options: JevProviderOptions) {
    if (options.apiKey.trim().length === 0) throw new Error("Jev API key is missing");
    this.#options = { ...options, timeoutMs: options.timeoutMs ?? 30_000, fetchImpl: options.fetchImpl ?? fetch };
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
    if (offeredOperations.length === 0) throw new Error("Jev has no eligible operations to offer");
    const needsTypedText = offeredOperations.some((choice) => (TYPED_TEXT_HEAD_OPERATIONS as readonly string[]).includes(choice.choiceId));
    const needsSubmit = offeredOperations.some((choice) => (SUBMIT_OPERATIONS as readonly string[]).includes(choice.choiceId));
    const candidates = needsTypedText ? extractTextCandidates(request.goal) : [];

    const questions: Record<string, SystemOneQuestion> = {
      operation: {
        type: "choice",
        instructions: "Which supplied operation makes the most progress toward goal? Select only a supplied ID.",
        criteria: Object.fromEntries(offeredOperations.map((choice) => [choice.choiceId, OPERATION_DESCRIPTIONS[choice.choiceId as OperationKind]])),
      },
    };
    for (const [operationId, head] of headByOperation) {
      const isPressKey = operationId === "press_key";
      questions[head.key] = {
        type: "choice",
        instructions: `If operation is "${operationId}", which compatible supplied choice best advances goal? Answer "${NONE_TARGET}" when a different operation was chosen.`,
        criteria: {
          ...Object.fromEntries(
            head.targets.map((choice) => {
              if (isPressKey) return [choice.choiceId, choice.label];
              const target = request.observation.targets.find((candidate) => candidate.targetId === choice.choiceId);
              return [choice.choiceId, target === undefined ? choice.label : targetCriterion(target)];
            }),
          ),
          [NONE_TARGET]: "Not applicable; a different operation was chosen",
        },
      };
    }
    if (needsTypedText) {
      questions.text_candidate = {
        type: "choice",
        instructions: TEXT_CANDIDATE_INSTRUCTIONS,
        criteria: {
          ...Object.fromEntries(candidates.map((text, index) => [`c${index}`, text])),
          [NONE_TARGET]: "No extracted candidate fits",
        },
      };
    }
    if (needsSubmit) {
      questions.submit = { type: "noul", instructions: SUBMIT_INSTRUCTIONS, criteria: SUBMIT_NOUL_CRITERIA };
    }
    questions.goal_complete_after = { type: "noul", instructions: GOAL_COMPLETE_INSTRUCTIONS, criteria: GOAL_COMPLETE_NOUL_CRITERIA };

    const state = {
      goal: request.goal,
      observation: { title: request.observation.title, targets: request.observation.targets },
      recent_outcomes: request.recentSummaries,
    };
    const { answers, costUsd, servedModel } = await this.#call(state, questions, request.runId, signal);

    const operationIds = new Set(offeredOperations.map((choice) => choice.choiceId));
    const operation = parseChoice(answers.operation, operationIds);
    const operationChoiceId = operation.choice;

    const head = headByOperation.get(operationChoiceId);
    let targetChoiceId: string | null = null;
    let confidence = operation.confidence;
    if (head !== undefined) {
      const allowed = new Set([...head.targets.map((choice) => choice.choiceId), NONE_TARGET]);
      const target = parseChoice(answers[head.key], allowed);
      targetChoiceId = target.choice === NONE_TARGET ? null : target.choice;
      confidence = Math.min(confidence, target.confidence);
    }

    let typedText: string | null = null;
    if (needsTypedText && (TYPED_TEXT_HEAD_OPERATIONS as readonly string[]).includes(operationChoiceId)) {
      const candidateAllowed = new Set([...candidates.map((_, index) => `c${index}`), NONE_TARGET]);
      const textAnswer = parseChoice(answers.text_candidate, candidateAllowed);
      if (textAnswer.choice === NONE_TARGET) {
        throw new EscalateToAgentError(
          `Jev selected "${operationChoiceId}" but no literal text candidate extracted from the goal fits; escalating to the agent to type it.`,
        );
      }
      typedText = validateTypedText(candidates[Number(textAnswer.choice.slice(1))] ?? null);
    }

    const submitProbability =
      needsSubmit && (SUBMIT_OPERATIONS as readonly string[]).includes(operationChoiceId)
        ? parseNoul(answers.submit)
        : null;
    const submit = submitProbability !== null && submitProbability >= NOUL_TRUE_THRESHOLD;
    const goalCompleteProbability = parseNoul(answers.goal_complete_after);
    const goalCompleteAfter = goalCompleteProbability >= GOAL_COMPLETE_THRESHOLD;

    return {
      operationChoiceId,
      targetChoiceId,
      typedText,
      submit,
      submitProbability,
      goalCompleteAfter,
      goalCompleteProbability,
      confidence,
      costUsd,
      servedModel,
    };
  }

  async confirmGoalComplete(
    request: ConfirmGoalCompleteRequest,
    signal: AbortSignal,
  ): Promise<ConfirmGoalCompleteResponse> {
    const questions: Record<string, SystemOneQuestion> = {
      goal_now_complete: {
        type: "noul",
        instructions: CONFIRM_GOAL_COMPLETE_INSTRUCTIONS,
        criteria: CONFIRM_GOAL_COMPLETE_NOUL_CRITERIA,
      },
    };
    const state = {
      goal: request.goal,
      observation: { title: request.observation.title, targets: request.observation.targets },
      recent_outcomes: request.recentSummaries,
    };
    const { answers } = await this.#call(state, questions, request.runId, signal);
    const probability = parseNoul(answers.goal_now_complete);
    return { complete: probability >= request.threshold, probability };
  }

  async #call(
    state: unknown,
    questions: Record<string, SystemOneQuestion>,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<{ readonly answers: Record<string, unknown>; readonly costUsd: number | null; readonly servedModel: string | null }> {
    const timeout = AbortSignal.timeout(this.#options.timeoutMs);
    const response = await this.#options.fetchImpl(this.#options.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ state, model: this.#options.model, questions, session_id: sessionId }),
      signal: AbortSignal.any([timeout, signal]),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`System One returned HTTP ${response.status}`);
    const parsed = JSON.parse(text) as { answers?: unknown; usage?: { cost?: unknown }; model?: unknown };
    if (parsed.answers === null || typeof parsed.answers !== "object") throw new Error("System One omitted typed answers");
    const costUsd = typeof parsed.usage?.cost === "number" && Number.isFinite(parsed.usage.cost) ? parsed.usage.cost : null;
    const servedModel = typeof parsed.model === "string" ? parsed.model : null;
    return { answers: parsed.answers as Record<string, unknown>, costUsd, servedModel };
  }
}

const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

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
}

export function createDecisionBackend(config: DecisionConfig, fetchImpl?: typeof fetch): DecisionBackend | null {
  if (config.computerTypesafeApiKey.trim().length > 0) {
    return {
      provider: new JevDecisionProvider({
        endpoint: config.computerTypesafeEndpoint,
        model: config.computerTypesafeModel,
        apiKey: config.computerTypesafeApiKey,
        fetchImpl,
      }),
    };
  }
  const openRouterApiKey =
    config.computerOpenRouterApiKey.trim().length > 0 ? config.computerOpenRouterApiKey : config.openRouterApiKey;
  if (openRouterApiKey.trim().length === 0) return null;
  return {
    provider: new JevDecisionProvider({
      endpoint: OPENROUTER_DECISIONS_URL,
      model: config.computerOpenRouterDecisionModel,
      apiKey: openRouterApiKey,
      fetchImpl,
    }),
  };
}
