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

const PROBE_DOT_CLASS: Record<Probe["status"], string> = {
  ok: "bg-status-ready",
  "setup-required": "bg-status-waiting",
  unavailable: "bg-status-failed",
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

function ProbeRow({ probe }: { probe: Probe }) {
  return (
    <SettingsRow>
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", PROBE_DOT_CLASS[probe.status])}
      />
      <span className="shrink-0 text-foreground">{probe.label}</span>
      <span
        className={cn(
          "ml-auto min-w-0 max-w-full break-words text-right text-sm",
          PROBE_TEXT_CLASS[probe.status],
        )}
      >
        {probe.message}
      </span>
    </SettingsRow>
  );
}

function PermissionsDialog({
  open,
  machineName,
  missing,
  driverBundle,
  onOpenChange,
  onRecheck,
}: {
  open: boolean;
  machineName: string;
  missing: readonly Probe[];
  driverBundle: string | null;
  onOpenChange: (open: boolean) => void;
  onRecheck: () => void;
}) {
  const names = missing.map((probe) => probe.label).join(" and ");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve on {machineName}</DialogTitle>
          <DialogDescription>
            {`macOS is asking for ${names.length > 0 ? names : "Accessibility and Screen Recording"} on ${machineName}. Approve the prompt there, or switch on "bb" in the Privacy & Security pane that just opened.`}
          </DialogDescription>
        </DialogHeader>
        {driverBundle !== null ? (
          <div className="flex flex-col gap-1 text-sm text-subtle-foreground">
            <span>If "bb" is not listed yet, add this app with the plus button:</span>
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

export function MachineComputerReadinessSection({
  host,
  platformLabel,
}: {
  host: Host;
  platformLabel: string | null;
}) {
  const queryClient = useQueryClient();
  const [permissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const isConnected = host.status === "connected";
  const doctorQuery = useComputerDoctor(host.id, isConnected);
  const report = doctorQuery.data ?? null;
  const isMacOs = platformLabel === "macOS";
  const probes = report?.probes ?? [];
  const driverProbe = probes.find((probe) => probe.id === "driver") ?? null;
  const driverMissing = driverProbe === null || driverProbe.status !== "ok";
  const missingPermissions = probes.filter(
    (probe) => isPermissionProbe(probe) && probe.status !== "ok",
  );
  const captureBlocked = probes.some(
    (probe) => (probe.id === "capture" || probe.id === "windows") && probe.status !== "ok",
  );
  const showGrant = isMacOs && !driverMissing && (missingPermissions.length > 0 || captureBlocked);

  const setReport = (nextReport: ComputerDoctorReport) => {
    queryClient.setQueryData(computerDoctorQueryKey(host.id), nextReport);
  };
  const installMutation = useMutation({
    mutationFn: () => sdk.computer.installDriver({ hostId: host.id }),
    onSuccess: setReport,
  });
  const permissionsMutation = useMutation({
    mutationFn: () => sdk.computer.requestPermissions({ hostId: host.id }),
    onSuccess: (nextReport) => {
      setReport(nextReport);
      setPermissionsDialogOpen(true);
    },
  });
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
          probes.map((probe) => <ProbeRow key={probe.id} probe={probe} />)
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
            {isConnected && showGrant ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={permissionsMutation.isPending}
                onClick={() => permissionsMutation.mutate()}
              >
                {permissionsMutation.isPending ? "Requesting…" : "Grant permissions"}
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
        open={permissionsDialogOpen}
        machineName={host.name}
        missing={missingPermissions}
        driverBundle={bundlePath(report?.driverPath ?? null)}
        onOpenChange={setPermissionsDialogOpen}
        onRecheck={() => void doctorQuery.refetch()}
      />
    </SettingsSection>
  );
}
