import type {
  ComputerObservation as Observation,
} from "@bb/server-contract";
import type {
  ComputerOperation as Operation,
  ComputerOperationKind as OperationKind,
  ComputerTarget as Target,
} from "@bb/host-daemon-contract";

export interface Choice {
  readonly choiceId: string;
  readonly label: string;
}

export interface DecisionRequest {
  readonly goal: string;
  readonly observation: Observation;
  readonly recentSummaries: readonly string[];
  readonly operationChoices: readonly Choice[];
  readonly targetChoices: readonly Choice[];
}

export interface DecisionResponse {
  readonly operationChoiceId: string;
  readonly targetChoiceId: string | null;
  readonly confidence: number | null;
}

export interface DecisionProvider {
  decide(request: DecisionRequest, signal: AbortSignal): Promise<DecisionResponse>;
}

export function operationChoices(allowed: readonly OperationKind[] | undefined, targets: readonly Target[]): Choice[] {
  const present = new Set<OperationKind>(targets.flatMap((target) => target.allowedOperations));
  const all: OperationKind[] = ["click", "double_click", "type", "set_value", "select", "scroll", "hotkey", "wait", "done", "blocked"];
  const eligible = all.filter((kind) => allowed === undefined || allowed.includes(kind));
  return eligible
    .filter((kind) => ["wait", "done", "blocked", "hotkey"].includes(kind) || present.has(kind))
    .map((kind) => ({ choiceId: kind, label: kind }));
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
    case "click":
    case "double_click":
    case "set_value":
    case "select":
    case "scroll": {
      if (targetId === null) return { kind: "blocked", reason: "Jev selected an operation with no target" };
      if (kind === "click" || kind === "double_click") return { kind, targetId, snapshotId: observation.snapshotId };
      if (kind === "scroll") return { kind: "scroll", targetId, snapshotId: observation.snapshotId, direction: "down", amount: "small" };
      if (kind === "select") return { kind: "select", targetId, snapshotId: observation.snapshotId, value: typedText ?? "" };
      return { kind: "set_value", targetId, snapshotId: observation.snapshotId, value: typedText ?? "", protect: false };
    }
    case "type": {
      if (targetId === null) return { kind: "blocked", reason: "Jev selected type with no target" };
      return { kind: "type", targetId, snapshotId: observation.snapshotId, text: typedText ?? "", protect: false };
    }
  }
}

const MAX_TYPESAFE_CHOICES = 240;

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
    if (request.targetChoices.length === 0) return { operationChoiceId: operation.choice, targetChoiceId: null, confidence: operation.confidence };
    const groups: Choice[][] = [];
    for (let i = 0; i < request.targetChoices.length; i += MAX_TYPESAFE_CHOICES) groups.push(request.targetChoices.slice(i, i + MAX_TYPESAFE_CHOICES));
    const targetResult = await this.#call(
      { ...state, selected_operation: operation.choice },
      {
        target: {
          type: "choice",
          instructions: "For the selected operation, which compatible supplied target best advances goal?",
          criteria: Object.fromEntries(groups[0]!.map((choice) => [choice.choiceId, choice.label])),
        },
      },
      signal,
    );
    const target = parseChoice(targetResult.target, new Set(groups[0]!.map((choice) => choice.choiceId)));
    return { operationChoiceId: operation.choice, targetChoiceId: target.choice, confidence: Math.min(operation.confidence, target.confidence) };
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

export class OpenRouterTextGenerator {
  readonly #options: Required<Omit<OpenRouterProviderOptions, "fetchImpl" | "endpoint">> & { endpoint: string; fetchImpl: typeof fetch };

  constructor(options: OpenRouterProviderOptions) {
    if (options.apiKey.trim().length === 0) throw new Error("OpenRouter API key is missing");
    this.#options = {
      ...options,
      endpoint: options.endpoint ?? "https://openrouter.ai/api/v1/chat/completions",
      timeoutMs: options.timeoutMs ?? 20_000,
      fetchImpl: options.fetchImpl ?? fetch,
    };
  }

  async generate(instruction: string, signal: AbortSignal): Promise<string> {
    const timeout = AbortSignal.timeout(this.#options.timeoutMs);
    const response = await this.#options.fetchImpl(this.#options.endpoint, {
      method: "POST",
      headers: { authorization: `Bearer ${this.#options.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#options.model,
        temperature: 0.2,
        max_tokens: 200,
        messages: [{ role: "user", content: instruction }],
      }),
      signal: AbortSignal.any([timeout, signal]),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`);
    const parsed = JSON.parse(text) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = parsed.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("OpenRouter response omitted content");
    return content.trim();
  }
}
