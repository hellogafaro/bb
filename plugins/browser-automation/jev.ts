import { randomUUID } from "node:crypto";
import type { DoStep } from "./contracts.js";

export const JEV_ACTIONS = [
  "click",
  "fill",
  "select",
  "press_enter",
  "scroll_down",
  "scroll_up",
  "goto",
  "done",
  "blocked",
] as const;
export type JevAction = (typeof JEV_ACTIONS)[number];

export interface JevDecision {
  readonly action: JevAction;
  readonly ref: string | null;
  readonly value: string | null;
  readonly url: string | null;
  readonly answer: string;
  readonly submit: boolean;
  readonly goalCompleteAfter: boolean;
  readonly costUsd: number;
}

export interface JevObservation {
  readonly url: string;
  readonly title: string;
  readonly snapshot: string;
  readonly text: string;
}

export interface JevDecisionRequest {
  readonly goal: string;
  readonly observation: JevObservation;
  readonly recentOutcomes: readonly string[];
  readonly runId: string;
}

export interface JevProvider {
  decide(
    request: JevDecisionRequest,
    signal: AbortSignal,
  ): Promise<JevDecision>;
  /** The Jev model this provider decides with, reported back as DoOutput.model. */
  readonly model?: string;
}

const REF_PATTERN = /^[A-Za-z0-9]+$/;

function cleanRef(value: unknown): string | null {
  return typeof value === "string" && REF_PATTERN.test(value) ? value : null;
}

export class RetryableJevDecisionError extends Error {}

const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const DECISIONS_MODEL = "typesafe/jev-1.13";
const MAX_TARGETS = 240;
const MAX_ANSWER_SEGMENTS = 150;
const NONE_TARGET = "none";
const SUBMIT_THRESHOLD = 0.5;
const GOAL_COMPLETE_THRESHOLD = 0.7;

const OPERATION_INSTRUCTIONS =
  'Which operation makes the most progress toward the goal from the current page? Prefer clicking, filling, or selecting a directly relevant offered element over scrolling or navigating; scroll only when the element you need is not among the offered targets. "goto" is only offered when a URL literal is present; never use it to choose a dropdown option, follow a link, or open an item named in the goal — click or select the matching offered target instead. Do not repeat an action from recent_outcomes that already ran with no effect on the goal. "done" requires the answer to already be visible in visible_text, the snapshot, or page.title; "blocked" only when no supported operation can make progress (for example a CAPTCHA or a login wall). Do not repeat a step that already satisfied the goal.';

function targetInstructions(operation: string): string {
  return `Choose the best offered element for this operation if the operation selected above is "${operation}"; another question decides which operation to execute. Answer "none" when a different operation was chosen. Never choose a target that recent_outcomes shows was already filled or selected with the value the goal needs; when several similar fields are offered, choose the next one that still needs a value.`;
}

const FILL_TEXT_INSTRUCTIONS =
  'Which offered literal text, taken directly from the goal, belongs in the field named by fill_target/select_target if the operation selected above is "fill" or "select"? Match by the field\'s own name/role and by the goal\'s own wording (for example a value the goal calls "username" or "email" goes in a field named Username/Email; a value the goal calls "password" goes in a field named Password), not by the order the values appear in the goal. Answer "none" when a different operation was chosen, or when no offered text belongs in that specific field (a different text may belong to a different field instead).';
const GOTO_URL_INSTRUCTIONS =
  'Which offered literal URL should be opened if the operation selected above is "goto"? Answer "none" when a different operation was chosen.';
const ANSWER_EVIDENCE_INSTRUCTIONS =
  'Which offered segment, verbatim, most precisely answers exactly what the goal asked for if the operation selected above is "done"? The first segment is the page title; prefer it when the goal asks for a title or heading and no on-page text repeats it better. Prefer the shortest, most specific segment that directly answers the goal over a longer segment that only contains the answer among unrelated surrounding text. Answer "none" when a different operation was chosen, or when no offered segment answers the goal.';
const SUBMIT_INSTRUCTIONS =
  "True only when pressing Enter right after this step (if it types into a field) should submit it, such as a search box or a single-field form.";
const GOAL_COMPLETE_INSTRUCTIONS =
  "True when the goal is expected to be fully satisfied immediately after this action executes, so re-observing afterward can finish the run without another decision.";

interface SnapshotTarget {
  readonly ref: string;
  readonly role: string;
  readonly name: string;
  readonly attrs: string;
  /** For a native <select>: its currently selected child option's text, read from the nested "option ... [selected]" line, since the combobox's own line never carries a [value=]/[selected] attribute. */
  readonly selectedOption: string | null;
}

const SNAPSHOT_LINE_PATTERN =
  /^(\s*)-\s+(\w+)\s+(?:"([^"]*)"\s*)?([^\n]*)\[ref=(\w+)\]/;
const SELECTED_OPTION_PATTERN = /option\s+"([^"]*)"[^\n]*\[selected\]/;

function findSelectedOption(
  lines: readonly string[],
  startIndex: number,
  baseIndent: number,
): string | null {
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const indent = (line.match(/^\s*/) ?? [""])[0].length;
    if (line.trim().length > 0 && indent <= baseIndent) break;
    const match = line.match(SELECTED_OPTION_PATTERN);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

export function parseSnapshotTargets(
  snapshot: string,
  maxTargets = MAX_TARGETS,
): SnapshotTarget[] {
  const lines = snapshot.split("\n");
  const targets: SnapshotTarget[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const match = (lines[i] ?? "").match(SNAPSHOT_LINE_PATTERN);
    if (match === null) continue;
    const [, indent, role, name, attrs, ref] = match;
    if (
      indent === undefined ||
      role === undefined ||
      attrs === undefined ||
      ref === undefined
    )
      continue;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const selectedOption = isSelectableRole(role)
      ? findSelectedOption(lines, i, indent.length)
      : null;
    targets.push({
      ref,
      role,
      name: name ?? "",
      attrs: attrs.trim(),
      selectedOption,
    });
    if (targets.length >= maxTargets) break;
  }
  return targets;
}

function targetValueHint(target: SnapshotTarget): string {
  if (target.selectedOption !== null) return target.selectedOption;
  const valueMatch = target.attrs.match(/\[value="([^"]*)"\]/);
  if (valueMatch?.[1] !== undefined) return valueMatch[1];
  const flags = [
    "checked",
    "selected",
    "expanded",
    "pressed",
    "disabled",
  ].filter((flag) => target.attrs.includes(`[${flag}]`));
  return flags.join(", ");
}

function targetLabel(target: SnapshotTarget): string {
  const hint = targetValueHint(target);
  const base =
    target.name.length > 0 ? `${target.role}: ${target.name}` : target.role;
  return (hint.length > 0 ? `${base} (${hint})` : base).slice(0, 120);
}

function isFillableRole(role: string): boolean {
  return /textbox|searchbox|combobox/i.test(role);
}

function isSelectableRole(role: string): boolean {
  return /combobox|listbox/i.test(role);
}

function targetCriteria(
  targets: readonly SnapshotTarget[],
): Record<string, string> {
  return Object.fromEntries(
    targets.map((target) => [target.ref, targetLabel(target)]),
  );
}

interface ElementState {
  readonly role: string;
  readonly name: string;
  readonly value: string | null;
  readonly checked: boolean;
  readonly selected: boolean;
  readonly disabled: boolean;
}

function elementState(target: SnapshotTarget): ElementState {
  const valueMatch = target.attrs.match(/\[value="([^"]*)"\]/);
  return {
    role: target.role,
    name: target.name,
    value: target.selectedOption ?? valueMatch?.[1] ?? null,
    checked: target.attrs.includes("[checked]"),
    selected:
      target.attrs.includes("[selected]") || target.selectedOption !== null,
    disabled: target.attrs.includes("[disabled]"),
  };
}

/** The indexed element table every question sees, jev-ultrafast-style, so "checked"/"selected"/"value" state is available to the operation choice, not just the target head. */
function elementsTable(
  targets: readonly SnapshotTarget[],
): Record<string, ElementState> {
  return Object.fromEntries(
    targets.map((target) => [target.ref, elementState(target)]),
  );
}

const QUOTED_PATTERN = /'([^']+)'|"([^"]+)"/g;
const AFTER_KEYWORD_PATTERN =
  /\b(?:type|enter|search for|fill(?: in)?)\s+([^,.;:]+)/gi;
const MAX_CANDIDATES = 10;
const MAX_TEXT_CANDIDATE_LENGTH = 200;

/** Local, LLM-free extraction of literal text a fill/select step might need, offered to Jev as a choice head instead of generated by a text model. */
export function extractTextCandidates(goal: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (
      trimmed === undefined ||
      trimmed.length === 0 ||
      trimmed.length > MAX_TEXT_CANDIDATE_LENGTH
    )
      return;
    if (seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };
  for (const match of goal.matchAll(QUOTED_PATTERN)) add(match[1] ?? match[2]);
  for (const match of goal.matchAll(AFTER_KEYWORD_PATTERN)) add(match[1]);
  const colonIndex = goal.lastIndexOf(":");
  if (colonIndex !== -1) add(goal.slice(colonIndex + 1));
  return candidates.slice(0, MAX_CANDIDATES);
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

function extractUrls(text: string): string[] {
  const urls: string[] = [];
  for (const match of text.matchAll(URL_PATTERN))
    urls.push(match[0].replace(/[.,;:!?)]+$/, ""));
  return urls;
}

/** Local, LLM-free extraction of URLs literally present in the goal or the page, offered to Jev as a choice head. */
export function extractUrlCandidates(goal: string, pageText: string): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const url of [...extractUrls(goal), ...extractUrls(pageText)]) {
    if (seen.has(url)) continue;
    seen.add(url);
    candidates.push(url);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

const SEGMENT_SPLIT_PATTERN = /(?<=[.!?])\s+|\n+/;
const MAX_SEGMENT_LENGTH = 600;

/** Local, LLM-free segmentation of visible text into short candidates Jev can cite verbatim as the answer to a goal, instead of a generated summary. */
export function splitTextSegments(
  text: string,
  maxSegments = MAX_ANSWER_SEGMENTS,
): string[] {
  const segments: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(SEGMENT_SPLIT_PATTERN)) {
    const segment = raw.trim().slice(0, MAX_SEGMENT_LENGTH);
    if (segment.length === 0 || seen.has(segment)) continue;
    seen.add(segment);
    segments.push(segment);
    if (segments.length >= maxSegments) break;
  }
  return segments;
}

/** Turns checked/selected/value element state into short phrases evidence can cite, since that state never appears in visible_text (it's only in the accessibility tree). Gives unnamed elements an ordinal ("checkbox 1") so per-item state stays distinguishable. */
function elementStateSegments(targets: readonly SnapshotTarget[]): string[] {
  const ordinals = new Map<string, number>();
  const parts: string[] = [];
  for (const target of targets) {
    const state = elementState(target);
    if (state.value === null && !state.checked) continue;
    const key = `${target.role}:${target.name}`;
    const ordinal = (ordinals.get(key) ?? 0) + 1;
    ordinals.set(key, ordinal);
    const label =
      target.name.length > 0 ? target.name : `${target.role} ${ordinal}`;
    parts.push(
      state.value !== null ? `${label}: ${state.value}` : `${label} checked`,
    );
  }
  const segments = [...parts];
  if (parts.length > 1) segments.push(parts.join(", "));
  return segments;
}

function indexedCriteria(
  items: readonly string[],
  prefix: string,
): Record<string, string> {
  return Object.fromEntries(
    items.map((item, index) => [`${prefix}${index}`, item]),
  );
}

function resolveIndexed(
  id: string | null,
  items: readonly string[],
  prefix: string,
): string | null {
  if (id === null || id === NONE_TARGET || !id.startsWith(prefix)) return null;
  const index = Number(id.slice(prefix.length));
  return Number.isInteger(index) ? (items[index] ?? null) : null;
}

interface ChoiceAnswer {
  readonly choice: string;
}

function parseChoiceAnswer(
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): ChoiceAnswer {
  if (value === null || typeof value !== "object")
    throw new RetryableJevDecisionError(
      `OpenRouter Decisions API omitted its ${label}`,
    );
  const record = value as { choice?: unknown };
  if (typeof record.choice !== "string" || !allowed.has(record.choice)) {
    throw new RetryableJevDecisionError(
      `OpenRouter Decisions API returned an invalid ${label}`,
    );
  }
  return { choice: record.choice };
}

function readNoul(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  const noul = (value as { noul?: unknown }).noul;
  return typeof noul === "number" && Number.isFinite(noul) ? noul : 0;
}

function readCost(parsed: unknown): number {
  if (parsed === null || typeof parsed !== "object") return 0;
  const usage = (parsed as { usage?: unknown }).usage;
  if (usage === null || typeof usage !== "object") return 0;
  const cost = (usage as { cost?: unknown }).cost;
  return typeof cost === "number" && Number.isFinite(cost) ? cost : 0;
}

interface OperationChoice {
  readonly action: JevAction;
  readonly ref: string | null;
  /** True when action needed a target but the target head answered "none". */
  readonly targetWasNone: boolean;
  readonly textAnswer: string | null;
  readonly urlAnswer: string | null;
  readonly evidenceAnswer: string | null;
  readonly submit: boolean;
  readonly goalCompleteAfter: boolean;
  readonly costUsd: number;
}

export interface TypeSafeDecisionsProviderOptions {
  readonly apiKey: string;
  readonly model?: string;
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Calls OpenRouter's Decisions API, which runs TypeSafe's Jev model directly:
 * one request per step asks the operation choice, per-operation target heads,
 * text/URL candidate heads (built locally from the goal, no LLM), an
 * answer-evidence head (built locally from visible text, no LLM), and two
 * "noul" (probability) heads for submit-after-typing and speculative
 * goal completion — every OpenRouter call this plugin makes is this one
 * endpoint, matching Computer's Jev-only rule.
 */
export class TypeSafeDecisionsJevProvider implements JevProvider {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #endpoint: string;
  readonly #timeoutMs: number;
  readonly #fetchImpl: typeof fetch;

  constructor(options: TypeSafeDecisionsProviderOptions) {
    if (options.apiKey.trim().length === 0)
      throw new Error("OpenRouter API key is missing");
    this.#apiKey = options.apiKey;
    this.#model = options.model ?? DECISIONS_MODEL;
    this.#endpoint = options.endpoint ?? OPENROUTER_DECISIONS_URL;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetchImpl = options.fetchImpl ?? fetch;
  }

  get model(): string {
    return this.#model;
  }

  async decide(
    request: JevDecisionRequest,
    signal: AbortSignal,
  ): Promise<JevDecision> {
    const targets = parseSnapshotTargets(request.observation.snapshot);
    const fillTargets = targets.filter((target) => isFillableRole(target.role));
    const selectTargets = targets.filter((target) =>
      isSelectableRole(target.role),
    );
    const textCandidates = extractTextCandidates(request.goal);
    const urlCandidates = extractUrlCandidates(
      request.goal,
      request.observation.text,
    );
    const segments = [
      ...(request.observation.title.trim().length > 0
        ? [request.observation.title.trim()]
        : []),
      ...splitTextSegments(request.observation.text),
      ...elementStateSegments(targets),
    ].slice(0, MAX_ANSWER_SEGMENTS);

    let result = await this.#chooseOperation(
      request,
      targets,
      fillTargets,
      selectTargets,
      textCandidates,
      urlCandidates,
      segments,
      signal,
    );
    if (result.targetWasNone) {
      const retryRequest: JevDecisionRequest = {
        ...request,
        recentOutcomes: [
          ...request.recentOutcomes,
          `${result.action}: target answered "none"; the state's elements table shows each offered target's current role/name/value/checked/selected — choose the specific one that still needs to change`,
        ].slice(-5),
      };
      const retried = await this.#chooseOperation(
        retryRequest,
        targets,
        fillTargets,
        selectTargets,
        textCandidates,
        urlCandidates,
        segments,
        signal,
      );
      result = {
        ...retried,
        costUsd: result.costUsd + retried.costUsd,
      };
      if (result.targetWasNone) {
        throw new RetryableJevDecisionError(
          `OpenRouter Decisions API answered "none" for a ${result.action} target twice in a row`,
        );
      }
    }

    const { action, ref, submit, goalCompleteAfter, costUsd } = result;
    if (action === "fill" || action === "select") {
      const value = resolveIndexed(result.textAnswer, textCandidates, "t");
      if (value === null) {
        return {
          action: "blocked",
          ref: null,
          value: null,
          url: null,
          answer: `Blocked: no literal text for this ${action} was found in the goal; use \`run\` or the credential-fill command instead.`,
          submit: false,
          goalCompleteAfter: false,
          costUsd,
        };
      }
      return {
        action,
        ref,
        value,
        url: null,
        answer: "",
        submit,
        goalCompleteAfter,
        costUsd,
      };
    }
    if (action === "goto") {
      const url = resolveIndexed(result.urlAnswer, urlCandidates, "u");
      if (url === null) {
        return {
          action: "blocked",
          ref: null,
          value: null,
          url: null,
          answer:
            "Blocked: no literal URL was found in the goal or the page; use `run` instead.",
          submit: false,
          goalCompleteAfter: false,
          costUsd,
        };
      }
      return {
        action,
        ref: null,
        value: null,
        url,
        answer: "",
        submit: false,
        goalCompleteAfter: false,
        costUsd,
      };
    }
    if (action === "done") {
      const evidence = resolveIndexed(result.evidenceAnswer, segments, "s");
      const answer =
        evidence ??
        request.observation.text.slice(0, 500) ??
        request.observation.title;
      return {
        action,
        ref: null,
        value: null,
        url: null,
        answer,
        submit: false,
        goalCompleteAfter: false,
        costUsd,
      };
    }
    if (action === "blocked") {
      return {
        action,
        ref: null,
        value: null,
        url: null,
        answer: "Blocked: no supported operation can make progress.",
        submit: false,
        goalCompleteAfter: false,
        costUsd,
      };
    }
    return {
      action,
      ref: cleanRef(ref),
      value: null,
      url: null,
      answer: "",
      submit,
      goalCompleteAfter,
      costUsd,
    };
  }

  async #chooseOperation(
    request: JevDecisionRequest,
    targets: readonly SnapshotTarget[],
    fillTargets: readonly SnapshotTarget[],
    selectTargets: readonly SnapshotTarget[],
    textCandidates: readonly string[],
    urlCandidates: readonly string[],
    segments: readonly string[],
    signal: AbortSignal,
  ): Promise<OperationChoice> {
    const operationCriteria: Record<string, string> = {
      press_enter:
        "Press Enter, useful right after filling a search box or a single-field form",
      scroll_down: "Scroll down to reveal more of the page",
      scroll_up: "Scroll up to reveal content above the current view",
      done: "The goal is already complete and the answer is visible in visible_text, the snapshot, or page.title",
      blocked: "No supported operation can make progress",
    };
    if (targets.length > 0)
      operationCriteria.click = "Click an element on the page";
    if (fillTargets.length > 0)
      operationCriteria.fill = "Type text into a field";
    if (selectTargets.length > 0)
      operationCriteria.select = "Choose an option in a dropdown";
    if (urlCandidates.length > 0)
      operationCriteria.goto =
        "Navigate directly to a URL literally present in the goal or the page";

    const questions: Record<
      string,
      | {
          type: "choice";
          instructions: string;
          criteria: Record<string, string>;
        }
      | { type: "noul"; instructions: string }
    > = {
      operation: {
        type: "choice",
        instructions: OPERATION_INSTRUCTIONS,
        criteria: operationCriteria,
      },
      submit: { type: "noul", instructions: SUBMIT_INSTRUCTIONS },
      goal_complete_after: {
        type: "noul",
        instructions: GOAL_COMPLETE_INSTRUCTIONS,
      },
    };
    if (targets.length > 0) {
      questions.click_target = {
        type: "choice",
        instructions: targetInstructions("click"),
        criteria: {
          ...targetCriteria(targets),
          [NONE_TARGET]: "Not applicable; a different operation was chosen",
        },
      };
    }
    if (fillTargets.length > 0) {
      questions.fill_target = {
        type: "choice",
        instructions: targetInstructions("fill"),
        criteria: {
          ...targetCriteria(fillTargets),
          [NONE_TARGET]: "Not applicable; a different operation was chosen",
        },
      };
    }
    if (selectTargets.length > 0) {
      questions.select_target = {
        type: "choice",
        instructions: targetInstructions("select"),
        criteria: {
          ...targetCriteria(selectTargets),
          [NONE_TARGET]: "Not applicable; a different operation was chosen",
        },
      };
    }
    if (fillTargets.length > 0 || selectTargets.length > 0) {
      questions.fill_text = {
        type: "choice",
        instructions: FILL_TEXT_INSTRUCTIONS,
        criteria: {
          ...indexedCriteria(textCandidates, "t"),
          [NONE_TARGET]: "No offered text belongs in that field",
        },
      };
    }
    if (urlCandidates.length > 0) {
      questions.goto_url = {
        type: "choice",
        instructions: GOTO_URL_INSTRUCTIONS,
        criteria: {
          ...indexedCriteria(urlCandidates, "u"),
          [NONE_TARGET]: "Not applicable; a different operation was chosen",
        },
      };
    }
    questions.answer_evidence = {
      type: "choice",
      instructions: ANSWER_EVIDENCE_INSTRUCTIONS,
      criteria: {
        ...indexedCriteria(segments, "s"),
        [NONE_TARGET]: "No offered segment answers the goal",
      },
    };

    const state = {
      goal: request.goal,
      page: { url: request.observation.url, title: request.observation.title },
      visible_text: request.observation.text,
      elements: elementsTable(targets),
      recent_outcomes: request.recentOutcomes,
    };

    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    let response: Response;
    try {
      response = await this.#fetchImpl(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#model,
          session_id: request.runId,
          state,
          questions,
        }),
        signal: AbortSignal.any([timeoutSignal, signal]),
      });
    } catch (error) {
      if (timeoutSignal.aborted)
        throw new RetryableJevDecisionError(
          "OpenRouter Decisions API decision timed out",
        );
      throw error;
    }
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `OpenRouter Decisions API returned HTTP ${response.status}`,
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new RetryableJevDecisionError(
        "OpenRouter Decisions API returned malformed JSON",
      );
    }
    const answers =
      parsed !== null && typeof parsed === "object"
        ? (parsed as { answers?: unknown }).answers
        : undefined;
    if (answers === null || typeof answers !== "object")
      throw new RetryableJevDecisionError(
        "OpenRouter Decisions API omitted answers",
      );
    const record = answers as Record<string, unknown>;
    const costUsd = readCost(parsed);

    const operationIds = new Set(Object.keys(operationCriteria));
    const action = parseChoiceAnswer(
      record.operation,
      operationIds,
      "operation choice",
    ).choice as JevAction;
    const submit = readNoul(record.submit) >= SUBMIT_THRESHOLD;
    const goalCompleteAfter =
      readNoul(record.goal_complete_after) >= GOAL_COMPLETE_THRESHOLD;

    let evidenceAnswer: string | null = null;
    if (action === "done") {
      const segmentIds = new Set([
        ...segments.map((_, index) => `s${index}`),
        NONE_TARGET,
      ]);
      evidenceAnswer = parseChoiceAnswer(
        record.answer_evidence,
        segmentIds,
        "answer evidence",
      ).choice;
    }

    if (
      action !== "click" &&
      action !== "fill" &&
      action !== "select" &&
      action !== "goto"
    ) {
      return {
        action,
        ref: null,
        targetWasNone: false,
        textAnswer: null,
        urlAnswer: null,
        evidenceAnswer,
        submit,
        goalCompleteAfter,
        costUsd,
      };
    }
    if (action === "goto") {
      const urlIds = new Set([
        ...urlCandidates.map((_, index) => `u${index}`),
        NONE_TARGET,
      ]);
      const urlAnswer = parseChoiceAnswer(
        record.goto_url,
        urlIds,
        "goto url",
      ).choice;
      return {
        action,
        ref: null,
        targetWasNone: false,
        textAnswer: null,
        urlAnswer,
        evidenceAnswer: null,
        submit: false,
        goalCompleteAfter: false,
        costUsd,
      };
    }

    const relevantTargets =
      action === "click"
        ? targets
        : action === "fill"
          ? fillTargets
          : selectTargets;
    const head =
      action === "click"
        ? record.click_target
        : action === "fill"
          ? record.fill_target
          : record.select_target;
    const allowedRefs = new Set<string>([
      ...relevantTargets.map((target) => target.ref),
      NONE_TARGET,
    ]);
    const targetAnswer = parseChoiceAnswer(
      head,
      allowedRefs,
      `${action} target`,
    ).choice;
    if (targetAnswer === NONE_TARGET) {
      return {
        action,
        ref: null,
        targetWasNone: true,
        textAnswer: null,
        urlAnswer: null,
        evidenceAnswer: null,
        submit,
        goalCompleteAfter,
        costUsd,
      };
    }
    let textAnswer: string | null = null;
    if (action === "fill" || action === "select") {
      const textIds = new Set([
        ...textCandidates.map((_, index) => `t${index}`),
        NONE_TARGET,
      ]);
      textAnswer = parseChoiceAnswer(
        record.fill_text,
        textIds,
        "fill text",
      ).choice;
    }
    return {
      action,
      ref: cleanRef(targetAnswer),
      targetWasNone: false,
      textAnswer,
      urlAnswer: null,
      evidenceAnswer: null,
      submit,
      goalCompleteAfter,
      costUsd,
    };
  }
}

function refLiteral(ref: string): string {
  return JSON.stringify(`ref/${ref}`);
}

const MISSING_REF = 'actOk = false; actError = "missing ref";';
const MISSING_URL = 'actOk = false; actError = "missing url";';

function actionCode(decision: JevDecision): string {
  switch (decision.action) {
    case "click":
      return decision.ref === null
        ? MISSING_REF
        : `try { await page.click(${refLiteral(decision.ref)}); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "fill":
      return decision.ref === null
        ? MISSING_REF
        : `try { await page.fill(${refLiteral(decision.ref)}, ${JSON.stringify(decision.value ?? "")}); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "select":
      return decision.ref === null
        ? MISSING_REF
        : `try {
  await page.$eval(${refLiteral(decision.ref)}, (el, label) => {
    const option = Array.from(el.options).find((candidate) => candidate.textContent.trim() === label);
    if (!option) throw new Error('No option with visible text "' + label + '"');
    el.value = option.value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, ${JSON.stringify(decision.value ?? "")});
} catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "press_enter":
      return `try { await page.keyboard.press("Enter"); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "scroll_down":
      return `try { await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.85)); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "scroll_up":
      return `try { await page.evaluate(() => window.scrollBy(0, -window.innerHeight * 0.85)); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "goto":
      return decision.url === null
        ? MISSING_URL
        : `try { await page.goto(${JSON.stringify(decision.url)}, { waitUntil: "domcontentloaded" }); } catch (e) { actOk = false; actError = String((e && e.message) || e); }`;
    case "done":
    case "blocked":
      return "";
  }
}

function submitCode(decision: JevDecision): string {
  if (!decision.submit || decision.action !== "fill") return "";
  return 'if (actOk) { try { await page.keyboard.press("Enter"); } catch (e) { actOk = false; actError = String((e && e.message) || e); } }';
}

const MAX_VISIBLE_TEXT_CHARS = 3_000;

const VISIBLE_TEXT_EXTRACTOR = `(maxChars) => {
  function collapse(value) { return value.replace(/\\s+/g, " ").trim(); }
  function isBlock(el) {
    const display = window.getComputedStyle(el).display;
    return display !== "inline" && display !== "inline-block";
  }
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const top = -vh;
  const bottom = vh * 2;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.nodeValue;
      if (!value || !value.trim()) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const seenBlocks = new Set();
  const parts = [];
  let length = 0;
  let node;
  while ((node = walker.nextNode())) {
    let block = node.parentElement;
    while (block && block !== document.body && !isBlock(block)) block = block.parentElement;
    if (!block || seenBlocks.has(block)) continue;
    seenBlocks.add(block);
    const rect = block.getBoundingClientRect();
    if (rect.bottom < top || rect.top > bottom) continue;
    const blockText = collapse(block.innerText || block.textContent || "");
    if (!blockText) continue;
    parts.push(blockText);
    length += blockText.length;
    if (length > maxChars) break;
  }
  let combined = collapse(parts.join(" "));
  if (!combined) combined = collapse(document.body.innerText || "");
  return combined.slice(0, maxChars);
}`;

function settleMs(decision: JevDecision | null): number {
  return decision !== null && decision.action === "fill" ? 200 : 50;
}

export function buildStepScript(decision: JevDecision | null): string {
  const action =
    decision === null
      ? ""
      : [actionCode(decision), submitCode(decision)].filter(Boolean).join("\n");
  return [
    'const page = await browser.getPage("main");',
    "let actOk = true;",
    "let actError = null;",
    "const urlBefore = page.url();",
    action,
    `await new Promise((resolve) => setTimeout(resolve, ${settleMs(decision)}));`,
    "if (page.url() !== urlBefore) { try { await page.waitForLoad({ timeout: 2000 }); } catch {} }",
    "let snapshot;",
    'try { snapshot = await page.snapshot({ interactive: true, maxChars: 12000 }); } catch (e) { snapshot = "snapshot unavailable: " + String((e && e.message) || e); }',
    'let title = "";',
    "try { title = await page.title(); } catch {}",
    'let text = "";',
    `try { text = await page.evaluate(${VISIBLE_TEXT_EXTRACTOR}, ${MAX_VISIBLE_TEXT_CHARS}); } catch (e) { text = ""; }`,
    "({ actOk, actError, url: page.url(), title, snapshot, text });",
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
  readonly text: string;
}

function parseStepResult(text: string): StepResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Browser step script returned malformed output");
  }
  if (parsed === null || typeof parsed !== "object")
    throw new Error("Browser step script returned no data");
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
    text: typeof record.text === "string" ? record.text : "",
  };
}

export interface JevGoalResult {
  readonly state: "done" | "blocked" | "max_steps";
  readonly answer: string;
  readonly url: string;
  readonly title: string;
  readonly steps: DoStep[];
  readonly costUsd: number;
  readonly model: string;
}

const MAX_STEP_OUTCOME_LENGTH = 400;
const MAX_STEP_TARGET_LENGTH = 200;
const MAX_ANSWER_LENGTH = 4_000;

function clampStepOutcome(outcome: string): string {
  return outcome.length > MAX_STEP_OUTCOME_LENGTH
    ? outcome.slice(0, MAX_STEP_OUTCOME_LENGTH)
    : outcome;
}

function clampStepTarget(target: string | null): string | null {
  if (target === null) return null;
  return target.length > MAX_STEP_TARGET_LENGTH
    ? target.slice(0, MAX_STEP_TARGET_LENGTH)
    : target;
}

function clampAnswer(answer: string): string {
  return answer.length > MAX_ANSWER_LENGTH
    ? answer.slice(0, MAX_ANSWER_LENGTH)
    : answer;
}

function isRetryableDecisionError(error: unknown): boolean {
  return error instanceof RetryableJevDecisionError;
}

async function decideWithRetry(
  provider: JevProvider,
  request: JevDecisionRequest,
  signal: AbortSignal,
): Promise<JevDecision> {
  try {
    return await provider.decide(request, signal);
  } catch (error) {
    if (signal.aborted || !isRetryableDecisionError(error)) throw error;
    try {
      return await provider.decide(request, signal);
    } catch (retryError) {
      if (signal.aborted || !isRetryableDecisionError(retryError))
        throw retryError;
      return {
        action: "blocked",
        ref: null,
        value: null,
        url: null,
        answer: `Blocked: the decision service returned an invalid answer twice in a row (${(retryError as Error).message}).`,
        submit: false,
        goalCompleteAfter: false,
        costUsd: 0,
      };
    }
  }
}

export interface RunJevGoalArgs {
  readonly goal: string;
  readonly maxSteps: number;
  readonly stepTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly provider: JevProvider;
  readonly runScript: (
    script: string,
    timeoutMs: number,
    signal: AbortSignal,
  ) => Promise<{ text: string }>;
  /** Sent as session_id on every decision request so TypeSafe can group a run's calls; generated when omitted. */
  readonly runId?: string;
}

export async function runJevGoal(args: RunJevGoalArgs): Promise<JevGoalResult> {
  const runId = args.runId ?? randomUUID();
  const model = args.provider.model ?? "";
  const steps: DoStep[] = [];
  let pendingDecision: JevDecision | null = null;
  let lastAnswer = "";
  let lastUrl = "";
  let lastTitle = "";
  let costUsd = 0;
  for (let index = 0; index < args.maxSteps; index += 1) {
    args.signal.throwIfAborted();
    const raw = await args.runScript(
      buildStepScript(pendingDecision),
      args.stepTimeoutMs,
      args.signal,
    );
    const stepResult = parseStepResult(raw.text);
    lastUrl = stepResult.url;
    lastTitle = stepResult.title;
    if (pendingDecision !== null) {
      const executed = pendingDecision;
      steps.push({
        index: index - 1,
        action: executed.action,
        target: clampStepTarget(executed.ref),
        outcome: clampStepOutcome(
          stepResult.actOk
            ? "ok"
            : `failed: ${stepResult.actError ?? "unknown error"}`,
        ),
      });
      if (executed.goalCompleteAfter && stepResult.actOk) {
        return {
          state: "done",
          answer: clampAnswer(stepResult.text),
          url: stepResult.url,
          title: stepResult.title,
          steps,
          costUsd,
          model,
        };
      }
    }
    args.signal.throwIfAborted();
    const decision = await decideWithRetry(
      args.provider,
      {
        goal: args.goal,
        observation: {
          url: stepResult.url,
          title: stepResult.title,
          snapshot: stepResult.snapshot,
          text: stepResult.text,
        },
        recentOutcomes: steps
          .slice(-5)
          .map(
            (step) => `${step.action} ${step.target ?? ""}: ${step.outcome}`,
          ),
        runId,
      },
      args.signal,
    );
    costUsd += decision.costUsd;
    lastAnswer = decision.answer;
    if (decision.action === "done" || decision.action === "blocked") {
      steps.push({
        index,
        action: decision.action,
        target: null,
        outcome: clampStepOutcome(decision.answer),
      });
      return {
        state: decision.action === "done" ? "done" : "blocked",
        answer: clampAnswer(decision.answer),
        url: lastUrl,
        title: lastTitle,
        steps,
        costUsd,
        model,
      };
    }
    pendingDecision = decision;
  }
  return {
    state: "max_steps",
    answer: clampAnswer(lastAnswer),
    url: lastUrl,
    title: lastTitle,
    steps,
    costUsd,
    model,
  };
}

export function resolveJevApiKey(env: NodeJS.ProcessEnv): string | null {
  const key = env.OPENROUTER_API_KEY?.trim();
  return key !== undefined && key.length > 0 ? key : null;
}

export function createOpenRouterBrowserJevProvider(
  env: NodeJS.ProcessEnv = process.env,
): JevProvider | null {
  const apiKey = resolveJevApiKey(env);
  if (apiKey === null) return null;
  return new TypeSafeDecisionsJevProvider({ apiKey });
}
