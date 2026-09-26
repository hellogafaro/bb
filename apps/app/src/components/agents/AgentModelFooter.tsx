import type { ReactNode } from "react";
import type { Agent, ProviderInfo } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { providerDisplayName } from "./agent-display";
import { AgentModelLabel } from "./AgentModelLabel";

export const HOVER_CARD_CONTENT_CLASS_NAME = "w-72 p-0";
export const HOVER_CARD_BODY_CLASS_NAME =
  "flex flex-col gap-2 px-3.5 py-3 text-xs leading-4";

export function AgentModelFooter({
  agent,
  providerId,
  providers,
  divider = true,
  children,
}: {
  agent: Pick<Agent, "providerId" | "model" | "reasoningLevel"> | null;
  providerId: string;
  providers: readonly ProviderInfo[] | undefined;
  divider?: boolean;
  children?: ReactNode;
}) {
  const provider = providers?.find((entry) => entry.id === providerId);
  const ProviderIcon = getProviderIconInfo("agent", providerId, provider).icon;
  return (
    <div
      data-agent-model-footer=""
      className={cn(
        "flex flex-col gap-1.5 text-muted-foreground",
        divider && "border-t border-border pt-2.5",
      )}
    >
      {agent === null ? (
        <span className="flex min-h-4 min-w-0 items-center gap-1.5">
          <ProviderIcon className="size-3.5 shrink-0" />
          <span className="min-w-0 truncate">
            {providerDisplayName(providers, providerId)}
          </span>
        </span>
      ) : (
        <AgentModelLabel
          agent={agent}
          providers={providers}
          className="min-h-4"
        />
      )}
      {children}
    </div>
  );
}
