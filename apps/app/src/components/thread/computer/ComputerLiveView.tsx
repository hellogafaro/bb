import { useEffect, useId, useRef, useState } from "react";
import { sdk } from "@/lib/sdk";

export function useComputerLiveFrame(
  hostId: string | null,
  active: boolean,
  size: "thumbnail" | "full" = "thumbnail",
) {
  const viewerId = useId();
  const [frame, setFrame] = useState<{
    src: string;
    state: string;
    capturedAt: number | null;
    displayedAt: number;
  } | null>(null);
  const sequence = useRef<number | null>(null);
  const pollIntervalMs = size === "full" ? 80 : 160;
  useEffect(() => {
    if (hostId === null || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      sdk.computer
        .preview({ hostId, viewerId, size, afterSequence: sequence.current })
        .then((result) => {
          if (stopped) return;
          if (result.dataBase64 !== null && result.mimeType !== null) {
            sequence.current = result.sequence;
            setFrame({
              src: `data:${result.mimeType};base64,${result.dataBase64}`,
              state: result.state,
              capturedAt: result.capturedAt,
              displayedAt: Date.now(),
            });
          } else if (result.state !== "none") {
            setFrame((prev) => (prev === null ? null : { ...prev, state: result.state }));
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!stopped) timer = setTimeout(poll, pollIntervalMs);
        });
    };
    poll();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [hostId, active, viewerId, size, pollIntervalMs]);
  return frame;
}

export function ComputerLiveView({
  hostId,
  active,
  size = "thumbnail",
}: {
  hostId: string;
  active: boolean;
  size?: "thumbnail" | "full";
}) {
  const frame = useComputerLiveFrame(hostId, active, size);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90">
      {frame === null ? (
        <p className="text-xs text-muted-foreground">Waiting for a frame…</p>
      ) : (
        <img src={frame.src} alt="Live machine view" className="max-h-full max-w-full object-contain" />
      )}
    </div>
  );
}
