import { useCallback, useMemo, useState, type ReactNode } from "react";
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
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Input } from "@bb/shared-ui/input";
import {
  ResourceListState,
  ResourceOverflowMenu,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Textarea } from "@bb/shared-ui/textarea";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import {
  FilesBrowser,
  type FilesBrowserStatus,
} from "@/components/files/FilesPanel";
import { LazyFileEditor } from "@/components/files/LazyFileEditor";
import { joinRoot } from "@/components/files/file-paths";
import type { DirectoryLocation } from "@/components/files/files-transport";
import { McpPageShell } from "@/components/mcp/McpPageShell";
import { ModelReasoningPicker } from "@/components/pickers/ModelReasoningPicker";
import type { ProviderPickerOption } from "@/components/pickers/model-brand-prefix";
import { appToast } from "@/components/ui/app-toast";
import {
  useDeleteAgent,
  useUpdateAgent,
} from "@/hooks/mutations/agent-mutations";
import { useAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useMcpServers } from "@/hooks/queries/mcp-queries";
import { useProjectSkills } from "@/hooks/queries/skills-queries";
import {
  useSystemConfig,
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
import { agentExecutionLabel } from "./agent-display";
import { AgentMascot, agentColorVar } from "./mascots/AgentMascot";
import { ProviderMark } from "./ProviderMark";

const EMPTY_PROVIDERS: readonly ProviderInfo[] = [];

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

function AgentDetail({
  agent,
  onDeleted,
}: {
  agent: AgentResponse;
  onDeleted: () => void;
}) {
  const agentsQuery = useAgents();
  const providersQuery = useSystemProviders();
  const update = useUpdateAgent();
  const remove = useDeleteAgent();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const agentCount = agentsQuery.data?.length ?? 0;
  const isDefault = agentsQuery.data?.[0]?.id === agent.id;
  const save = useCallback(
    (patch: UpdateAgentRequest, message?: string) =>
      update.mutate(
        { agentId: agent.id, update: patch },
        {
          onSuccess: () => {
            if (message) appToast.success(message);
          },
        },
      ),
    [agent.id, update],
  );

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
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <AgentMascot
              mascot={agent.mascot}
              color={agent.color}
              className="size-5"
            />
            <h1 className="min-w-0 truncate text-base font-semibold">
              {agent.name}
            </h1>
            {isDefault ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                Default
              </span>
            ) : null}
          </div>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-subtle-foreground">
            <ProviderMark providerId={agent.providerId} className="size-3.5" />
            <span className="min-w-0 truncate">
              {agentExecutionLabel(agent, providersQuery.data)} · full
              permissions
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
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
      </div>
      <AgentProfileSection
        key={`${agent.name}\0${agent.description}`}
        agent={agent}
        pending={update.isPending}
        onSave={save}
      />
      <AgentModelSection
        agent={agent}
        pendingUpdate={update.isPending ? update.variables?.update : undefined}
        onSave={save}
      />
      <AgentSkillsSection
        agent={agent}
        pending={update.isPending}
        onSave={save}
      />
      <AgentMcpSection agent={agent} pending={update.isPending} onSave={save} />
      <AgentInstructionsSection
        key={agent.instructions}
        agent={agent}
        pending={update.isPending}
        onSave={save}
      />
      <AgentFilesSection homePath={agent.homePath} />
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
  agent: Agent;
  pending: boolean;
  onSave: (patch: UpdateAgentRequest, message?: string) => void;
}

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function AgentProfileSection({ agent, pending, onSave }: AgentSectionProps) {
  const [name, setName] = useState(agent.name);
  const [description, setDescription] = useState(agent.description);
  const trimmedName = name.trim();
  const dirty =
    trimmedName !== agent.name || description.trim() !== agent.description;
  return (
    <SectionCard
      title="Profile"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || !dirty || trimmedName === ""}
          onClick={() =>
            onSave(
              {
                ...(trimmedName !== agent.name ? { name: trimmedName } : {}),
                ...(description.trim() !== agent.description
                  ? { description: description.trim() }
                  : {}),
              },
              "Agent saved",
            )
          }
        >
          Save
        </Button>
      }
    >
      <div className="space-y-3 rounded-lg border border-border bg-card px-4 py-3.5">
        <label className="block space-y-1.5">
          <span className="text-sm">Name</span>
          <Input
            value={name}
            maxLength={AGENT_NAME_MAX_CHARS}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm">Description</span>
          <Input
            value={description}
            maxLength={AGENT_DESCRIPTION_MAX_CHARS}
            placeholder="What this agent is for"
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <AgentAppearanceRow agent={agent} pending={pending} onSave={onSave} />
      </div>
    </SectionCard>
  );
}

const AGENT_COLOR_CHOICES = Array.from(
  { length: AGENT_COLOR_COUNT },
  (_, index) => index + 1,
);

function AgentAppearanceRow({ agent, pending, onSave }: AgentSectionProps) {
  return (
    <div className="space-y-1.5" role="group" aria-label="Appearance">
      <span className="block text-sm">Appearance</span>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div
          role="radiogroup"
          aria-label="Mascot"
          className="grid grid-cols-10 gap-1"
        >
          {AGENT_MASCOTS.map((mascot) => {
            const selected = agent.mascot === mascot;
            return (
              <button
                key={mascot}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={mascot}
                title={mascot}
                disabled={pending}
                onClick={() => {
                  if (!selected) onSave({ mascot }, "Agent saved");
                }}
                className={cn(
                  "flex size-7 items-center justify-center rounded-md border hover:bg-state-hover disabled:cursor-default",
                  selected
                    ? "border-foreground/40 bg-state-active"
                    : "border-transparent",
                )}
              >
                <AgentMascot
                  mascot={mascot}
                  color={agent.color}
                  className="size-4"
                />
              </button>
            );
          })}
        </div>
        <div
          role="radiogroup"
          aria-label="Color"
          className="flex items-center gap-1"
        >
          {AGENT_COLOR_CHOICES.map((color) => {
            const selected = agent.color === color;
            return (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={`Color ${color}`}
                disabled={pending}
                onClick={() => {
                  if (!selected) onSave({ color }, "Agent saved");
                }}
                className={cn(
                  "flex size-6 items-center justify-center rounded-full border disabled:cursor-default",
                  selected ? "border-foreground/40" : "border-transparent",
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
    </div>
  );
}

function SettingRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0">
      <span className="shrink-0 text-sm">{label}</span>
      {children}
    </div>
  );
}

function AgentModelSection({
  agent,
  pendingUpdate,
  onSave,
}: Omit<AgentSectionProps, "pending"> & {
  pendingUpdate: UpdateAgentRequest | undefined;
}) {
  const providersQuery = useSystemProviders();
  const providerId = pendingUpdate?.providerId ?? agent.providerId;
  const model =
    pendingUpdate?.model !== undefined ? pendingUpdate.model : agent.model;
  const preferredReasoningLevel =
    pendingUpdate?.reasoningLevel ?? agent.reasoningLevel;
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
    return options.some((option) => option.value === agent.providerId)
      ? options
      : [...options, { value: agent.providerId, label: agent.providerId }];
  }, [agent.providerId, providers]);
  const modelsLoading =
    executionOptions.isLoading ||
    (executionOptions.isPlaceholderData &&
      (executionOptions.data?.models.length ?? 0) === 0);
  const findModel = (value: string) =>
    [
      ...(executionOptions.data?.models ?? []),
      ...(executionOptions.data?.selectedOnlyModels ?? []),
    ].find((entry) => entry.model === value);
  return (
    <SectionCard title="Model">
      <div className="divide-y divide-border rounded-lg border border-border bg-card px-4 py-3.5">
        <SettingRow label="Model">
          <ModelReasoningPicker
            modal={false}
            align="end"
            commandShortcutsEnabled={false}
            providerOptions={providerOptions}
            selectedProviderId={providerId}
            onSelectedProviderChange={(nextProviderId) => {
              if (nextProviderId === providerId) return;
              onSave({
                providerId: nextProviderId,
                model: null,
                reasoningLevel: preferredReasoningLevel,
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
              onSave({
                providerId,
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
            onReasoningChange={(reasoningLevel) =>
              onSave({ providerId, model, reasoningLevel })
            }
            fastModeEnabled={false}
            onFastModeChange={() => {}}
            showFastModeToggle={false}
          />
        </SettingRow>
        <SettingRow label="Permissions">
          <span className="text-sm text-muted-foreground">Full</span>
        </SettingRow>
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

function NameChecklist({
  label,
  names,
  selected,
  pending,
  emptyText,
  onChange,
}: {
  label: string;
  names: readonly { name: string; description: string | null }[];
  selected: readonly string[];
  pending: boolean;
  emptyText: string;
  onChange: (next: string[]) => void;
}) {
  const known = new Set(names.map((entry) => entry.name));
  const rows = [
    ...names,
    ...selected
      .filter((name) => !known.has(name))
      .map((name) => ({ name, description: null })),
  ];
  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
        {emptyText}
      </p>
    );
  }
  return (
    <ul
      aria-label={label}
      className="divide-y divide-border rounded-lg border border-border bg-card px-4 py-2"
    >
      {rows.map((entry) => (
        <li key={entry.name} className="py-2">
          <label className="flex cursor-pointer items-start gap-3">
            <Checkbox
              className="mt-0.5"
              checked={selected.includes(entry.name)}
              disabled={pending}
              aria-label={entry.name}
              onCheckedChange={(checked) =>
                onChange(toggleName(selected, entry.name, checked === true))
              }
            />
            <span className="min-w-0">
              <span className="block truncate text-sm">{entry.name}</span>
              {entry.description ? (
                <span className="block truncate text-xs text-muted-foreground">
                  {entry.description}
                </span>
              ) : null}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function AgentSkillsSection({ agent, pending, onSave }: AgentSectionProps) {
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
    <SectionCard title="Skills">
      <p className="text-xs text-muted-foreground">
        {agent.skills.length === 0
          ? "None checked: the agent can use every skill."
          : "The agent can use only the checked skills. Uncheck all to allow every skill."}
      </p>
      <NameChecklist
        label="Skills"
        names={skills}
        selected={agent.skills}
        pending={pending}
        emptyText="No BB skills yet."
        onChange={(next) => onSave({ skills: next })}
      />
    </SectionCard>
  );
}

function AgentMcpSection({ agent, pending, onSave }: AgentSectionProps) {
  const serversQuery = useMcpServers();
  const servers = useMemo(
    () =>
      (serversQuery.data ?? [])
        .filter((server) => server.enabled)
        .map((server) => ({ name: server.handle, description: server.name })),
    [serversQuery.data],
  );
  return (
    <SectionCard title="MCPs">
      <p className="text-xs text-muted-foreground">
        {agent.mcpServers.length === 0
          ? "None checked: the agent sees every enabled MCP."
          : "The agent sees only the checked MCPs. Uncheck all to allow every enabled MCP."}
      </p>
      <NameChecklist
        label="MCPs"
        names={servers}
        selected={agent.mcpServers}
        pending={pending}
        emptyText="No enabled MCPs."
        onChange={(next) => onSave({ mcpServers: next })}
      />
    </SectionCard>
  );
}

function AgentInstructionsSection({
  agent,
  pending,
  onSave,
}: AgentSectionProps) {
  const [draft, setDraft] = useState(agent.instructions);
  return (
    <SectionCard
      title="Instructions"
      action={
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending || draft.trim() === agent.instructions.trim()}
          onClick={() =>
            onSave({ instructions: draft.trim() }, "Instructions saved")
          }
        >
          Save
        </Button>
      }
    >
      <Textarea
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Added to every thread this agent runs, after workspace instructions."
        aria-label="Instructions"
        maxLength={AGENT_INSTRUCTIONS_MAX_CHARS}
        rows={6}
      />
    </SectionCard>
  );
}

const AGENT_HOME_UNAVAILABLE =
  "This agent's home lives on the server's machine, which isn't connected.";

function AgentFilesSection({ homePath }: { homePath: string }) {
  const systemConfig = useSystemConfig();
  const hostId = systemConfig.data?.primaryHostId ?? null;
  const [openPath, setOpenPath] = useState<string | null>(null);
  const directory = useMemo<DirectoryLocation | null>(
    () => (hostId === null ? null : { hostId, rootPath: homePath }),
    [homePath, hostId],
  );
  let status: FilesBrowserStatus | null = null;
  if (systemConfig.data === undefined && systemConfig.error !== null) {
    status = { message: systemConfig.error.message, destructive: true };
  } else if (systemConfig.data !== undefined && hostId === null) {
    status = { message: AGENT_HOME_UNAVAILABLE, destructive: false };
  }
  const openFile = openPath === null ? null : joinRoot(homePath, openPath);

  return (
    <SectionCard
      title="Files"
      action={
        openPath === null ? undefined : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpenPath(null)}
          >
            <Icon name="X" aria-hidden />
            Close file
          </Button>
        )
      }
    >
      <p className="truncate font-mono text-xs text-subtle-foreground">
        {homePath}
      </p>
      <div
        data-agent-files=""
        className="grid h-96 min-h-0 grid-cols-1 overflow-hidden rounded-lg border border-border md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]"
      >
        <FilesBrowser
          className={cn("px-2 pt-2", openFile !== null && "max-md:hidden")}
          directory={directory}
          status={status}
          isActive
          onOpenFile={setOpenPath}
        />
        <div
          className={cn(
            "min-h-0 flex-col md:flex md:border-l md:border-border",
            openFile === null
              ? "hidden md:items-center md:justify-center"
              : "flex",
          )}
        >
          {openFile !== null && openPath !== null && hostId !== null ? (
            <LazyFileEditor
              key={openFile}
              source={{ kind: "host", hostId, path: openFile }}
              displayPath={openPath}
              copyPath={openFile}
              lineRange={null}
              isPanelOpen
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a file to open it.
            </p>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
