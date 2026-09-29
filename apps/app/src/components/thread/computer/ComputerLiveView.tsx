import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ComputerHumanInput,
  ComputerKeyModifier,
  ComputerLiveFrameHeader,
  ComputerLiveProfile,
  ComputerPointerButton,
} from "@bb/host-daemon-contract";
import type { ComputerControlOwner } from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import { VideoFrameDecoder, videoDecodeSupported } from "./computer-video-decoder";

type ComputerLiveConnection = ReturnType<typeof sdk.computer.live>;
export type ComputerLiveViewState = "connecting" | "starting" | "live" | "stopped" | "error";

export interface ComputerLiveHandle {
  readonly connected: boolean;
  readonly state: ComputerLiveViewState;
  readonly message: string | null;
  readonly control: ComputerControlOwner;
  readonly runId: string | null;
  readonly fps: number;
  readonly frameUrl: string | null;
  readonly frameHeader: ComputerLiveFrameHeader | null;
  readonly isVideo: boolean;
  attachVideoCanvas(canvas: HTMLCanvasElement | null): void;
  send(input: ComputerHumanInput): void;
  perform(input: ComputerHumanInput): Promise<void>;
  readClipboard(): Promise<string | null>;
  writeClipboard(text: string, paste: boolean): Promise<void>;
}

const RECONNECT_DELAY_MS = 1_500;

export function useComputerLive(
  hostId: string | null,
  options: { active: boolean; profile: ComputerLiveProfile; clientId: string },
): ComputerLiveHandle {
  const { active, profile, clientId } = options;
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<ComputerLiveViewState>("connecting");
  const [message, setMessage] = useState<string | null>(null);
  const [control, setControl] = useState<ComputerControlOwner>("agent");
  const [runId, setRunId] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [frameHeader, setFrameHeader] = useState<ComputerLiveFrameHeader | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  const connectionRef = useRef<ComputerLiveConnection | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const videoDecoderRef = useRef<VideoFrameDecoder | null>(null);

  const attachVideoCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasElRef.current = canvas;
    videoDecoderRef.current?.attachCanvas(canvas);
  }, []);

  useEffect(() => {
    if (hostId === null || !active) return;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let currentFrameUrl: string | null = null;
    const decoder = new VideoFrameDecoder();
    decoder.attachCanvas(canvasElRef.current);
    videoDecoderRef.current = decoder;

    const connectOnce = () => {
      if (stopped) return;
      setState("connecting");
      const connection = sdk.computer.live({ hostId, clientId, profile });
      connectionRef.current = connection;
      connection.onFrame((frame) => {
        if (stopped) return;
        const header = frame.header;
        if (header.kind === "video-config") {
          setIsVideo(videoDecodeSupported() && decoder.configure(new Uint8Array(frame.body)));
          setFrameHeader(header);
          return;
        }
        if (header.kind === "video-frame") {
          if (!decoder.isConfigured) return;
          decoder.decode(new Uint8Array(frame.body), header.keyframe, header.ptsMicros);
          setFrameHeader(header);
          return;
        }
        setIsVideo(false);
        const blob = new Blob([new Uint8Array(frame.body)], { type: header.mimeType });
        const url = URL.createObjectURL(blob);
        const previous = currentFrameUrl;
        currentFrameUrl = url;
        setFrameUrl(url);
        setFrameHeader(header);
        if (previous !== null) URL.revokeObjectURL(previous);
      });
      connection.onStatus((status) => {
        if (stopped) return;
        setState(status.state);
        setMessage(status.message);
        setControl(status.control);
        setRunId(status.runId);
        setFps(status.fps);
        setConnected(true);
      });
      connection.onClose(() => {
        if (stopped) return;
        setConnected(false);
        connectionRef.current = null;
        retryTimer = setTimeout(connectOnce, RECONNECT_DELAY_MS);
      });
    };
    connectOnce();

    return () => {
      stopped = true;
      if (retryTimer !== null) clearTimeout(retryTimer);
      connectionRef.current?.close();
      connectionRef.current = null;
      decoder.close();
      if (videoDecoderRef.current === decoder) videoDecoderRef.current = null;
      if (currentFrameUrl !== null) URL.revokeObjectURL(currentFrameUrl);
      setConnected(false);
      setState("connecting");
      setFrameUrl(null);
      setFrameHeader(null);
      setIsVideo(false);
    };
  }, [hostId, active, profile, clientId]);

  return {
    connected,
    state,
    message,
    control,
    runId,
    fps,
    frameUrl,
    frameHeader,
    isVideo,
    attachVideoCanvas,
    send: (input) => connectionRef.current?.input(input),
    perform: (input) => connectionRef.current?.perform(input) ?? Promise.resolve(),
    readClipboard: () => connectionRef.current?.readClipboard() ?? Promise.resolve(null),
    writeClipboard: (text, paste) =>
      connectionRef.current?.writeClipboard(text, { paste }) ?? Promise.resolve(),
  };
}

const SPECIAL_KEYS: Readonly<Record<string, string>> = {
  Enter: "enter",
  Backspace: "backspace",
  Delete: "delete",
  Tab: "tab",
  Escape: "escape",
  " ": "space",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
};

function keyModifiers(event: {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): ComputerKeyModifier[] {
  const modifiers: ComputerKeyModifier[] = [];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.shiftKey) modifiers.push("shift");
  if (event.altKey) modifiers.push("alt");
  if (event.metaKey) modifiers.push("meta");
  return modifiers;
}

function resolveKeyName(key: string): string | null {
  const special = SPECIAL_KEYS[key];
  if (special !== undefined) return special;
  if (/^F\d{1,2}$/u.test(key)) return key.toLowerCase();
  return null;
}

function pointerButtonFor(button: number): ComputerPointerButton | null {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return null;
}

interface FramePoint {
  readonly x: number;
  readonly y: number;
}

function pointInFrame(
  clientX: number,
  clientY: number,
  container: HTMLElement,
  header: ComputerLiveFrameHeader,
): FramePoint {
  const rect = container.getBoundingClientRect();
  const containerAspect = rect.width / rect.height;
  const frameAspect = header.width / header.height;
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
  const fracX = clamp((clientX - rect.left - offsetX) / displayWidth, 0, 1);
  const fracY = clamp((clientY - rect.top - offsetY) / displayHeight, 0, 1);
  return { x: fracX * header.width, y: fracY * header.height };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const MOVE_THROTTLE_MS = 33;
const WHEEL_THROTTLE_MS = 40;
const DRAG_THRESHOLD_PX = 4;
const DOUBLE_CLICK_WINDOW_MS = 400;
const DOUBLE_CLICK_DISTANCE_PX = 6;

function clipboardModifier(isMac: boolean): ComputerKeyModifier {
  return isMac ? "meta" : "ctrl";
}

export function ComputerLiveStage({
  live,
  interactive = false,
  isMac = false,
}: {
  live: ComputerLiveHandle;
  interactive?: boolean;
  isMac?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const keyCaptureRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    button: ComputerPointerButton;
    start: FramePoint;
    startAt: number;
  } | null>(null);
  const lastMoveAtRef = useRef(0);
  const lastWheelAtRef = useRef(0);
  const lastClickRef = useRef<{ at: number; point: FramePoint; button: ComputerPointerButton } | null>(null);

  const canControl = interactive && live.control === "you" && live.frameHeader !== null;

  const frameOf = useCallback((header: ComputerLiveFrameHeader) => ({ width: header.width, height: header.height }), []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canControl || live.frameHeader === null || containerRef.current === null) return;
      const button = pointerButtonFor(event.button);
      if (button === null) return;
      event.preventDefault();
      containerRef.current.setPointerCapture(event.pointerId);
      keyCaptureRef.current?.focus({ preventScroll: true });
      dragRef.current = {
        pointerId: event.pointerId,
        button,
        start: pointInFrame(event.clientX, event.clientY, containerRef.current, live.frameHeader),
        startAt: performance.now(),
      };
    },
    [canControl, live.frameHeader],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!canControl || live.frameHeader === null || containerRef.current === null) return;
      if (dragRef.current !== null) return;
      const now = performance.now();
      if (now - lastMoveAtRef.current < MOVE_THROTTLE_MS) return;
      lastMoveAtRef.current = now;
      const point = pointInFrame(event.clientX, event.clientY, containerRef.current, live.frameHeader);
      live.send({ kind: "move", frame: frameOf(live.frameHeader), x: point.x, y: point.y });
    },
    [canControl, live, frameOf],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!canControl || drag === null || drag.pointerId !== event.pointerId) return;
      if (live.frameHeader === null || containerRef.current === null) return;
      const point = pointInFrame(event.clientX, event.clientY, containerRef.current, live.frameHeader);
      const frame = frameOf(live.frameHeader);
      const distance = Math.hypot(point.x - drag.start.x, point.y - drag.start.y);
      if (distance > DRAG_THRESHOLD_PX) {
        void live.perform({
          kind: "drag",
          frame,
          fromX: drag.start.x,
          fromY: drag.start.y,
          toX: point.x,
          toY: point.y,
          button: drag.button,
          durationMs: clamp(Math.round(performance.now() - drag.startAt), 0, 10_000),
        });
        lastClickRef.current = null;
        return;
      }
      const now = performance.now();
      const last = lastClickRef.current;
      const isDouble =
        last !== null &&
        last.button === drag.button &&
        now - last.at < DOUBLE_CLICK_WINDOW_MS &&
        Math.hypot(point.x - last.point.x, point.y - last.point.y) < DOUBLE_CLICK_DISTANCE_PX;
      const count = isDouble ? 2 : 1;
      lastClickRef.current = { at: now, point, button: drag.button };
      void live.perform({
        kind: "click",
        frame,
        x: point.x,
        y: point.y,
        button: drag.button,
        count,
        modifiers: keyModifiers(event),
      });
    },
    [canControl, live, frameOf],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (canControl) event.preventDefault();
    },
    [canControl],
  );

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (!canControl || live.frameHeader === null || containerRef.current === null) return;
      event.preventDefault();
      const now = performance.now();
      if (now - lastWheelAtRef.current < WHEEL_THROTTLE_MS) return;
      lastWheelAtRef.current = now;
      const point = pointInFrame(event.clientX, event.clientY, containerRef.current, live.frameHeader);
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      const magnitude = horizontal ? Math.abs(event.deltaX) : Math.abs(event.deltaY);
      const amount = clamp(Math.round(magnitude / 20), 1, 50);
      const direction = horizontal
        ? event.deltaX > 0
          ? "right"
          : "left"
        : event.deltaY > 0
          ? "down"
          : "up";
      live.send({ kind: "scroll", frame: frameOf(live.frameHeader), x: point.x, y: point.y, direction, amount });
    },
    [canControl, live, frameOf],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!canControl) return;
      const isClipboardShortcut =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        (event.key === "c" || event.key === "x" || event.key === "v");
      if (isClipboardShortcut) return;
      const special = resolveKeyName(event.key);
      const modifiers = keyModifiers(event);
      const isShortcut = event.ctrlKey || event.metaKey || event.altKey;
      if (special === null && !isShortcut) return;
      event.preventDefault();
      void live.perform({ kind: "key", key: special ?? event.key.toLowerCase(), modifiers });
    },
    [canControl, live],
  );

  const handleInput = useCallback(
    (event: React.FormEvent<HTMLTextAreaElement>) => {
      const target = event.currentTarget;
      const text = target.value;
      target.value = "";
      if (!canControl || text.length === 0) return;
      void live.perform({ kind: "type", text });
    },
    [canControl, live],
  );

  const handlePaste = useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!canControl) return;
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain");
      if (text.length === 0) return;
      void live.writeClipboard(text, true);
    },
    [canControl, live],
  );

  const handleCopyOrCut = useCallback(
    (key: "c" | "x", event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      if (!canControl) return;
      event.preventDefault();
      const textBlob = live
        .perform({ kind: "key", key, modifiers: [clipboardModifier(isMac)] })
        .then(() => live.readClipboard())
        .then((text) => new Blob([text ?? ""], { type: "text/plain" }));
      if (typeof ClipboardItem !== "undefined") {
        void navigator.clipboard
          .write([new ClipboardItem({ "text/plain": textBlob })])
          .catch(async () => {
            const text = await (await textBlob).text();
            await navigator.clipboard.writeText(text).catch(() => {});
          });
      } else {
        void textBlob
          .then((blob) => blob.text())
          .then((text) => navigator.clipboard.writeText(text))
          .catch(() => {});
      }
    },
    [canControl, live, isMac],
  );

  return (
    <div
      ref={containerRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/90"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={handleContextMenu}
      onWheel={handleWheel}
    >
      <canvas
        ref={live.attachVideoCanvas}
        className="max-h-full max-w-full object-contain"
        style={{ display: live.isVideo ? "block" : "none" }}
      />
      {live.isVideo ? null : live.frameUrl === null ? (
        <p className="text-xs text-muted-foreground">
          {live.state === "error" ? (live.message ?? "The live view failed") : "Waiting for a frame…"}
        </p>
      ) : (
        <img
          src={live.frameUrl}
          alt="Live machine view"
          draggable={false}
          className="max-h-full max-w-full object-contain"
        />
      )}
      {interactive ? (
        <textarea
          ref={keyCaptureRef}
          aria-label="Computer keyboard input"
          className="absolute inset-0 h-full w-full cursor-default resize-none opacity-0"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          disabled={!canControl}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          onCopy={(event) => handleCopyOrCut("c", event)}
          onCut={(event) => handleCopyOrCut("x", event)}
        />
      ) : null}
    </div>
  );
}

export function ComputerLiveView({
  hostId,
  active,
  profile = "thumbnail",
  clientId,
  interactive = false,
  isMac = false,
}: {
  hostId: string;
  active: boolean;
  profile?: ComputerLiveProfile;
  clientId: string;
  interactive?: boolean;
  isMac?: boolean;
}) {
  const live = useComputerLive(hostId, { active, profile, clientId });
  return <ComputerLiveStage live={live} interactive={interactive} isMac={isMac} />;
}
