import { useMemo } from "react";
import type { Agent, ProviderInfo } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  splitModelLabelTag,
  stripModelBrandPrefix,
} from "@/components/pickers/model-brand-prefix";
import { resolveModelCatalogSelection } from "@/hooks/thread-creation-options/model-catalog-selection";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import { useSystemExecutionOptions } from "@/hooks/queries/system-queries";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { reasoningLevelLabel } from "@/lib/reasoning-labels";
import { agentModelLabel } from "./agent-display";

export function AgentModelLabel({
  agent,
  providers,
  className,
  showIcon = true,
}: {
  agent: Pick<Agent, "providerId" | "model" | "reasoningLevel">;
  providers: readonly ProviderInfo[] | undefined;
  className?: string;
  showIcon?: boolean;
}) {
  const provider = providers?.find((entry) => entry.id === agent.providerId);
  const executionOptions = useSystemExecutionOptions({
    providerId: agent.providerId,
  });
  const catalogIsVerified =
    executionOptions.data !== undefined &&
    !executionOptions.isPlaceholderData &&
    !executionOptions.isError &&
    executionOptions.data.modelLoadError === null;
  const models = executionOptions.data?.models;
  const selectedOnlyModels = executionOptions.data?.selectedOnlyModels;
  const { modelLabel, reasoningLabel } = useMemo(() => {
    const selection = resolveModelCatalogSelection({
      models: models ?? [],
      selectedOnlyModels: selectedOnlyModels ?? [],
      selectedModel: agent.model ?? "",
      preferredReasoningLevel: agent.reasoningLevel,
      provider,
      catalogIsVerified,
      formatModelLabel,
    });
    const option = [
      ...selection.modelOptions,
      ...selection.moreModelOptions,
    ].find((entry) => entry.value === selection.selectedModel);
    return {
      modelLabel: option
        ? stripModelBrandPrefix(option.label, provider?.strings?.brandPrefix)
        : agentModelLabel(agent),
      reasoningLabel: option
        ? reasoningLevelLabel(selection.reasoningLevel, provider)
        : reasoningLevelLabel(agent.reasoningLevel, provider),
    };
  }, [agent, catalogIsVerified, models, provider, selectedOnlyModels]);
  const { base, tag } = splitModelLabelTag(modelLabel);
  const ProviderIcon = getProviderIconInfo(
    "agent",
    agent.providerId,
    provider,
  ).icon;
  return (
    <span
      data-agent-model-label=""
      className={cn("flex min-w-0 items-center gap-1.5", className)}
    >
      {showIcon ? <ProviderIcon className="size-3.5 shrink-0" /> : null}
      <span className="min-w-0 truncate">{base}</span>
      {tag ? (
        <span className="shrink-0 text-subtle-foreground">{tag}</span>
      ) : null}
      <span className="shrink-0 text-subtle-foreground">{reasoningLabel}</span>
    </span>
  );
}
