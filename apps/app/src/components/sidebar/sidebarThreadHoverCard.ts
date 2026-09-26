export const SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS = 150;
export const SIDEBAR_THREAD_HOVER_CARD_CLOSE_DELAY_MS = 100;
export const SIDEBAR_THREAD_HOVER_CARD_GAP_PX = 8;
export const SIDEBAR_THREAD_HOVER_CARD_VIEWPORT_MARGIN_PX = 8;
export const SIDEBAR_THREAD_HOVER_CARD_TRANSITION = "transform 120ms ease-out";

export interface HoverCardAnchorRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface HoverCardSize {
  width: number;
  height: number;
}

export interface HoverCardViewport {
  width: number;
  height: number;
}

export interface HoverCardPosition {
  x: number;
  y: number;
  side: "right" | "left";
}

export function computeSidebarHoverCardPosition({
  anchor,
  card,
  viewport,
  gap = SIDEBAR_THREAD_HOVER_CARD_GAP_PX,
  margin = SIDEBAR_THREAD_HOVER_CARD_VIEWPORT_MARGIN_PX,
}: {
  anchor: HoverCardAnchorRect;
  card: HoverCardSize;
  viewport: HoverCardViewport;
  gap?: number;
  margin?: number;
}): HoverCardPosition {
  const rightX = anchor.right + gap;
  const fitsRight = rightX + card.width <= viewport.width - margin;
  const leftX = anchor.left - gap - card.width;
  const side = fitsRight || leftX < margin ? "right" : "left";
  const x = side === "right" ? rightX : leftX;
  const maxY = Math.max(margin, viewport.height - margin - card.height);
  const y = Math.min(Math.max(anchor.top, margin), maxY);
  return { x: Math.round(x), y: Math.round(y), side };
}

export function resolveSidebarThreadRowFromTarget(
  target: EventTarget | null,
  container: Element,
): { threadId: string; row: HTMLElement } | null {
  if (!(target instanceof Element) || !container.contains(target)) return null;
  const direct = target.closest<HTMLElement>("[data-sidebar-thread-id]");
  const rowContainer = target.closest<HTMLElement>("[data-sidebar-rename-row]");
  const anchor =
    direct ??
    rowContainer?.querySelector<HTMLElement>("[data-sidebar-thread-id]") ??
    null;
  if (anchor === null || !container.contains(anchor)) return null;
  const threadId = anchor.getAttribute("data-sidebar-thread-id");
  if (!threadId) return null;
  const row =
    anchor.closest<HTMLElement>("[data-sidebar-rename-row]") ?? anchor;
  return { threadId, row };
}

export type HoverCardTimingPhase =
  | { kind: "hidden" }
  | { kind: "pending"; threadId: string }
  | { kind: "shown"; threadId: string }
  | { kind: "closing"; threadId: string };

export interface HoverCardTimingController {
  enterRow(threadId: string): void;
  leaveRows(): void;
  hideNow(): void;
  phase(): HoverCardTimingPhase;
  dispose(): void;
}

interface HoverCardTimingOptions {
  openDelayMs?: number;
  closeDelayMs?: number;
  onShow(threadId: string): void;
  onHide(): void;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export function createSidebarHoverCardTimingController({
  openDelayMs = SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS,
  closeDelayMs = SIDEBAR_THREAD_HOVER_CARD_CLOSE_DELAY_MS,
  onShow,
  onHide,
  setTimeout: schedule = (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: cancel = (handle) =>
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}: HoverCardTimingOptions): HoverCardTimingController {
  let phase: HoverCardTimingPhase = { kind: "hidden" };
  let timer: unknown = null;

  const clearTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };

  const show = (threadId: string) => {
    phase = { kind: "shown", threadId };
    onShow(threadId);
  };

  return {
    enterRow(threadId) {
      switch (phase.kind) {
        case "hidden":
          phase = { kind: "pending", threadId };
          timer = schedule(() => {
            timer = null;
            if (phase.kind === "pending") show(phase.threadId);
          }, openDelayMs);
          return;
        case "pending":
          phase = { kind: "pending", threadId };
          return;
        case "closing":
          clearTimer();
          show(threadId);
          return;
        case "shown":
          if (phase.threadId !== threadId) show(threadId);
          return;
      }
    },
    leaveRows() {
      switch (phase.kind) {
        case "hidden":
        case "closing":
          return;
        case "pending":
          clearTimer();
          phase = { kind: "hidden" };
          return;
        case "shown": {
          const { threadId } = phase;
          phase = { kind: "closing", threadId };
          timer = schedule(() => {
            timer = null;
            phase = { kind: "hidden" };
            onHide();
          }, closeDelayMs);
          return;
        }
      }
    },
    hideNow() {
      const wasVisible = phase.kind === "shown" || phase.kind === "closing";
      clearTimer();
      phase = { kind: "hidden" };
      if (wasVisible) onHide();
    },
    phase() {
      return phase;
    },
    dispose() {
      clearTimer();
      phase = { kind: "hidden" };
    },
  };
}
