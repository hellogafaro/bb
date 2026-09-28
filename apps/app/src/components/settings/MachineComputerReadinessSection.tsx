import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Host } from "@bb/domain";
import type { ComputerDoctorReport } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import {
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { sdk } from "@/lib/sdk";

type Probe = ComputerDoctorReport["probes"][number];
type PermissionId = "accessibility" | "screen-recording";

const PROBE_RING_CLASS: Record<Probe["status"], string> = {
  ok: "text-status-ready",
  "setup-required": "text-status-waiting",
  unavailable: "text-status-failed",
};

const PROBE_TEXT_CLASS: Record<Probe["status"], string> = {
  ok: "text-subtle-foreground",
  "setup-required": "text-status-waiting",
  unavailable: "text-status-failed",
};

function computerDoctorQueryKey(hostId: string) {
  return ["computer-doctor", hostId];
}

function useComputerDoctor(hostId: string, enabled: boolean) {
  return useQuery({
    queryKey: computerDoctorQueryKey(hostId),
    queryFn: () => sdk.computer.doctor({ hostId }),
    enabled,
    staleTime: 15_000,
  });
}

function isPermissionProbe(probe: Probe): boolean {
  return probe.id === "accessibility" || probe.id === "screen-recording";
}

function bundlePath(driverPath: string | null): string | null {
  if (driverPath === null) return null;
  const marker = "/Contents/MacOS/";
  const index = driverPath.lastIndexOf(marker);
  return index === -1 ? driverPath : driverPath.slice(0, index);
}

function ProbeRow({
  probe,
  action,
}: {
  probe: Probe;
  action: { label: string; pending: boolean; onClick: () => void } | null;
}) {
  return (
    <SettingsRow>
      <span
        aria-hidden
        className={cn(
          "flex size-3 shrink-0 items-center justify-center",
          PROBE_RING_CLASS[probe.status],
        )}
      >
        <svg viewBox="0 0 10 10" className="size-2.5" aria-hidden>
          <circle cx="5" cy="5" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </span>
      <span className="shrink-0 text-foreground">{probe.label}</span>
      <span
        className={cn(
          "ml-auto min-w-0 max-w-full break-words text-right text-sm",
          PROBE_TEXT_CLASS[probe.status],
        )}
      >
        {probe.message}
      </span>
      {action !== null ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={action.pending}
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      ) : null}
    </SettingsRow>
  );
}

const PERMISSION_TITLE: Record<PermissionId, string> = {
  accessibility: "Accessibility",
  "screen-recording": "Screen Recording",
};

function PermissionsDialog({
  permission,
  machineName,
  driverBundle,
  onOpenChange,
  onRecheck,
}: {
  permission: PermissionId | null;
  machineName: string;
  driverBundle: string | null;
  onOpenChange: (open: boolean) => void;
  onRecheck: () => void;
}) {
  const title = permission === null ? "Accessibility" : PERMISSION_TITLE[permission];
  return (
    <Dialog open={permission !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Allow ${title} on ${machineName}`}</DialogTitle>
          <DialogDescription>
            {`System Settings opened on ${machineName} at Privacy & Security → ${title}. Approve the prompt if macOS shows one, or switch on "bb Computer" in the list, then re-check.`}
          </DialogDescription>
        </DialogHeader>
        {driverBundle !== null ? (
          <div className="flex flex-col gap-1 text-sm text-subtle-foreground">
            <span>If "bb Computer" is not listed, add this app with the plus button:</span>
            <code className="break-all rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground">
              {driverBundle}
            </code>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            onClick={() => {
              onRecheck();
              onOpenChange(false);
            }}
          >
            Re-check now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MachineComputerReadinessSection({ host }: { host: Host }) {
  const queryClient = useQueryClient();
  const [dialogPermission, setDialogPermission] = useState<PermissionId | null>(null);
  const isConnected = host.status === "connected";
  const doctorQuery = useComputerDoctor(host.id, isConnected);
  const report = doctorQuery.data ?? null;
  const isMacOs = report?.platform === "darwin";
  const probes = report?.probes ?? [];
  const driverProbe = probes.find((probe) => probe.id === "driver") ?? null;
  const driverMissing = driverProbe === null || driverProbe.status !== "ok";

  const setReport = (nextReport: ComputerDoctorReport) => {
    queryClient.setQueryData(computerDoctorQueryKey(host.id), nextReport);
  };
  const installMutation = useMutation({
    mutationFn: () => sdk.computer.installDriver({ hostId: host.id }),
    onSuccess: setReport,
  });
  const permissionsMutation = useMutation({
    mutationFn: (permission: PermissionId) =>
      sdk.computer.requestPermissions({ hostId: host.id, permission }),
    onSuccess: (nextReport, permission) => {
      setReport(nextReport);
      setDialogPermission(permission);
    },
  });
  const rowAction = (probe: Probe) => {
    if (!isMacOs || driverMissing || !isPermissionProbe(probe) || probe.status === "ok") return null;
    const permission = probe.id as PermissionId;
    const pending = permissionsMutation.isPending && permissionsMutation.variables === permission;
    return {
      label: pending ? "Opening…" : "Grant",
      pending: permissionsMutation.isPending,
      onClick: () => permissionsMutation.mutate(permission),
    };
  };
  const actionError = installMutation.error ?? permissionsMutation.error;

  return (
    <SettingsSection
      title="Computer use"
      description="Lets BB observe and control this machine's screen."
    >
      <SettingsRowList>
        {!isConnected ? (
          <SettingsRow>
            <span className="text-subtle-foreground">Unavailable while the machine is offline</span>
          </SettingsRow>
        ) : doctorQuery.isLoading ? (
          <SettingsRow>
            <span className="text-subtle-foreground">Checking…</span>
          </SettingsRow>
        ) : doctorQuery.isError || report === null ? (
          <SettingsRow>
            <span className="text-status-failed">
              {doctorQuery.error instanceof Error
                ? doctorQuery.error.message
                : "Could not check this machine"}
            </span>
          </SettingsRow>
        ) : (
          probes.map((probe) => <ProbeRow key={probe.id} probe={probe} action={rowAction(probe)} />)
        )}
        {actionError ? (
          <SettingsRow>
            <span className="text-sm text-status-failed">
              {actionError instanceof Error ? actionError.message : "The request failed."}
            </span>
          </SettingsRow>
        ) : null}
        <SettingsRow>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {isConnected && report !== null && driverMissing ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={installMutation.isPending}
                onClick={() => installMutation.mutate()}
              >
                {installMutation.isPending ? "Installing…" : "Install driver"}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={doctorQuery.isFetching || !isConnected}
              onClick={() => void doctorQuery.refetch()}
            >
              {doctorQuery.isFetching ? "Checking…" : "Re-check"}
            </Button>
          </div>
        </SettingsRow>
      </SettingsRowList>

      <PermissionsDialog
        permission={dialogPermission}
        machineName={host.name}
        driverBundle={bundlePath(report?.driverPath ?? null)}
        onOpenChange={(open) => {
          if (!open) setDialogPermission(null);
        }}
        onRecheck={() => void doctorQuery.refetch()}
      />
    </SettingsSection>
  );
}
