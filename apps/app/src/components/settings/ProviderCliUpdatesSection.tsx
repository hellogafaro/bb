import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { UPDATE_ACTION_ICON } from "@bb/domain/update-state";
import { ResourceListState } from "@bb/shared-ui/resource-list";
import {
  hasProviderCliAction,
  useProviderCliInstallRunner,
  type ProviderCliActionableIssue,
} from "@/components/provider-cli/provider-cli-install";
import { providerCliJobKey } from "@/components/provider-cli/provider-cli-install-store";
import {
  MachineUpdatesRows,
  MachineUpdatesSection,
  ProviderCliCheckRow,
  UpdateActionButton,
  visibleInstalledProviderEntries,
  visibleProviderUpdateIssues,
} from "@/components/settings/UpdatesSettingsSection";
import { SettingsSection } from "@/components/ui/settings-section";
import { invalidateHostProviderCliStatus } from "@/hooks/cache-owners/provider-cli-status-cache-owner";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import {
  getSettingsMachineRoutePath,
  getSettingsRoutePath,
} from "@/lib/route-paths";

export function ProviderCliUpdatesSection() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const inventory = useUpdateInventory();
  const { localDaemonHostId } = useHostDaemon();
  const serverPrimaryHostId = useSystemConfig().data?.primaryHostId ?? null;
  const { failuresByJobKey, queuedJobKeys, runningJobKey, startInstall } =
    useProviderCliInstallRunner();

  const hostsSettled = !inventory.isLoading;
  const connectedHostIds = inventory.machines
    .filter((machine) => machine.host.status === "connected")
    .map((machine) => machine.host.id);
  const checkedOnLoad = useRef(false);
  useEffect(() => {
    if (checkedOnLoad.current || !hostsSettled) {
      return;
    }
    checkedOnLoad.current = true;
    for (const hostId of connectedHostIds) {
      void invalidateHostProviderCliStatus({ queryClient, hostId });
    }
  }, [connectedHostIds, hostsSettled, queryClient]);

  const machines = inventory.machines.filter(
    (machine) =>
      machine.statusError ||
      visibleInstalledProviderEntries(machine).length > 0,
  );
  const checking =
    inventory.isLoading ||
    (machines.length === 0 &&
      inventory.machines.some((machine) => machine.statusPending));
  const actionableIssues = inventory.machines
    .flatMap((machine) =>
      visibleProviderUpdateIssues(machine).map((issue) => ({
        hostId: machine.host.id,
        issue,
      })),
    )
    .filter(
      (
        entry,
      ): entry is { hostId: string; issue: ProviderCliActionableIssue } =>
        hasProviderCliAction(entry.issue),
    )
    .filter(({ hostId, issue }) => {
      const jobKey = providerCliJobKey(hostId, issue.provider);
      return runningJobKey !== jobKey && !queuedJobKeys.has(jobKey);
    });

  const updateAllButton =
    actionableIssues.length > 1 ? (
      <UpdateActionButton
        label={`Update all ${actionableIssues.length} CLI tools`}
        tooltipLabel="Update all"
        icon={UPDATE_ACTION_ICON}
        visibleLabel="Update all"
        variant="default"
        onClick={() => {
          for (const { hostId, issue } of actionableIssues) {
            startInstall({ hostId, issue });
          }
        }}
      />
    ) : null;

  const openMachine = (hostId: string): void => {
    navigate(getSettingsMachineRoutePath(hostId));
  };

  return (
    <div data-provider-cli-updates>
      <SettingsSection
        title="Provider CLIs"
        description="Installed provider CLI versions and updates on each machine."
        action={updateAllButton}
        bodyClassName="border-0 bg-transparent p-0"
      >
        <div className="space-y-6 pt-1.5">
          {checking ? (
            <ResourceListState
              state="loading"
              message="Checking provider CLIs…"
              loadingRows={2}
            />
          ) : machines.length === 0 ? (
            <ResourceListState
              state="empty"
              message="No provider CLIs installed."
            />
          ) : (
            machines.map((machine) => (
              <MachineUpdatesSection
                key={machine.host.id}
                machine={machine}
                isThisMachine={
                  inventory.machines.length > 1 &&
                  machine.host.id === localDaemonHostId
                }
                showServerBadge={machine.host.id === serverPrimaryHostId}
              >
                {machine.statusError ? (
                  <ProviderCliCheckRow
                    machine={machine}
                    onRecheckClis={(hostId) => {
                      void invalidateHostProviderCliStatus({
                        queryClient,
                        hostId,
                      });
                    }}
                    onOpenMachine={openMachine}
                  />
                ) : null}
                <MachineUpdatesRows
                  machine={machine}
                  runningJobKey={runningJobKey}
                  queuedJobKeys={queuedJobKeys}
                  failuresByJobKey={failuresByJobKey}
                  onStartInstall={(hostId, issue) =>
                    startInstall({ hostId, issue })
                  }
                  onOpenProvider={() =>
                    navigate(getSettingsRoutePath("providers"))
                  }
                />
              </MachineUpdatesSection>
            ))
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
