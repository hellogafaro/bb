import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { CuaTransport } from "./cua-transport.js";
import { content, CuaError } from "./cua-transport.js";
import type { Observation, Operation, OperationKind, Target } from "./contracts.js";

type HostlessObservation = Omit<Observation, "hostId">;

interface CuaElement {
  readonly element_index?: number;
  readonly element_token?: string;
  readonly role?: string;
  readonly label?: string;
  readonly value?: unknown;
  readonly enabled?: boolean;
  readonly actions?: string[];
  readonly frame?: { x?: number; y?: number; w?: number; h?: number };
}

interface CuaWindow {
  readonly pid?: number;
  readonly window_id?: number;
  readonly id?: number;
  readonly title?: string;
  readonly app_name?: string;
  readonly executable?: string;
  readonly is_on_screen?: boolean;
  readonly z_index?: number;
}

interface Binding {
  readonly elementIndex: number;
  readonly elementToken?: string;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function allowedOperationsFor(element: CuaElement): Target["allowedOperations"] {
  const role = (element.role ?? "").toLocaleLowerCase();
  const actions = element.actions ?? [];
  const ops: Target["allowedOperations"] = [];
  const clickable = ["button", "link", "check box", "checkbox", "radio button", "radio", "menu item", "tab"];
  const typable = ["text", "entry", "password text", "searchbox", "combobox"];
  if (clickable.includes(role) && actions.some((a) => ["press", "click", "check", "jump", "doDefault"].includes(a))) {
    ops.push("click", "double_click");
  }
  if (typable.includes(role)) ops.push("type", "set_value");
  if (role === "combobox" || role === "list box") ops.push("select");
  if (actions.some((a) => ["scrollDown", "scrollUp", "scrollForward", "scrollBackward"].includes(a))) ops.push("scroll");
  return [...new Set(ops)];
}

export class DesktopWindow {
  constructor(
    readonly pid: number,
    readonly windowId: number,
    readonly title: string,
  ) {}
}

export async function findWindow(
  transport: CuaTransport,
  signal: AbortSignal,
  appId?: string,
): Promise<DesktopWindow> {
  const result = await transport.call("list_windows", { on_screen_only: true }, signal);
  const windows = (content(result).windows as CuaWindow[] | undefined) ?? [];
  const candidates = windows.filter((window) => window.is_on_screen !== false);
  const matched = appId === undefined
    ? candidates
    : candidates.filter((window) => {
        const name = (window.app_name ?? "").toLocaleLowerCase();
        const executable = basename(window.executable ?? "").toLocaleLowerCase();
        const title = (window.title ?? "").toLocaleLowerCase();
        const needle = appId.toLocaleLowerCase();
        return name.includes(needle) || executable.includes(needle) || title.includes(needle);
      });
  const pool = matched.length > 0 ? matched : candidates;
  const chosen = pool
    .slice()
    .sort((a, b) => (b.z_index ?? 0) - (a.z_index ?? 0))[0];
  if (chosen === undefined || typeof chosen.pid !== "number") {
    throw new CuaError(
      appId === undefined ? "No on-screen window is available to observe" : `No on-screen window matches "${appId}"`,
      "stale-observation",
      true,
    );
  }
  const windowId = Number(chosen.window_id ?? chosen.id ?? 0);
  return new DesktopWindow(chosen.pid, windowId, String(chosen.title ?? ""));
}

export class TargetTable {
  #bindings = new Map<string, Binding>();
  #snapshotId = "";
  #window: DesktopWindow | null = null;

  get window(): DesktopWindow | null {
    return this.#window;
  }

  async observe(transport: CuaTransport, signal: AbortSignal, appId?: string): Promise<HostlessObservation> {
    const window = await findWindow(transport, signal, appId);
    return this.#observeWindow(transport, signal, window);
  }

  async reobserve(transport: CuaTransport, signal: AbortSignal): Promise<HostlessObservation> {
    if (this.#window === null) throw new CuaError("No window has been observed yet", "stale-observation", true);
    return this.#observeWindow(transport, signal, this.#window);
  }

  async #observeWindow(transport: CuaTransport, signal: AbortSignal, window: DesktopWindow): Promise<HostlessObservation> {
    this.#window = window;
    const result = await transport.call(
      "get_window_state",
      {
        pid: window.pid,
        window_id: window.windowId,
        include_screenshot: false,
        include_accessibility_tree: true,
        max_elements: 300,
        max_depth: 24,
      },
      signal,
    );
    const data = content(result);
    const elements = (data.elements as CuaElement[] | undefined) ?? [];
    const snapshotSeed = typeof data.snapshot_id === "string" ? data.snapshot_id : sha256(elements);
    const snapshotId = sha256(snapshotSeed).slice(0, 24);
    const bindings = new Map<string, Binding>();
    const targets: Target[] = [];
    let index = 0;
    for (const element of elements) {
      if (!Number.isInteger(element.element_index) || element.enabled === false) continue;
      const allowedOperations = allowedOperationsFor(element);
      const name = String(element.label ?? "").replace(/\s+/gu, " ").trim().slice(0, 300);
      if (allowedOperations.length === 0 || name.length === 0) continue;
      const targetId = `t${index}_${sha256(`${element.element_index}:${element.role ?? ""}:${name}`).slice(0, 12)}`;
      bindings.set(targetId, {
        elementIndex: element.element_index!,
        ...(typeof element.element_token === "string" ? { elementToken: element.element_token } : {}),
      });
      const frame = element.frame;
      const bounds =
        frame !== undefined &&
        [frame.x, frame.y, frame.w, frame.h].every((value) => typeof value === "number") &&
        frame.w! > 0 &&
        frame.h! > 0
          ? { x: frame.x!, y: frame.y!, width: frame.w!, height: frame.h! }
          : null;
      const value = element.value == null ? null : String(element.value).slice(0, 500);
      targets.push({
        index,
        targetId,
        role: String(element.role ?? "unknown").slice(0, 80),
        name,
        value,
        bounds,
        ref: null,
        allowedOperations,
      });
      index += 1;
      if (targets.length >= 200) break;
    }
    this.#bindings = bindings;
    this.#snapshotId = snapshotId;
    return {
      surface: "desktop",
      title: String(data.window_title ?? window.title ?? "").slice(0, 500),
      snapshotId,
      observedAt: Date.now(),
      targets,
    };
  }

  resolveTarget(targetId: string, snapshotId: string): { pid: number; window_id: number; element_index: number; element_token?: string; snapshot_id?: string } {
    if (this.#window === null) throw new CuaError("No window has been observed yet", "stale-observation", true);
    if (snapshotId !== this.#snapshotId) {
      throw new CuaError("The target table has changed since this action was decided; re-observe first", "stale-observation", true);
    }
    const binding = this.#bindings.get(targetId);
    if (binding === undefined) throw new CuaError(`Unknown target ${targetId}`, "stale-observation", true);
    return {
      pid: this.#window.pid,
      window_id: this.#window.windowId,
      element_index: binding.elementIndex,
      ...(binding.elementToken === undefined ? { snapshot_id: this.#snapshotId } : { element_token: binding.elementToken }),
    };
  }

  windowArgs(): { pid: number; window_id: number } {
    if (this.#window === null) throw new CuaError("No window has been observed yet", "stale-observation", true);
    return { pid: this.#window.pid, window_id: this.#window.windowId };
  }
}

export function operationKind(action: Operation): OperationKind {
  return action.kind;
}
