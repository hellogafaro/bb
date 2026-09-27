import { useEffect, useId, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@bb/shared-ui/dialog";
import {
  definePluginApp,
  useRpc,
  type PluginMessageDirectiveProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contracts.js";
import { closeLightbox, openLightbox, useLightboxTarget } from "./lightbox-store.js";
import { PREVIEW_DIRECTIVE_ID } from "./preview-directive.js";

const PANEL_ACTION_ID = "computer";

function useLiveFrame(hostId: string | null, active: boolean, size: "thumbnail" | "full" = "thumbnail") {
  const rpc = useRpc<typeof rpcContract>();
  const viewerId = useId();
  const [frame, setFrame] = useState<{ src: string; state: string; capturedAt: number | null; displayedAt: number } | null>(null);
  const sequence = useRef<number | null>(null);
  const pollIntervalMs = size === "full" ? 80 : 160;
  useEffect(() => {
    if (hostId === null || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      rpc
        .call("preview", { hostId, viewerId, size, afterSequence: sequence.current })
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
  }, [hostId, active, rpc, viewerId, size, pollIntervalMs]);
  return frame;
}

function useActiveRun(hostId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [runId, setRunId] = useState<string | null>(null);
  useEffect(() => {
    let stopped = false;
    const poll = () => {
      rpc
        .call("activeRun", { hostId })
        .then((result) => {
          if (!stopped) setRunId(result.runId);
        })
        .catch(() => {})
        .finally(() => {
          if (!stopped) timer = setTimeout(poll, 1500);
        });
    };
    let timer: ReturnType<typeof setTimeout>;
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [hostId, rpc]);
  return runId;
}

function useControlStatus(hostId: string, clientId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [owner, setOwner] = useState<"you" | "other" | "agent">("agent");
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () => {
      rpc
        .call("controlStatus", { hostId, clientId })
        .then((result) => {
          if (!stopped) setOwner(result.owner);
        })
        .catch(() => {})
        .finally(() => {
          if (!stopped) timer = setTimeout(poll, 1200);
        });
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [hostId, clientId, rpc]);
  return [owner, setOwner] as const;
}

function ControlBanner({ hostId }: { hostId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const clientId = useId();
  const [owner, setOwner] = useControlStatus(hostId, clientId);
  const activeRunId = useActiveRun(hostId);
  const takeControl = () => {
    rpc
      .call("takeControl", { hostId, clientId })
      .then((result) => setOwner(result.owner === "human" ? "you" : "other"))
      .catch(() => {});
  };
  const release = () => {
    rpc.call("releaseControl", { hostId, clientId }).then(() => setOwner("agent")).catch(() => {});
  };
  const stop = () => {
    if (activeRunId !== null) rpc.call("cancel", { runId: activeRunId }).catch(() => {});
  };
  const label =
    owner === "you"
      ? "Controlled by you"
      : owner === "other"
        ? "Controlled by another session"
        : activeRunId !== null
          ? "Controlled by the agent — a run is active"
          : "Controlled by the agent when a run is active";
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex gap-2">
        {activeRunId !== null ? (
          <button
            type="button"
            onClick={stop}
            className="rounded border border-destructive px-2 py-1 text-destructive hover:bg-destructive/10"
          >
            Stop
          </button>
        ) : null}
        {owner === "you" ? (
          <button
            type="button"
            onClick={release}
            className="rounded border border-border px-2 py-1 hover:bg-background"
          >
            Release
          </button>
        ) : (
          <button
            type="button"
            onClick={takeControl}
            disabled={owner === "other"}
            className="rounded border border-border px-2 py-1 hover:bg-background disabled:opacity-50"
          >
            Take control
          </button>
        )}
      </div>
    </div>
  );
}

function LiveView({ hostId, active, size = "thumbnail" }: { hostId: string; active: boolean; size?: "thumbnail" | "full" }) {
  const frame = useLiveFrame(hostId, active, size);
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

function ComputerPanel({ params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const parsedHostId = typeof params === "object" && params !== null && "hostId" in params && typeof (params as Record<string, unknown>).hostId === "string"
    ? ((params as Record<string, unknown>).hostId as string)
    : null;
  const [hostId, setHostId] = useState<string | null>(parsedHostId);
  const [machines, setMachines] = useState<{ hostId: string; name: string }[]>([]);
  useEffect(() => {
    rpc.call("machines", {}).then((result) => setMachines(result.machines)).catch(() => {});
  }, [rpc]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <label htmlFor="computer-machine">Machine</label>
        <select
          id="computer-machine"
          value={hostId ?? ""}
          onChange={(event) => setHostId(event.target.value === "" ? null : event.target.value)}
          className="rounded border border-border bg-background px-2 py-1"
        >
          <option value="">Select a machine…</option>
          {machines.map((machine) => (
            <option key={machine.hostId} value={machine.hostId}>
              {machine.name}
            </option>
          ))}
        </select>
      </div>
      {hostId === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a machine to observe or control it.
        </div>
      ) : (
        <>
          <ControlBanner hostId={hostId} />
          <LiveView hostId={hostId} active={true} size="full" />
        </>
      )}
    </div>
  );
}

function ComputerPreviewDirective({ attributes }: PluginMessageDirectiveProps) {
  const hostId = attributes.host ?? null;
  return (
    <div className="my-1 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <span>Computer — {hostId ?? "unknown machine"}</span>
        <button
          type="button"
          onClick={() => hostId !== null && openLightbox(hostId)}
          disabled={hostId === null}
          className="rounded border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
        >
          Expand
        </button>
      </div>
      {hostId !== null ? (
        <div className="h-64">
          <LiveView hostId={hostId} active={true} />
        </div>
      ) : null}
    </div>
  );
}

function ComputerPreviewLightbox() {
  const hostId = useLightboxTarget();
  return (
    <Dialog
      open={hostId !== null}
      onOpenChange={(open) => {
        if (!open) closeLightbox();
      }}
    >
      <DialogContent className="max-w-6xl gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="truncate pr-8 text-sm">Computer — {hostId ?? ""}</DialogTitle>
        </DialogHeader>
        {hostId !== null ? (
          <div className="h-[70dvh]">
            <LiveView hostId={hostId} active={hostId !== null} size="full" />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: PREVIEW_DIRECTIVE_ID,
    component: ComputerPreviewDirective,
  });
  app.slots.experimental_appOverlay({
    id: "computer-preview-lightbox",
    component: ComputerPreviewLightbox,
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: "Computer",
    icon: "Monitor",
    component: ComputerPanel,
    layout: "flush",
    run: ({ openPanel }) => {
      openPanel({ title: "Computer", params: null });
    },
  });
});
