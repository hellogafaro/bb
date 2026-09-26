import { Link } from "react-router-dom";
import type { ProviderCliKey } from "@bb/host-daemon-contract";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { useProviderCliInstallRunner } from "@/components/provider-cli/provider-cli-install";
import { providerCliJobKey } from "@/components/provider-cli/provider-cli-install-store";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { getSettingsRoutePath } from "@/lib/route-paths";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "./sidebarRowClasses";

interface SidebarUpdatesBadgeProps {
  onNavigate?: () => void;
}

const PROVIDER_ACTION_CLASS = cn(
  SIDEBAR_FOOTER_ACTION_CLASS,
  "w-auto gap-1 px-1.5 max-md:pointer-coarse:w-auto max-md:pointer-coarse:px-2",
);

function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

interface StaleProvider {
  provider: ProviderCliKey;
  displayName: string;
}

export function SidebarUpdatesBadge({ onNavigate }: SidebarUpdatesBadgeProps) {
  const inventory = useUpdateInventory();
  const providers = useSystemProviders().data;
  const { runningJobKey } = useProviderCliInstallRunner();

  const stuckDaemonCount = inventory.machines.filter(
    (machine) => machine.canRetryDaemonUpdate,
  ).length;
  const bbUpdateCount =
    (inventory.appUpdateAvailable ? 1 : 0) +
    (inventory.desktopUpdateReady ? 1 : 0) +
    stuckDaemonCount;

  const staleProvidersByKey = new Map<ProviderCliKey, StaleProvider>();
  for (const machine of inventory.machines) {
    for (const issue of machine.issues) {
      if (!issue.status.installed) {
        continue;
      }
      if (!staleProvidersByKey.has(issue.provider)) {
        staleProvidersByKey.set(issue.provider, {
          provider: issue.provider,
          displayName: issue.status.displayName,
        });
      }
    }
  }
  const staleProviders = [...staleProvidersByKey.values()];
  const providerUpdateRunning = inventory.machines.some((machine) =>
    machine.issues.some(
      (issue) =>
        issue.status.installed &&
        runningJobKey === providerCliJobKey(machine.host.id, issue.provider),
    ),
  );

  if (bbUpdateCount === 0 && staleProviders.length === 0) {
    return null;
  }

  const updatesRoutePath = getSettingsRoutePath("updates");
  const bbLabel =
    bbUpdateCount === 1 ? "bb update available" : "bb updates available";
  const providerLabel = `${joinNames(
    staleProviders.map((stale) => stale.displayName),
  )} ${staleProviders.length === 1 ? "update" : "updates"} available`;

  return (
    <>
      {bbUpdateCount > 0 ? (
        <SidebarMenuItem className="min-w-0">
          <SidebarMenuButton
            asChild
            aria-label={bbLabel}
            tooltip={{ children: bbLabel, hidden: false, side: "top" }}
            className={SIDEBAR_FOOTER_ACTION_CLASS}
          >
            <Link
              to={updatesRoutePath}
              onClick={onNavigate}
              data-testid="sidebar-updates-badge-bb"
            >
              <Icon name="Download" />
              <span className="sr-only">{bbLabel}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
      {staleProviders.length > 0 ? (
        <SidebarMenuItem className="min-w-0">
          <SidebarMenuButton
            asChild
            aria-label={providerLabel}
            tooltip={{ children: providerLabel, hidden: false, side: "top" }}
            className={PROVIDER_ACTION_CLASS}
          >
            <Link
              to={updatesRoutePath}
              onClick={onNavigate}
              data-testid="sidebar-updates-badge-providers"
            >
              <Icon
                name={providerUpdateRunning ? "Loading" : "Download"}
                className={cn(providerUpdateRunning && "animate-spin")}
              />
              <span className="flex items-center gap-1">
                {staleProviders.map((stale) => {
                  const providerId = stale.provider;
                  const provider = providers?.find(
                    (candidate) => candidate.id === providerId,
                  );
                  const iconInfo = getProviderIconInfo(
                    "agent",
                    providerId,
                    provider ?? null,
                  );
                  if (iconInfo === undefined) {
                    return null;
                  }
                  return (
                    <span
                      key={stale.provider}
                      data-provider-icon={providerId}
                      aria-hidden
                      className="flex size-4 shrink-0 items-center justify-center opacity-80 max-md:pointer-coarse:size-5"
                    >
                      {provider === undefined ? (
                        <iconInfo.icon className="size-4 max-md:pointer-coarse:size-5" />
                      ) : (
                        <ProviderIconMark
                          provider={provider}
                          icon={iconInfo.icon}
                          className="size-4 max-md:pointer-coarse:size-5"
                        />
                      )}
                    </span>
                  );
                })}
              </span>
              <span className="sr-only">{providerLabel}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
    </>
  );
}
