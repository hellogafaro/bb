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
  SettingsDetailRow,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { sdk } from "@/lib/sdk";

const PROBE_STATUS_CLASS: Record<
  ComputerDoctorReport["probes"][number]["status"],
  string
> = {
  ok: "text-status-ready",
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

function PermissionsDialog({
  open,
  machineName,
  onOpenChange,
  onRecheck,
}: {
  open: boolean;
  machineName: string;
  onOpenChange: (open: boolean) => void;
  onRecheck: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grant permissions</DialogTitle>
          <DialogDescription>
            {`${machineName} needs Accessibility and Screen Recording permissions enabled in System Settings for BB to observe and control it.`}
          </DialogDescription>
        </DialogHeader>
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
  const doctorQuery = useComputerDoctor(host.id, host.status === "connected");
  const report = doctorQuery.data ?? null;
  const isMacOs = platformLabel === "macOS";
  const hasUnavailableProbe =
    report?.probes.some((probe) => probe.status !== "ok") ?? false;

  const installMutation = useMutation({
    mutationFn: () => sdk.computer.installDriver({ hostId: host.id }),
    onSuccess: (nextReport) => {
      queryClient.setQueryData(computerDoctorQueryKey(host.id), nextReport);
    },
  });

  return (
    <SettingsSection
      title="Computer use"
      description="Lets BB observe and control this machine's screen."
    >
      <SettingsRowList>
        <SettingsDetailRow label="Status">
          {host.status !== "connected" ? (
            <span>Unavailable while offline</span>
          ) : doctorQuery.isLoading ? (
            <span>Checking…</span>
          ) : doctorQuery.isError ? (
            <span>Status unavailable</span>
          ) : report === null ? (
            <span>Status unavailable</span>
          ) : (
            <div className="flex flex-col items-start gap-1 sm:items-end">
              {report.probes.map((probe) => (
                <span
                  key={probe.label}
                  className="flex min-w-0 items-center gap-1.5"
                >
                  <span
                    className={cn(
                      "text-xs font-medium",
                      PROBE_STATUS_CLASS[probe.status],
                    )}
                  >
                    {probe.label}
                  </span>
                  <span className="min-w-0 truncate text-subtle-foreground">
                    {probe.message}
                  </span>
                </span>
              ))}
              {report.probes.length === 0 ? <span>No probes reported</span> : null}
            </div>
          )}
        </SettingsDetailRow>
        {installMutation.isError ? (
          <SettingsDetailRow label="Install driver">
            <span className="text-xs text-status-failed">
              {installMutation.error instanceof Error
                ? installMutation.error.message
                : "Installing the driver failed."}
            </span>
          </SettingsDetailRow>
        ) : null}
        <SettingsRow>
          <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
            {hasUnavailableProbe ? (
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
            {isMacOs && hasUnavailableProbe ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setPermissionsDialogOpen(true)}
              >
                Grant permissions
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={doctorQuery.isFetching || host.status !== "connected"}
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
        onOpenChange={setPermissionsDialogOpen}
        onRecheck={() => void doctorQuery.refetch()}
      />
    </SettingsSection>
  );
}
