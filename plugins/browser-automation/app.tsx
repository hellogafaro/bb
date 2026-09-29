import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  activityIconClass,
  activityMetaClass,
  activityRowClass,
  activityTextClass,
  type ActivityRowState,
} from "@bb/shared-ui/activity-row-styles";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { Label } from "@bb/shared-ui/label";
import { cn } from "@bb/shared-ui/lib/utils";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  definePluginApp,
  useRpc,
  type PluginMessageDirectiveProps,
  type PluginPendingInteractionProps,
} from "@get-bb/plugin-sdk/app";
import {
  LOGIN_FILL_RENDERER_ID,
  loginFillPayloadSchema,
  loginFillResponseSchema,
} from "@bb/plugin-interaction-contracts";
import type {
  PreviewFrame,
  PreviewInputEvent,
  PreviewSize,
  rpcContract,
} from "./contracts.js";
import {
  closeLightbox,
  openLightbox,
  useLightboxTarget,
  type LightboxTarget,
} from "./lightbox-store.js";
import { PREVIEW_DIRECTIVE_ID } from "./preview-directive.js";

const MIN_POLL_INTERVAL_MS = 400;
const MAX_RETRY_INTERVAL_MS = 15_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADER_BUTTON_CLASS =
  "flex min-h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-none bg-transparent px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-background/80";
const EXPAND_BUTTON_CLASS =
  "flex min-h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-none border-l border-border/35 bg-transparent text-muted-foreground transition-colors hover:text-foreground";

type PreviewStatus = "connecting" | "live" | "ended" | "unavailable";

const STATUS_LABEL: Record<PreviewStatus, string> = {
  connecting: "Connecting",
  live: "Live",
  ended: "Ended",
  unavailable: "Unavailable",
};

function subscribeDocumentVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function readDocumentVisible(): boolean {
  return document.visibilityState !== "hidden";
}

function useDocumentVisible(): boolean {
  return useSyncExternalStore(
    subscribeDocumentVisibility,
    readDocumentVisible,
    () => true,
  );
}

function useInViewport(): [(element: Element | null) => void, boolean] {
  const [element, setElement] = useState<Element | null>(null);
  const [inViewport, setInViewport] = useState(true);

  useEffect(() => {
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) setInViewport(entry.isIntersecting);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [setElement, inViewport];
}

function pageLocation(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:")
      return `${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    if (parsed.protocol === "about:") return url;
    if (parsed.protocol === "file:") return decodeURIComponent(parsed.pathname);
    return parsed.protocol;
  } catch {
    return url.slice(0, 80);
  }
}

function pageTitle(frame: PreviewFrame | null): string {
  const title = frame?.title.trim() ?? "";
  return title === "" || title === frame?.url ? "Headless browser" : title;
}

function useLivePreview(args: {
  threadId: string;
  sessionId: string;
  enabled: boolean;
  size: PreviewSize;
  initialFrame: PreviewFrame | null;
}): {
  frame: PreviewFrame | null;
  status: PreviewStatus;
  controlled: boolean;
} {
  const { threadId, sessionId, enabled, size, initialFrame } = args;
  const rpc = useRpc<typeof rpcContract>();
  const [frame, setFrame] = useState<PreviewFrame | null>(initialFrame);
  const [status, setStatus] = useState<PreviewStatus>(
    initialFrame ? "live" : "connecting",
  );
  const [controlled, setControlled] = useState(false);
  const settled = status === "ended" || status === "unavailable";

  useEffect(() => {
    if (!enabled || settled) return;
    let cancelled = false;
    let timeout: number | null = null;
    let afterSequence = 0;
    let failures = 0;
    const poll = async () => {
      const startedAt = Date.now();
      let delayMs: number;
      try {
        const result = await rpc.call("preview", {
          threadId,
          sessionId,
          afterSequence,
          size,
        });
        if (cancelled) return;
        setControlled(result.controlled);
        if (
          result.session.state !== "ready" ||
          result.session.backend !== "local"
        ) {
          setStatus(
            result.session.backend === "local" ? "ended" : "unavailable",
          );
          return;
        }
        failures = 0;
        if (result.frame) {
          afterSequence = result.frame.sequence;
          setFrame(result.frame);
          setStatus("live");
        }
        delayMs = Math.max(0, MIN_POLL_INTERVAL_MS - (Date.now() - startedAt));
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_FAILURES) {
          setStatus("unavailable");
          return;
        }
        delayMs = Math.min(1_000 * 2 ** failures, MAX_RETRY_INTERVAL_MS);
      }
      timeout = window.setTimeout(() => void poll(), delayMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [enabled, rpc, sessionId, settled, size, threadId]);

  return { frame, status, controlled };
}

function PreviewImage({
  frame,
  status,
  title,
  className,
  maxHeight,
  overlay,
}: {
  frame: PreviewFrame | null;
  status: PreviewStatus;
  title: string;
  className: string;
  maxHeight?: string;
  overlay?: ReactNode;
}) {
  const aspect = frame ?? { width: 16, height: 9 };
  if (!frame && status !== "connecting") return null;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-md border border-border/60 bg-background",
        className,
      )}
      style={{
        aspectRatio: `${aspect.width} / ${aspect.height}`,
        ...(maxHeight === undefined
          ? {}
          : {
              width: `min(100%, calc(${maxHeight} * ${aspect.width / aspect.height}))`,
            }),
      }}
    >
      {frame ? (
        <img
          src={`data:${frame.mimeType};base64,${frame.data}`}
          alt={
            status === "live"
              ? `Live view of ${title}`
              : `Last view of ${title}`
          }
          draggable={false}
          className={cn(
            "block size-full object-contain",
            status !== "live" && "opacity-60",
          )}
        />
      ) : null}
      {frame ? overlay : null}
      {!frame ? (
        <div
          role="status"
          aria-busy="true"
          aria-label="Loading browser preview"
          className="size-full"
        >
          <Skeleton className="size-full rounded-none" />
        </div>
      ) : null}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function BrowserPreviewDirective({
  attributes,
  source,
  message,
}: PluginMessageDirectiveProps) {
  const sessionId = attributes.session?.trim() ?? "";
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    return (
      <Notice>
        browser-preview requires a valid session attribute, e.g.{" "}
        <code>::browser-preview{'{session="…"}'}</code>
      </Notice>
    );
  }
  return (
    <BrowserPreviewCard
      threadId={message.threadId}
      sessionId={sessionId}
      source={source}
    />
  );
}

function BrowserPreviewCard({
  threadId,
  sessionId,
  source,
}: {
  threadId: string;
  sessionId: string;
  source: string;
}) {
  const visible = useDocumentVisible();
  const [observe, inViewport] = useInViewport();
  const [expanded, setExpanded] = useState(true);
  const enlarged = useLightboxTarget()?.sessionId === sessionId;
  const bodyId = useId();
  const toggleId = useId();
  const { frame, status } = useLivePreview({
    threadId,
    sessionId,
    enabled: visible && inViewport && expanded && !enlarged,
    size: "thumbnail",
    initialFrame: null,
  });
  const activity: ActivityRowState = status === "live" ? "active" : "pending";
  const title = pageTitle(frame);
  const location = frame ? pageLocation(frame.url) : "";

  return (
    <section
      ref={observe}
      aria-label="Browser preview"
      title={source}
      className="my-2 overflow-hidden rounded-lg border border-border bg-surface-recessed"
    >
      <div
        role="group"
        aria-label={`Browser preview controls: ${title}`}
        className={activityRowClass(
          "active",
          "flex w-full items-stretch rounded-none px-0 py-0",
        )}
      >
        <button
          type="button"
          id={toggleId}
          aria-expanded={expanded}
          aria-controls={bodyId}
          aria-label={`Browser preview: ${title}`}
          onClick={() => setExpanded((value) => !value)}
          className={HEADER_BUTTON_CLASS}
        >
          <Icon
            name="Globe"
            className={activityIconClass(activity, "size-3.5 shrink-0")}
            aria-hidden
          />
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
            <span
              className={activityTextClass(activity, "min-w-0 truncate")}
              title={title}
            >
              {title}
            </span>
            {location ? (
              <span
                className={activityMetaClass(
                  activity,
                  "min-w-0 shrink truncate text-2xs",
                )}
                title={frame?.url}
              >
                {location}
              </span>
            ) : null}
          </span>
          <span className={activityMetaClass(activity, "shrink-0 text-2xs")}>
            {STATUS_LABEL[status]}
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              activityIconClass("pending"),
              "size-3.5 shrink-0 transition-transform duration-200",
              expanded && "rotate-180",
            )}
            aria-hidden
          />
        </button>
        {frame ? (
          <button
            type="button"
            aria-haspopup="dialog"
            aria-label="Expand browser preview"
            title="Expand"
            onClick={() => openLightbox({ threadId, sessionId, frame })}
            className={EXPAND_BUTTON_CLASS}
          >
            <Icon name="Maximize2" className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {expanded && (frame || status === "connecting") ? (
        <div
          id={bodyId}
          role="region"
          aria-labelledby={toggleId}
          className="border-t border-border bg-popover p-2"
        >
          <PreviewImage
            frame={frame}
            status={status}
            title={title}
            className="mx-auto w-full max-w-md"
          />
        </div>
      ) : null}
    </section>
  );
}

const SPECIAL_KEYS = new Set([
  "Enter",
  "Backspace",
  "Delete",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function isSpecialOrShortcutKey(event: {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): boolean {
  return (
    SPECIAL_KEYS.has(event.key) ||
    /^F\d{1,2}$/u.test(event.key) ||
    event.ctrlKey ||
    event.altKey ||
    event.metaKey
  );
}

function modifierBits(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  let bits = 0;
  if (event.altKey) bits |= 1;
  if (event.ctrlKey) bits |= 2;
  if (event.metaKey) bits |= 4;
  if (event.shiftKey) bits |= 8;
  return bits;
}

function pointerButtonFor(button: number): "left" | "middle" | "right" | null {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return null;
}

const MOVE_THROTTLE_MS = 33;
const WHEEL_THROTTLE_MS = 40;

function InteractiveOverlay({
  threadId,
  sessionId,
  frame,
}: {
  threadId: string;
  sessionId: string;
  frame: PreviewFrame;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const containerRef = useRef<HTMLDivElement>(null);
  const keyCaptureRef = useRef<HTMLTextAreaElement>(null);
  const lastMoveAtRef = useRef(0);
  const lastWheelAtRef = useRef(0);

  useEffect(() => {
    keyCaptureRef.current?.focus({ preventScroll: true });
  }, []);

  const send = useCallback(
    (event: PreviewInputEvent) => {
      void rpc.call("input", { threadId, sessionId, event }).catch(() => {});
    },
    [rpc, threadId, sessionId],
  );

  const pointInFrame = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const container = containerRef.current;
      if (!container) return { x: 0, y: 0 };
      const rect = container.getBoundingClientRect();
      const containerAspect = rect.width / rect.height;
      const frameAspect = frame.width / frame.height;
      let displayWidth = rect.width;
      let displayHeight = rect.height;
      let offsetX = 0;
      let offsetY = 0;
      if (containerAspect > frameAspect) {
        displayWidth = rect.height * frameAspect;
        offsetX = (rect.width - displayWidth) / 2;
      } else {
        displayHeight = rect.width / frameAspect;
        offsetY = (rect.height - displayHeight) / 2;
      }
      const fracX = Math.min(
        1,
        Math.max(0, (clientX - rect.left - offsetX) / displayWidth),
      );
      const fracY = Math.min(
        1,
        Math.max(0, (clientY - rect.top - offsetY) / displayHeight),
      );
      return { x: fracX * frame.width, y: fracY * frame.height };
    },
    [frame.width, frame.height],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const button = pointerButtonFor(event.button);
      if (button === null) return;
      event.preventDefault();
      containerRef.current?.setPointerCapture(event.pointerId);
      keyCaptureRef.current?.focus({ preventScroll: true });
      send({
        type: "mouseDown",
        ...pointInFrame(event.clientX, event.clientY),
        button,
        clickCount: 1,
      });
    },
    [pointInFrame, send],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const button = pointerButtonFor(event.button);
      if (button === null) return;
      send({
        type: "mouseUp",
        ...pointInFrame(event.clientX, event.clientY),
        button,
        clickCount: 1,
      });
    },
    [pointInFrame, send],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const now = performance.now();
      if (now - lastMoveAtRef.current < MOVE_THROTTLE_MS) return;
      lastMoveAtRef.current = now;
      send({
        type: "mouseMove",
        ...pointInFrame(event.clientX, event.clientY),
      });
    },
    [pointInFrame, send],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheelAtRef.current < WHEEL_THROTTLE_MS) return;
      lastWheelAtRef.current = now;
      send({
        type: "wheel",
        ...pointInFrame(event.clientX, event.clientY),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    },
    [pointInFrame, send],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!isSpecialOrShortcutKey(event)) return;
      event.preventDefault();
      const modifiers = modifierBits(event);
      send({ type: "keyDown", key: event.key, code: event.code, modifiers });
      send({ type: "keyUp", key: event.key, code: event.code, modifiers });
    },
    [send],
  );

  const handleInput = useCallback(
    (event: React.FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      const text = target.value;
      target.value = "";
      if (text.length === 0) return;
      send({ type: "insertText", text });
    },
    [send],
  );

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label="Interactive browser control"
      className="absolute inset-0 cursor-default touch-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={handleWheel}
    >
      <textarea
        ref={keyCaptureRef}
        aria-label="Browser keyboard input"
        className="absolute inset-0 h-full w-full cursor-default resize-none opacity-0"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onKeyDown={handleKeyDown}
        onInput={handleInput}
      />
    </div>
  );
}

const TAKEOVER_BUTTON_CLASS =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50";

function LightboxBody({
  target,
  open,
}: {
  target: LightboxTarget;
  open: boolean;
}) {
  const visible = useDocumentVisible();
  const rpc = useRpc<typeof rpcContract>();
  const {
    frame,
    status,
    controlled: controlling,
  } = useLivePreview({
    threadId: target.threadId,
    sessionId: target.sessionId,
    enabled: visible && open,
    size: "full",
    initialFrame: target.frame,
  });
  const [pending, setPending] = useState(false);
  const title = pageTitle(frame);
  const location = frame ? pageLocation(frame.url) : "";
  const canToggle = status === "live" && frame !== null && !pending;

  const toggleControl = useCallback(async () => {
    setPending(true);
    try {
      if (controlling) {
        await rpc.call("release", {
          threadId: target.threadId,
          sessionId: target.sessionId,
        });
      } else {
        await rpc.call("takeover", {
          threadId: target.threadId,
          sessionId: target.sessionId,
        });
      }
    } catch {
      // The next preview poll reflects the actual server-side control state.
    } finally {
      setPending(false);
    }
  }, [controlling, rpc, target.sessionId, target.threadId]);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-8 text-sm">{title}</DialogTitle>
        <DialogDescription className="truncate text-xs">
          {[location, STATUS_LABEL[status]].filter(Boolean).join(" · ")}
        </DialogDescription>
      </DialogHeader>
      <PreviewImage
        frame={frame}
        status={status}
        title={title}
        className="mx-auto"
        maxHeight="78dvh"
        overlay={
          controlling && frame ? (
            <InteractiveOverlay
              threadId={target.threadId}
              sessionId={target.sessionId}
              frame={frame}
            />
          ) : null
        }
      />
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!canToggle}
          onClick={() => void toggleControl()}
          className={TAKEOVER_BUTTON_CLASS}
        >
          {controlling ? "Give back control" : "Take over"}
        </button>
      </div>
    </>
  );
}

function BrowserPreviewLightbox() {
  const target = useLightboxTarget();
  const [shown, setShown] = useState(target);
  if (target !== null && target !== shown) setShown(target);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) closeLightbox();
      }}
    >
      <DialogContent className="max-w-6xl gap-3 p-4">
        {shown ? (
          <LightboxBody
            key={shown.sessionId}
            target={shown}
            open={target !== null}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MaskedField({
  id,
  label,
  masked,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  masked: boolean;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="min-w-0 space-y-1.5">
      <Label
        htmlFor={id}
        className="font-mono text-xs font-semibold text-foreground"
        translate="no"
      >
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          type={masked && !revealed ? "password" : "text"}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className={cn("bg-card", masked && "pr-11")}
        />
        {masked ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2 text-muted-foreground"
            aria-label={`${revealed ? "Hide" : "Show"} ${label}`}
            aria-pressed={revealed}
            onClick={() => setRevealed((current) => !current)}
            disabled={disabled}
          >
            <Icon
              name={revealed ? "EyeOff" : "Eye"}
              className="size-4"
              aria-hidden="true"
            />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function LoginFillInteraction({
  interaction,
  submit,
  cancel,
}: PluginPendingInteractionProps) {
  const parsed = loginFillPayloadSchema.safeParse(interaction.payload);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          This login request is invalid.
        </p>
        <Button
          variant="outline"
          onClick={() => void cancel().catch(() => undefined)}
        >
          Cancel
        </Button>
      </div>
    );
  }
  const payload = parsed.data;
  const submitValues = async () => {
    const validated = loginFillResponseSchema.safeParse({ values });
    if (!validated.success) {
      setFormError("Every field must be a non-empty single-line value.");
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      try {
        await submit({ values });
        setValues({});
      } catch {}
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submitValues();
      }}
    >
      {payload.label ? (
        <p className="text-pretty text-sm leading-relaxed text-foreground">
          {payload.label}
        </p>
      ) : null}
      <div className="space-y-3.5">
        {payload.fields.map((field) => (
          <MaskedField
            key={field.name}
            id={`login-fill-${interaction.id}-${field.name}`}
            label={field.name}
            masked={field.kind === "password"}
            value={values[field.name] ?? ""}
            onChange={(value) =>
              setValues((current) => ({ ...current, [field.name]: value }))
            }
            disabled={busy}
          />
        ))}
      </div>
      {formError ? (
        <p
          className="rounded-md border border-surface-destructive-border bg-surface-destructive px-2 py-1 text-xs text-destructive-text"
          aria-live="polite"
        >
          {formError}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full sm:w-auto"
          disabled={busy}
          onClick={() => void cancel().catch(() => undefined)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          className="w-full sm:w-auto"
          disabled={busy}
        >
          {busy ? (
            <Icon
              name="Spinner"
              className="size-3 animate-spin"
              aria-hidden="true"
            />
          ) : null}
          Fill form
        </Button>
      </div>
    </form>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: PREVIEW_DIRECTIVE_ID,
    component: BrowserPreviewDirective,
  });
  app.slots.experimental_appOverlay({
    id: "browser-preview-lightbox",
    component: BrowserPreviewLightbox,
  });
  app.slots.pendingInteraction({
    id: LOGIN_FILL_RENDERER_ID,
    component: LoginFillInteraction,
  });
});
