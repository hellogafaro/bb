import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { getAgentsRoutePath } from "@bb/client-core";
import {
  AGENT_COLOR_COUNT,
  AGENT_DESCRIPTION_MAX_CHARS,
  AGENT_MASCOTS,
  AGENT_INSTRUCTIONS_MAX_CHARS,
  AGENT_NAME_MAX_CHARS,
  PERSONAL_PROJECT_ID,
  type Agent,
  type ProviderInfo,
} from "@bb/domain";
import type { AgentResponse, UpdateAgentRequest } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { cn } from "@bb/shared-ui/lib/utils";
import { Input } from "@bb/shared-ui/input";
import {
  ResourceIconFrame,
  ResourceListState,
  ResourceOverflowMenu,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Textarea } from "@bb/shared-ui/textarea";
import { CUSTOMIZE_CARD_AVATAR_CLASS_NAME } from "@/components/customize/CustomizeCards";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { McpPageShell } from "@/components/mcp/McpPageShell";
import { ModelReasoningPicker } from "@/components/pickers/ModelReasoningPicker";
import type { ProviderPickerOption } from "@/components/pickers/model-brand-prefix";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { appToast } from "@/components/ui/app-toast";
import {
  useDeleteAgent,
  useUpdateAgent,
} from "@/hooks/mutations/agent-mutations";
import { useAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useMcpServers } from "@/hooks/queries/mcp-queries";
import { useProjectSkills } from "@/hooks/queries/skills-queries";
import {
  useSystemExecutionOptions,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import {
  resolveModelCatalogSelection,
  resolveModelReasoningLevel,
} from "@/hooks/thread-creation-options/model-catalog-selection";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { customizeSkills } from "@/lib/fork-customize-skills";
import {
  AgentMascot,
  agentAvatarStyle,
  agentColorVar,
} from "./mascots/AgentMascot";

const EMPTY_PROVIDERS: readonly ProviderInfo[] = [];
export const AGENT_AUTOSAVE_DELAY_MS = 600;
const AGENT_UPDATED_TOAST = "Agent updated";

export function AgentDetailView({ agentRef }: { agentRef: string }) {
  const navigate = useNavigate();
  const { agent, isError, isPending, refetch } = useAgent(agentRef);
  useResourceRouteLabel(agent?.name ?? null);
  const backToList = useCallback(
    () => navigate(getAgentsRoutePath()),
    [navigate],
  );

  if (isError) {
    return (
      <McpPageShell>
        <ResourceListState
          state="error"
          message="Couldn't load agents."
          layout="detail"
          onRetry={() => void refetch()}
        />
      </McpPageShell>
    );
  }

  return (
    <McpPageShell>
      {isPending ? (
        <div className="space-y-3" role="status" aria-label="Loading agent">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : agent === null ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">That agent is gone.</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={backToList}
          >
            Back to agents
          </Button>
        </div>
      ) : (
        <AgentDetail agent={agent} onDeleted={backToList} />
      )}
    </McpPageShell>
  );
}

type AgentDraft = Pick<
  Agent,
  | "name"
  | "description"
  | "mascot"
  | "color"
  | "providerId"
  | "model"
  | "reasoningLevel"
  | "secondaryModel"
  | "secondaryReasoningLevel"
  | "skills"
  | "mcpServers"
  | "instructions"
>;

type UpdateDraft = (changes: Partial<AgentDraft>) => void;

const DRAFT_KEYS: readonly (keyof AgentDraft)[] = [
  "name",
  "description",
  "mascot",
  "color",
  "providerId",
  "model",
  "reasoningLevel",
  "secondaryModel",
  "secondaryReasoningLevel",
  "skills",
  "mcpServers",
  "instructions",
];

function toDraft(agent: Agent): AgentDraft {
  return {
    name: agent.name,
    description: agent.description,
    mascot: agent.mascot,
    color: agent.color,
    providerId: agent.providerId,
    model: agent.model,
    reasoningLevel: agent.reasoningLevel,
    secondaryModel: agent.secondaryModel,
    secondaryReasoningLevel: agent.secondaryReasoningLevel,
    skills: agent.skills,
    mcpServers: agent.mcpServers,
    instructions: agent.instructions,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function useAgentDraft(agent: Agent) {
  const [draft, setDraft] = useState<AgentDraft>(() => toDraft(agent));
  const baselineRef = useRef<AgentDraft>(toDraft(agent));
  useEffect(() => {
    const next = toDraft(agent);
    const previous = baselineRef.current;
    baselineRef.current = next;
    setDraft((current) => {
      let changed = false;
      const merged = { ...current };
      for (const key of DRAFT_KEYS) {
        if (
          !sameValue(previous[key], next[key]) &&
          sameValue(current[key], previous[key])
        ) {
          (merged as Record<keyof AgentDraft, unknown>)[key] = next[key];
          changed = true;
        }
      }
      return changed ? merged : current;
    });
  }, [agent]);
  const update = useCallback<UpdateDraft>(
    (changes) => setDraft((current) => ({ ...current, ...changes })),
    [],
  );
  return [draft, update] as const;
}

function draftPatch(
  agent: Agent,
  draft: AgentDraft,
): UpdateAgentRequest | null {
  const patch: UpdateAgentRequest = {};
  const name = draft.name.trim();
  if (name !== "" && name !== agent.name) patch.name = name;
  const description = draft.description.trim();
  if (description !== agent.description) patch.description = description;
  if (draft.mascot !== agent.mascot) patch.mascot = draft.mascot;
  if (draft.color !== agent.color) patch.color = draft.color;
  if (
    draft.providerId !== agent.providerId ||
    draft.model !== agent.model ||
    draft.reasoningLevel !== agent.reasoningLevel
  ) {
    patch.providerId = draft.providerId;
    patch.model = draft.model;
    patch.reasoningLevel = draft.reasoningLevel;
  }
  if (
    draft.secondaryModel !== agent.secondaryModel ||
    draft.secondaryReasoningLevel !== agent.secondaryReasoningLevel
  ) {
    patch.secondaryModel = draft.secondaryModel;
    patch.secondaryReasoningLevel = draft.secondaryReasoningLevel;
  }
  if (!sameValue(draft.skills, agent.skills)) patch.skills = [...draft.skills];
  if (!sameValue(draft.mcpServers, agent.mcpServers)) {
    patch.mcpServers = [...draft.mcpServers];
  }
  const instructions = draft.instructions.trim();
  if (instructions !== agent.instructions.trim()) {
    patch.instructions = instructions;
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

function useAutosave(
  patch: UpdateAgentRequest | null,
  onSave: (patch: UpdateAgentRequest) => void,
  delayMs = AGENT_AUTOSAVE_DELAY_MS,
) {
  const serialized = patch === null ? null : JSON.stringify(patch);
  const lastSentRef = useRef<string | null>(null);
  const onSaveRef = useRef(onSave);
  useLayoutEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);
  useEffect(() => {
    if (serialized === null || serialized === lastSentRef.current) return;
    const timeout = window.setTimeout(() => {
      lastSentRef.current = serialized;
      onSaveRef.current(JSON.parse(serialized) as UpdateAgentRequest);
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, serialized]);
}

function AgentDetail({
  agent,
  onDeleted,
}: {
  agent: AgentResponse;
  onDeleted: () => void;
}) {
  const agentsQuery = useAgents();
  const update = useUpdateAgent();
  const remove = useDeleteAgent();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const agentCount = agentsQuery.data?.length ?? 0;
  const isDefault = agentsQuery.data?.[0]?.id === agent.id;
  const [draft, updateDraft] = useAgentDraft(agent);
  const patch = useMemo(() => draftPatch(agent, draft), [agent, draft]);
  const save = useCallback(
    (next: UpdateAgentRequest) =>
      update.mutate(
        { agentId: agent.id, update: next },
        { onSuccess: () => appToast.success(AGENT_UPDATED_TOAST) },
      ),
    [agent.id, update],
  );
  useAutosave(patch, save);

  const deleteAgent = () => {
    remove.mutate(
      { agentId: agent.id },
      {
        onSuccess: () => {
          setConfirmingDelete(false);
          appToast.success("Agent deleted");
          onDeleted();
        },
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex min-w-0 items-center justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <ResourceIconFrame
            className={cn(
              CUSTOMIZE_CARD_AVATAR_CLASS_NAME,
              "size-8 rounded-md",
            )}
            style={agentAvatarStyle(draft.color)}
          >
            {() => (
              <AgentMascot
                mascot={draft.mascot}
                color={draft.color}
                className="size-4"
              />
            )}
          </ResourceIconFrame>
          <h1 className="min-w-0 truncate text-base font-semibold">
            {agent.name}
          </h1>
          {isDefault ? <ProvenancePill label="Default" /> : null}
        </div>
        <ResourceOverflowMenu
          label={`${agent.name} actions`}
          items={[
            {
              label: "Delete",
              icon: "Trash2",
              tone: "destructive",
              disabled: remove.isPending || agentCount <= 1,
              onSelect: () => setConfirmingDelete(true),
            },
          ]}
        />
      </div>
      <AgentProfileSection draft={draft} onChange={updateDraft} />
      <AgentModelSection
        agentProviderId={agent.providerId}
        draft={draft}
        onChange={updateDraft}
      />
      <AgentSkillsSection draft={draft} onChange={updateDraft} />
      <AgentMcpSection draft={draft} onChange={updateDraft} />
      <AgentInstructionsSection draft={draft} onChange={updateDraft} />
      <ConfirmDeleteDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setConfirmingDelete(false);
        }}
      >
        <ConfirmDeleteDialogContent
          title="Delete agent?"
          description={`“${agent.name}” will be deleted. Threads that ran as it switch to the default agent.`}
          confirmLabel="Delete"
          pending={remove.isPending}
          onConfirm={deleteAgent}
          onCancel={() => setConfirmingDelete(false)}
        />
      </ConfirmDeleteDialog>
    </div>
  );
}

interface AgentSectionProps {
  draft: AgentDraft;
  onChange: UpdateDraft;
}

function SectionCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-medium text-foreground">{title}</h2>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function AgentProfileSection({ draft, onChange }: AgentSectionProps) {
  return (
    <SectionCard title="Profile">
      <div className="space-y-3 rounded-lg border border-border bg-card px-4 py-3.5">
        <label className="block space-y-1.5">
          <span className="text-sm">Name</span>
          <Input
            value={draft.name}
            maxLength={AGENT_NAME_MAX_CHARS}
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm">Description</span>
          <Input
            value={draft.description}
            maxLength={AGENT_DESCRIPTION_MAX_CHARS}
            placeholder="What this agent is for"
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </label>
        <AgentIconRow draft={draft} onChange={onChange} />
        <AgentColorRow draft={draft} onChange={onChange} />
      </div>
    </SectionCard>
  );
}

const AGENT_COLOR_CHOICES = Array.from(
  { length: AGENT_COLOR_COUNT },
  (_, index) => index + 1,
);

function AgentIconRow({ draft, onChange }: AgentSectionProps) {
  return (
    <div className="space-y-1.5">
      <span className="block text-sm">Icon</span>
      <div
        role="radiogroup"
        aria-label="Icon"
        className="flex flex-wrap items-center gap-1"
      >
        {AGENT_MASCOTS.map((mascot) => {
          const selected = draft.mascot === mascot;
          return (
            <button
              key={mascot}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={mascot}
              onClick={() => onChange({ mascot })}
              className={cn(
                "flex size-7 items-center justify-center rounded-md border hover:bg-state-hover",
                selected
                  ? "border-foreground/40 bg-state-active"
                  : "border-transparent",
              )}
            >
              <AgentMascot
                mascot={mascot}
                color={draft.color}
                className="size-4"
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgentColorRow({ draft, onChange }: AgentSectionProps) {
  return (
    <div className="space-y-1.5">
      <span className="block text-sm">Color</span>
      <div
        role="radiogroup"
        aria-label="Color"
        className="flex flex-wrap items-center gap-1"
      >
        {AGENT_COLOR_CHOICES.map((color) => {
          const selected = draft.color === color;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`Color ${color}`}
              onClick={() => onChange({ color })}
              className={cn(
                "flex size-7 items-center justify-center rounded-md border hover:bg-state-hover",
                selected
                  ? "border-foreground/40 bg-state-active"
                  : "border-transparent",
              )}
            >
              <span
                aria-hidden="true"
                className="size-4 rounded-full"
                style={{ backgroundColor: agentColorVar(color) }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgentModelSection({
  agentProviderId,
  draft,
  onChange,
}: AgentSectionProps & { agentProviderId: string }) {
  const providersQuery = useSystemProviders();
  const providerId = draft.providerId;
  const model = draft.model;
  const preferredReasoningLevel = draft.reasoningLevel;
  const executionOptions = useSystemExecutionOptions({ providerId });
  const providers = providersQuery.data ?? EMPTY_PROVIDERS;
  const providerInfo = providers.find((provider) => provider.id === providerId);
  const modelLoadError = executionOptions.data?.modelLoadError ?? null;
  const catalogIsVerified =
    executionOptions.data !== undefined &&
    !executionOptions.isPlaceholderData &&
    !executionOptions.isError &&
    modelLoadError === null;
  const selection = useMemo(
    () =>
      resolveModelCatalogSelection({
        models: executionOptions.data?.models ?? [],
        selectedOnlyModels: executionOptions.data?.selectedOnlyModels ?? [],
        selectedModel: model ?? "",
        preferredReasoningLevel,
        provider: providerInfo,
        catalogIsVerified,
        formatModelLabel,
      }),
    [
      catalogIsVerified,
      executionOptions.data?.models,
      executionOptions.data?.selectedOnlyModels,
      model,
      preferredReasoningLevel,
      providerInfo,
    ],
  );
  const providerOptions = useMemo((): ProviderPickerOption[] => {
    const options: ProviderPickerOption[] = providers.map((provider) => ({
      value: provider.id,
      label: provider.displayName,
      icon: getProviderIconInfo("agent", provider.id, provider)?.icon,
      ...(provider.strings?.brandPrefix === undefined
        ? {}
        : { brandPrefix: provider.strings.brandPrefix }),
    }));
    return options.some((option) => option.value === agentProviderId)
      ? options
      : [...options, { value: agentProviderId, label: agentProviderId }];
  }, [agentProviderId, providers]);
  const modelsLoading =
    executionOptions.isLoading ||
    (executionOptions.isPlaceholderData &&
      (executionOptions.data?.models.length ?? 0) === 0);
  const findModel = (value: string) =>
    [
      ...(executionOptions.data?.models ?? []),
      ...(executionOptions.data?.selectedOnlyModels ?? []),
    ].find((entry) => entry.model === value);
  const secondaryModel = draft.secondaryModel ?? model;
  const secondaryReasoningLevel =
    draft.secondaryReasoningLevel ?? preferredReasoningLevel;
  const secondarySelection = useMemo(
    () =>
      resolveModelCatalogSelection({
        models: executionOptions.data?.models ?? [],
        selectedOnlyModels: executionOptions.data?.selectedOnlyModels ?? [],
        selectedModel: secondaryModel ?? "",
        preferredReasoningLevel: secondaryReasoningLevel,
        provider: providerInfo,
        catalogIsVerified,
        formatModelLabel,
      }),
    [
      catalogIsVerified,
      executionOptions.data?.models,
      executionOptions.data?.selectedOnlyModels,
      providerInfo,
      secondaryModel,
      secondaryReasoningLevel,
    ],
  );
  return (
    <SectionCard
      title="Model"
      description="Primary runs the conversation, planning, and supervision. Secondary runs sub-agent threads this agent spawns."
    >
      <div className="divide-y divide-border rounded-lg border border-border bg-card px-4 py-3.5">
        <div className="flex items-center justify-between gap-4 pb-3">
          <span className="shrink-0 text-sm">Primary model</span>
          <ModelReasoningPicker
            modal={false}
            align="end"
            commandShortcutsEnabled={false}
            providerOptions={providerOptions}
            selectedProviderId={providerId}
            onSelectedProviderChange={(nextProviderId) => {
              if (nextProviderId === providerId) return;
              onChange({
                providerId: nextProviderId,
                model: null,
                secondaryModel: null,
                secondaryReasoningLevel: null,
              });
            }}
            hasMultipleProviders={providerOptions.length > 1}
            modelValue={selection.selectedModel}
            modelOptions={selection.modelOptions}
            moreModelOptions={selection.moreModelOptions}
            modelIsLoading={modelsLoading}
            modelLoadFailed={
              executionOptions.isError || modelLoadError !== null
            }
            modelLoadError={modelLoadError}
            onModelChange={(nextModel) =>
              onChange({
                model: nextModel,
                reasoningLevel: resolveModelReasoningLevel(
                  findModel(nextModel),
                  preferredReasoningLevel,
                ),
              })
            }
            formatModelLabel={formatModelLabel}
            reasoningValue={selection.reasoningLevel}
            reasoningOptions={selection.reasoningOptions}
            onReasoningChange={(reasoningLevel) => onChange({ reasoningLevel })}
            fastModeEnabled={false}
            onFastModeChange={() => {}}
            showFastModeToggle={false}
          />
        </div>
        <div className="flex items-center justify-between gap-4 pt-3">
          <span className="shrink-0 text-sm">Secondary model</span>
          <ModelReasoningPicker
            modal={false}
            align="end"
            commandShortcutsEnabled={false}
            providerOptions={providerOptions}
            selectedProviderId={providerId}
            onSelectedProviderChange={() => {}}
            hasMultipleProviders={false}
            modelValue={secondarySelection.selectedModel}
            modelOptions={secondarySelection.modelOptions}
            moreModelOptions={secondarySelection.moreModelOptions}
            modelIsLoading={modelsLoading}
            modelLoadFailed={
              executionOptions.isError || modelLoadError !== null
            }
            modelLoadError={modelLoadError}
            onModelChange={(nextModel) =>
              onChange({
                secondaryModel: nextModel,
                secondaryReasoningLevel: resolveModelReasoningLevel(
                  findModel(nextModel),
                  secondaryReasoningLevel,
                ),
              })
            }
            formatModelLabel={formatModelLabel}
            reasoningValue={secondarySelection.reasoningLevel}
            reasoningOptions={secondarySelection.reasoningOptions}
            onReasoningChange={(reasoningLevel) =>
              onChange({
                secondaryModel: secondaryModel,
                secondaryReasoningLevel: reasoningLevel,
              })
            }
            fastModeEnabled={false}
            onFastModeChange={() => {}}
            showFastModeToggle={false}
          />
        </div>
      </div>
    </SectionCard>
  );
}

function toggleName(
  selected: readonly string[],
  name: string,
  checked: boolean,
): string[] {
  return checked
    ? [...new Set([...selected, name])]
    : selected.filter((entry) => entry !== name);
}

function AccessSection({
  title,
  noun,
  emptyText,
  names,
  selected,
  onChange,
}: {
  title: string;
  noun: string;
  emptyText: string;
  names: readonly { name: string; description: string | null }[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
}) {
  const known = new Set(names.map((entry) => entry.name));
  const rows = [
    ...names,
    ...selected
      .filter((name) => !known.has(name))
      .map((name) => ({ name, description: null })),
  ];
  const allSelected = selected.length === 0;
  const isChecked = (name: string) => allSelected || selected.includes(name);
  const checkedCount = allSelected
    ? rows.length
    : rows.filter((entry) => selected.includes(entry.name)).length;
  const toggle = (name: string, checked: boolean) => {
    const current = allSelected ? rows.map((entry) => entry.name) : selected;
    const next = toggleName(current, name, checked);
    onChange(rows.every((entry) => next.includes(entry.name)) ? [] : next);
  };
  return (
    <SectionCard
      title={title}
      description={
        rows.length === 0
          ? undefined
          : allSelected
            ? `This agent can use every ${noun}.`
            : `This agent can use ${checkedCount} of ${rows.length} ${noun}s.`
      }
    >
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card px-4 pb-1 pt-2">
          <div className="flex items-center justify-between gap-3 pb-1">
            <span className="text-xs text-muted-foreground">
              Customize selection
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={allSelected}
              onClick={() => onChange([])}
            >
              Select all
            </Button>
          </div>
          <ul aria-label={title} className="divide-y divide-border">
            {rows.map((entry) => {
              const checked = isChecked(entry.name);
              const lastChecked = checked && checkedCount === 1;
              return (
                <li key={entry.name} className="py-2">
                  <label className="flex cursor-pointer items-start gap-3">
                    <Checkbox
                      className="mt-0.5"
                      checked={checked}
                      disabled={lastChecked}
                      aria-label={entry.name}
                      onCheckedChange={(next) =>
                        toggle(entry.name, next === true)
                      }
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">
                        {entry.name}
                      </span>
                      {entry.description ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {entry.description}
                        </span>
                      ) : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </SectionCard>
  );
}

function AgentSkillsSection({ draft, onChange }: AgentSectionProps) {
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const skills = useMemo(
    () =>
      customizeSkills(skillsQuery.data?.skills ?? []).map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
    [skillsQuery.data],
  );
  return (
    <AccessSection
      title="Skills"
      noun="skill"
      emptyText="No skills yet."
      names={skills}
      selected={draft.skills}
      onChange={(skills) => onChange({ skills })}
    />
  );
}

function AgentMcpSection({ draft, onChange }: AgentSectionProps) {
  const serversQuery = useMcpServers();
  const servers = useMemo(
    () =>
      (serversQuery.data ?? [])
        .filter((server) => server.enabled)
        .map((server) => ({ name: server.handle, description: server.name })),
    [serversQuery.data],
  );
  return (
    <AccessSection
      title="MCPs"
      noun="MCP"
      emptyText="No enabled MCPs."
      names={servers}
      selected={draft.mcpServers}
      onChange={(mcpServers) => onChange({ mcpServers })}
    />
  );
}

function AgentInstructionsSection({ draft, onChange }: AgentSectionProps) {
  return (
    <SectionCard
      title="Instructions"
      description="Added to every thread this agent runs, after workspace instructions."
    >
      <Textarea
        value={draft.instructions}
        onChange={(event) => onChange({ instructions: event.target.value })}
        aria-label="Instructions"
        maxLength={AGENT_INSTRUCTIONS_MAX_CHARS}
        rows={6}
      />
    </SectionCard>
  );
}
