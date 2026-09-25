import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { getAgentsRoutePath } from "@bb/client-core";
import {
  AGENT_DESCRIPTION_MAX_CHARS,
  AGENT_INSTRUCTIONS_MAX_CHARS,
  AGENT_NAME_MAX_CHARS,
  PERSONAL_PROJECT_ID,
  reasoningLevelValues,
  type Agent,
  type ReasoningLevel,
} from "@bb/domain";
import type { UpdateAgentRequest } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Checkbox } from "@bb/shared-ui/checkbox";
import { Icon } from "@bb/shared-ui/icon";
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
import { McpPageShell } from "@/components/mcp/McpPageShell";
import { OptionPicker } from "@/components/pickers/OptionPicker";
import { appToast } from "@/components/ui/app-toast";
import { useDeleteAgent, useUpdateAgent } from "@/hooks/mutations/agent-mutations";
import { useAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useMcpServers } from "@/hooks/queries/mcp-queries";
import { useProjectSkills } from "@/hooks/queries/skills-queries";
import {
  useSystemExecutionOptions,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import { formatModelLabel } from "@/hooks/useThreadCreationOptions";
import { customizeSkills } from "@/lib/fork-customize-skills";
import { agentExecutionLabel } from "./agent-display";

const DEFAULT_MODEL_VALUE = "__default__";

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
          <Button type="button" variant="outline" size="sm" onClick={backToList}>
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
  agent: Agent;
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
            <Icon
              name="Bot"
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
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
          <p className="text-xs text-subtle-foreground">
            {agentExecutionLabel(agent, providersQuery.data)} · full
            permissions
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
      <AgentModelSection agent={agent} pending={update.isPending} onSave={save} />
      <AgentSkillsSection agent={agent} pending={update.isPending} onSave={save} />
      <AgentMcpSection agent={agent} pending={update.isPending} onSave={save} />
      <AgentInstructionsSection
        key={agent.instructions}
        agent={agent}
        pending={update.isPending}
        onSave={save}
      />
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
      </div>
    </SectionCard>
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

function AgentModelSection({ agent, pending, onSave }: AgentSectionProps) {
  const providersQuery = useSystemProviders();
  const executionOptions = useSystemExecutionOptions({
    providerId: agent.providerId,
  });
  const models = executionOptions.data?.models ?? [];
  const selectedModel =
    agent.model === null
      ? null
      : models.find((model) => model.model === agent.model);
  const reasoningLevels: readonly ReasoningLevel[] =
    selectedModel && selectedModel.supportedReasoningEfforts.length > 0
      ? selectedModel.supportedReasoningEfforts.map(
          (effort) => effort.reasoningEffort,
        )
      : reasoningLevelValues;
  const providerOptions = (providersQuery.data ?? []).map((provider) => ({
    value: provider.id,
    label: provider.displayName,
  }));
  if (!providerOptions.some((option) => option.value === agent.providerId)) {
    providerOptions.push({ value: agent.providerId, label: agent.providerId });
  }
  const modelOptions = [
    { value: DEFAULT_MODEL_VALUE, label: "Default model" },
    ...models.map((model) => ({
      value: model.model,
      label: model.displayName || formatModelLabel(model.model),
    })),
    ...(agent.model !== null && selectedModel === undefined
      ? [{ value: agent.model, label: formatModelLabel(agent.model) }]
      : []),
  ];
  return (
    <SectionCard title="Model">
      <div className="divide-y divide-border rounded-lg border border-border bg-card px-4 py-3.5">
        <SettingRow label="Provider">
          <OptionPicker
            modal={false}
            label="Provider"
            align="end"
            disabled={pending}
            showChevronWhenDisabled
            value={agent.providerId}
            options={providerOptions}
            onChange={(providerId) => {
              if (providerId !== agent.providerId) onSave({ providerId });
            }}
          />
        </SettingRow>
        <SettingRow label="Model">
          <OptionPicker
            modal={false}
            label="Model"
            align="end"
            disabled={pending}
            showChevronWhenDisabled
            value={agent.model ?? DEFAULT_MODEL_VALUE}
            options={modelOptions}
            onChange={(value) =>
              onSave({ model: value === DEFAULT_MODEL_VALUE ? null : value })
            }
          />
        </SettingRow>
        <SettingRow label="Reasoning">
          <OptionPicker
            modal={false}
            label="Reasoning"
            align="end"
            disabled={pending}
            showChevronWhenDisabled
            value={agent.reasoningLevel}
            options={reasoningLevels.map((level) => ({
              value: level,
              label: level,
            }))}
            onChange={(reasoningLevel) => onSave({ reasoningLevel })}
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
