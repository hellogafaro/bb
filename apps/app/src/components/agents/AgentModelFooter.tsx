import type { ReactNode } from "react";
import type { Agent, ProviderInfo } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { reasoningLevelLabel } from "@/lib/reasoning-labels";
import { agentModelLabel, providerDisplayName } from "./agent-display";
import { ProviderMark } from "./ProviderMark";

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
  const providerName = providerDisplayName(providers, providerId);
  return (
    <div
      data-agent-model-footer=""
      className={cn(
        "flex flex-col gap-1.5 text-muted-foreground",
        divider && "border-t border-border pt-2.5",
      )}
    >
      <span className="flex min-h-4 min-w-0 items-center gap-1.5">
        <ProviderMark
          providerId={providerId}
          className="size-3.5 text-subtle-foreground"
        />
        {agent === null ? (
          <span className="min-w-0 truncate">{providerName}</span>
        ) : (
          <>
            <span className="min-w-0 truncate">{agentModelLabel(agent)}</span>
            <span className="shrink-0 text-subtle-foreground">
              {reasoningLevelLabel(agent.reasoningLevel, provider)}
            </span>
          </>
        )}
      </span>
      {children}
    </div>
  );
}
