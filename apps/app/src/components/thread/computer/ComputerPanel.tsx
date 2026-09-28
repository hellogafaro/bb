import { useEffect, useId, useState } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import type {
  ComputerControlOwner,
  ComputerDoctorReport,
  ComputerMachineSummary,
} from "@bb/server-contract";
import { sdk } from "@/lib/sdk";
import {
  isDocumentVisible,
  useDocumentVisibilityRevision,
} from "@/lib/document-visibility";
import { ComputerLiveStage, useComputerLive } from "./ComputerLiveView";

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

function useMachines(threadId: string) {
  const [state, setState] = useState<{
    machines: ComputerMachineSummary[];
    currentHostId: string | null;
  }>({
    machines: [],
    currentHostId: null,
  });
  useEffect(() => {
    let stopped = false;
    sdk.computer
      .machines({ threadId })
      .then((result) => {
        if (!stopped) setState(result);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [threadId]);
  return state;
}

function useDoctorReport(hostId: string) {
  const [report, setReport] = useState<ComputerDoctorReport | null>(null);
  useEffect(() => {
    let stopped = false;
    setReport(null);
    sdk.computer
      .doctor({ hostId })
      .then((result) => {
        if (!stopped) setReport(result);
      })
      .catch((error) => {
        if (stopped) return;
        setReport({
          hostId,
          state: "unavailable",
          platform: "unknown",
          version: null,
          driverPath: null,
          probes: [
            {
              id: "doctor",
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
  }, [hostId]);
  return report;
}

function ControlBanner({
  hostId,
  clientId,
  control,
  runId,
  readClipboard,
  writeClipboard,
}: {
  hostId: string;
  clientId: string;
  control: ComputerControlOwner;
  runId: string | null;
  readClipboard: () => Promise<string | null>;
  writeClipboard: (text: string, paste: boolean) => Promise<void>;
}) {
  const [clipboardError, setClipboardError] = useState<string | null>(null);
  const takeControl = () => {
    sdk.computer.takeControl({ hostId, clientId }).catch(() => {});
  };
  const release = () => {
    sdk.computer.releaseControl({ hostId, clientId }).catch(() => {});
  };
  const stop = () => {
    if (runId !== null) sdk.computer.cancel({ runId }).catch(() => {});
  };
  const copyFromMachine = async () => {
    setClipboardError(null);
    try {
      const text = await readClipboard();
      if (text !== null) await navigator.clipboard.writeText(text);
    } catch (error) {
      setClipboardError(error instanceof Error ? error.message : String(error));
    }
  };
  const pasteToMachine = async () => {
    setClipboardError(null);
    try {
      const text = await navigator.clipboard.readText();
      await writeClipboard(text, true);
    } catch (error) {
      setClipboardError(error instanceof Error ? error.message : String(error));
    }
  };
  const label =
    control === "you"
      ? "Controlled by you"
      : control === "other"
        ? "Controlled by another session"
        : runId !== null
          ? "Controlled by the agent — a run is active"
          : "Controlled by the agent when a run is active";
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs">
      <span className="truncate text-muted-foreground">{clipboardError ?? label}</span>
      <div className="flex shrink-0 gap-2">
        {control === "you" ? (
          <>
            <button
              type="button"
              onClick={copyFromMachine}
              className="rounded border border-border px-2 py-1 hover:bg-background"
            >
              Copy from machine
            </button>
            <button
              type="button"
              onClick={pasteToMachine}
              className="rounded border border-border px-2 py-1 hover:bg-background"
            >
              Paste to machine
            </button>
          </>
        ) : null}
        {runId !== null ? (
          <button
            type="button"
            onClick={stop}
            className="rounded border border-destructive px-2 py-1 text-destructive hover:bg-destructive/10"
          >
            Stop
          </button>
        ) : null}
        {control === "you" ? (
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
            disabled={control === "other"}
            className="rounded border border-border px-2 py-1 hover:bg-background disabled:opacity-50"
          >
            Take control
          </button>
        )}
      </div>
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

function MachineStatusDot({ status }: { status: ComputerMachineSummary["status"] }) {
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
  machine: ComputerMachineSummary;
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
  machines: ComputerMachineSummary[];
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

const PROBE_STATUS_CLASS: Record<ComputerDoctorReport["probes"][number]["status"], string> = {
  ok: "text-status-ready",
  "setup-required": "text-status-waiting",
  unavailable: "text-status-failed",
};

function DoctorFailure({
  machineName,
  report,
}: {
  machineName: string;
  report: ComputerDoctorReport;
}) {
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

function useLiveActive(isActive: boolean): boolean {
  useDocumentVisibilityRevision();
  return isActive && isDocumentVisible();
}

function MachineWorkspace({
  hostId,
  machineName,
  isActive,
}: {
  hostId: string;
  machineName: string;
  isActive: boolean;
}) {
  const clientId = useId();
  const report = useDoctorReport(hostId);
  const liveActive = useLiveActive(isActive) && report !== null && report.state === "ready";
  const live = useComputerLive(hostId, { active: liveActive, profile: "full", clientId });

  if (report === null) return <CenteredSpinner />;
  if (report.state !== "ready") {
    return <DoctorFailure machineName={machineName} report={report} />;
  }
  return (
    <>
      <ControlBanner
        hostId={hostId}
        clientId={clientId}
        control={live.control}
        runId={live.runId}
        readClipboard={live.readClipboard}
        writeClipboard={live.writeClipboard}
      />
      <ComputerLiveStage live={live} interactive />
    </>
  );
}

export function ComputerPanel({
  threadId,
  isActive,
}: {
  threadId: string;
  isActive: boolean;
}) {
  const [hostId, setHostId] = useState<string | null>(null);
  const { machines, currentHostId } = useMachines(threadId);
  const selectedMachine = machines.find((machine) => machine.hostId === hostId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {hostId === null ? (
        <MachinePickerCards machines={machines} currentHostId={currentHostId} onSelect={setHostId} />
      ) : (
        <MachineWorkspace
          hostId={hostId}
          machineName={selectedMachine?.name ?? hostId}
          isActive={isActive}
        />
      )}
    </div>
  );
}
