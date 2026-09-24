import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
  type RefObject,
} from "react";
import type { EditorView } from "@codemirror/view";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import type {
  MessageProseSelection,
  SelectionAnchorPoint,
  SelectionAnchorSide,
} from "@/components/thread/timeline/SelectableMessageProse";
import { TimelineSelectionMenu } from "@/components/thread/timeline/TimelineSelectionMenu";
import { lineRangeForDoc, quotePathLines } from "./quote-selection";

const DRAG_SIDE_PX = 4;

interface SelectionAnchor {
  point: SelectionAnchorPoint;
  side: SelectionAnchorSide;
}

function pointFromMouse(
  event: Pick<MouseEvent, "clientX" | "clientY">,
): SelectionAnchorPoint | null {
  if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
    return null;
  }
  return { x: event.clientX, y: event.clientY };
}

function anchorFromRelease(
  start: SelectionAnchorPoint | null,
  event: Pick<MouseEvent, "clientX" | "clientY"> & { pointerType?: string },
): SelectionAnchor | null {
  if (
    event.pointerType !== undefined &&
    event.pointerType !== "" &&
    event.pointerType !== "mouse"
  ) {
    return null;
  }
  const point = pointFromMouse(event);
  if (point === null) return null;
  return {
    point,
    side: start !== null && point.y - start.y > DRAG_SIDE_PX ? "bottom" : "top",
  };
}

function selectionRect(
  view: EditorView,
  from: number,
  to: number,
): DOMRect | null {
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);
  const a = start ?? end;
  const b = end ?? start;
  if (a === null || b === null) return null;
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return new DOMRect(
    left,
    top,
    Math.max(a.right, b.right) - left,
    Math.max(a.bottom, b.bottom) - top,
  );
}

function readEditorSelection(
  view: EditorView | null,
  path: string,
  anchor: SelectionAnchor | null,
): MessageProseSelection | null {
  if (view === null) return null;
  const range = view.state.selection.main;
  if (range.empty) return null;
  const doc = view.state.doc;
  const lines = lineRangeForDoc(doc, range.from, range.to);
  if (lines === null) return null;
  const text = quotePathLines(
    path,
    lines.start,
    lines.end,
    doc.sliceString(doc.line(lines.start).from, doc.line(lines.end).to),
  );
  if (text === null) return null;
  const rect =
    selectionRect(view, range.from, range.to) ??
    (anchor === null
      ? view.dom.getBoundingClientRect()
      : new DOMRect(anchor.point.x, anchor.point.y, 0, 0));
  return anchor === null
    ? { text, rect }
    : { text, rect, anchorPoint: anchor.point, anchorSide: anchor.side };
}

export function useEditorSelectionMenu({
  containerRef,
  viewRef,
  path,
  skipRef,
  onAddToChat,
}: {
  containerRef: RefObject<HTMLElement | null>;
  viewRef: RefObject<EditorView | null>;
  path: string;
  skipRef: MutableRefObject<boolean>;
  onAddToChat: ((text: string) => void) | undefined;
}): ReactNode {
  const coarse = usePointerCoarse();
  const enabled = !coarse && onAddToChat !== undefined;
  const [selection, setSelection] = useState<MessageProseSelection | null>(
    null,
  );
  const startedInside = useRef(false);
  const startPoint = useRef<SelectionAnchorPoint | null>(null);
  const pointerDown = useRef(false);
  const lastAnchor = useRef<SelectionAnchor | null>(null);

  const dismiss = useCallback(() => setSelection(null), []);

  useEffect(() => {
    setSelection(null);
  }, [path]);

  useEffect(() => {
    if (!enabled) return;
    let frame: number | null = null;
    const cancel = () => {
      if (frame === null) return;
      window.cancelAnimationFrame(frame);
      frame = null;
    };
    const schedule = (anchor: SelectionAnchor | null) => {
      cancel();
      frame = window.requestAnimationFrame(() => {
        frame = null;
        setSelection(
          skipRef.current
            ? null
            : readEditorSelection(viewRef.current, path, anchor),
        );
      });
    };
    const onPointerDown = (event: PointerEvent) => {
      cancel();
      const container = containerRef.current;
      startedInside.current =
        container !== null &&
        event.target instanceof Node &&
        container.contains(event.target);
      startPoint.current = startedInside.current ? pointFromMouse(event) : null;
      pointerDown.current = true;
      if (startedInside.current) skipRef.current = false;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const view = viewRef.current;
      if (view === null || !view.hasFocus) return;
      const selectAll =
        event.key.toLowerCase() === "a" && (event.metaKey || event.ctrlKey);
      if (event.shiftKey || selectAll) skipRef.current = false;
    };
    const onRelease = (event: PointerEvent | MouseEvent) => {
      const started = startedInside.current;
      const anchor =
        started && startPoint.current !== null
          ? anchorFromRelease(startPoint.current, event)
          : null;
      if (anchor !== null) lastAnchor.current = anchor;
      pointerDown.current = false;
      startPoint.current = null;
      if (started) schedule(anchor ?? lastAnchor.current);
    };
    const onCancel = () => {
      pointerDown.current = false;
      startPoint.current = null;
    };
    const onSelectionChange = () => {
      if (pointerDown.current) return;
      const view = viewRef.current;
      if (view === null || !view.hasFocus) return;
      schedule(lastAnchor.current);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerup", onRelease);
    document.addEventListener("pointercancel", onCancel);
    document.addEventListener("mouseup", onRelease);
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onSelectionChange);
    return () => {
      cancel();
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerup", onRelease);
      document.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("mouseup", onRelease);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onSelectionChange);
    };
  }, [containerRef, enabled, path, skipRef, viewRef]);

  const addToChat = useCallback(
    (text: string) => {
      onAddToChat?.(text);
      const view = viewRef.current;
      if (view !== null) {
        view.dispatch({
          selection: { anchor: view.state.selection.main.head },
        });
      }
      setSelection(null);
    },
    [onAddToChat, viewRef],
  );

  return enabled ? (
    <TimelineSelectionMenu
      selection={selection}
      onAddToChat={addToChat}
      onDismiss={dismiss}
    />
  ) : null;
}
