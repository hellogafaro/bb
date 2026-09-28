import { useEffect, useId, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@bb/shared-ui/dialog";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  definePluginApp,
  useRpc,
  type PluginMessageDirectiveProps,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { DoctorReport, MachineSummary, rpcContract } from "./contracts.js";
import { closeLightbox, openLightbox, useLightboxTarget } from "./lightbox-store.js";
import { PREVIEW_DIRECTIVE_ID } from "./preview-directive.js";

function formatLastSeen(lastSeenAt: number | null): string {
  if (lastSeenAt === null) return "never seen";
  const diffMs = Date.now() - lastSeenAt;
  if (diffMs < 60_000) return "last seen just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `last seen ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `last seen ${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `last seen ${days}d ago`;
}

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

function useMachines(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<{ machines: MachineSummary[]; currentHostId: string | null }>({
    machines: [],
    currentHostId: null,
  });
  useEffect(() => {
    let stopped = false;
    rpc
      .call("machines", { threadId })
      .then((result) => {
        if (!stopped) setState(result);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [rpc, threadId]);
  return state;
}

function useDoctorReport(hostId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [report, setReport] = useState<DoctorReport | null>(null);
  useEffect(() => {
    let stopped = false;
    setReport(null);
    rpc
      .call("doctor", { hostId })
      .then((result) => {
        if (!stopped) setReport(result);
      })
      .catch((error) => {
        if (stopped) return;
        setReport({
          hostId,
          state: "unavailable",
          version: null,
          probes: [
            {
              label: "Doctor",
              status: "unavailable",
              message: error instanceof Error ? error.message : String(error),
            },
          ],
        });
      });
    return () => {
      stopped = true;
    };
  }, [hostId, rpc]);
  return report;
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

function ControlBanner({ hostId, activeRunId }: { hostId: string; activeRunId: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const clientId = useId();
  const [owner, setOwner] = useControlStatus(hostId, clientId);
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

function CenteredSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Icon name="Loading" className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
    </div>
  );
}

function MachineStatusDot({ status }: { status: MachineSummary["status"] }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-3 shrink-0 items-center justify-center",
        status === "connected" ? "text-status-ready" : "text-muted-foreground/50",
      )}
    >
      <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
        <circle cx="5" cy="5" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </span>
  );
}

function MachineCard({
  machine,
  onSelect,
}: {
  machine: MachineSummary;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="grid h-[var(--bb-sidebar-thread-row-height)] grid-rows-[20px_16px] content-center gap-y-0.5 rounded-lg border border-border bg-card px-2 py-1.5 text-left hover:bg-muted/40"
    >
      <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
        <MachineStatusDot status={machine.status} />
        <span className="min-w-0 truncate">{machine.name}</span>
      </span>
      <span className="flex min-w-0 items-center text-meta text-subtle-foreground">
        {formatLastSeen(machine.lastSeenAt)}
      </span>
    </button>
  );
}

function MachinePickerCards({
  machines,
  currentHostId,
  onSelect,
}: {
  machines: MachineSummary[];
  currentHostId: string | null;
  onSelect: (hostId: string) => void;
}) {
  const ordered = [...machines].sort(
    (left, right) => Number(right.hostId === currentHostId) - Number(left.hostId === currentHostId),
  );
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-4">
      <div className="flex w-full max-w-[360px] flex-col gap-3">
        <h2 className="text-center text-sm font-medium text-foreground">Choose a machine</h2>
        <div className="flex flex-col gap-2">
          {ordered.map((machine) => (
            <MachineCard
              key={machine.hostId}
              machine={machine}
              onSelect={() => onSelect(machine.hostId)}
            />
          ))}
          {ordered.length === 0 ? <p className="text-center text-xs text-muted-foreground">No machines yet</p> : null}
        </div>
      </div>
    </div>
  );
}

const PROBE_STATUS_CLASS: Record<DoctorReport["probes"][number]["status"], string> = {
  ok: "text-status-ready",
  "setup-required": "text-status-waiting",
  unavailable: "text-status-failed",
};

function DoctorFailure({ machineName, report }: { machineName: string; report: DoctorReport }) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-auto p-4">
      <div className="w-full max-w-[360px] rounded-lg border border-border bg-card px-2 py-1.5">
        <p className="truncate text-sm font-medium text-foreground">{machineName}</p>
        <ul className="mt-2 flex flex-col gap-2">
          {report.probes.map((probe) => (
            <li key={probe.label} className="flex flex-col gap-0.5">
              <span className={cn("text-sm font-medium", PROBE_STATUS_CLASS[probe.status])}>{probe.label}</span>
              <span className="text-meta text-subtle-foreground">{probe.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function MachineWorkspace({
  hostId,
  machineName,
}: {
  hostId: string;
  machineName: string;
}) {
  const report = useDoctorReport(hostId);
  const activeRunId = useActiveRun(hostId);
  const frame = useLiveFrame(hostId, report !== null && report.state === "ready", "full");

  if (report === null) return <CenteredSpinner />;
  if (report.state !== "ready") {
    return <DoctorFailure machineName={machineName} report={report} />;
  }
  if (frame === null) return <CenteredSpinner />;
  return (
    <>
      <ControlBanner hostId={hostId} activeRunId={activeRunId} />
      <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90">
        <img src={frame.src} alt="Live machine view" className="max-h-full max-w-full object-contain" />
      </div>
    </>
  );
}

function ComputerPanel({ threadId, params }: PluginThreadPanelProps) {
  const parsedHostId = typeof params === "object" && params !== null && "hostId" in params && typeof (params as Record<string, unknown>).hostId === "string"
    ? ((params as Record<string, unknown>).hostId as string)
    : null;
  const [hostId, setHostId] = useState<string | null>(parsedHostId);
  const { machines, currentHostId } = useMachines(threadId);
  const selectedMachine = machines.find((machine) => machine.hostId === hostId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {hostId === null ? (
        <MachinePickerCards machines={machines} currentHostId={currentHostId} onSelect={setHostId} />
      ) : (
        <MachineWorkspace hostId={hostId} machineName={selectedMachine?.name ?? hostId} />
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
    icon: "Laptop",
    component: ComputerPanel,
    layout: "flush",
    run: ({ openPanel }) => {
      openPanel({ title: "Computer", params: null });
    },
  });
});
