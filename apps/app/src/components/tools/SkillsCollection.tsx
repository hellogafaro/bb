import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { SkillProvider, SkillSummary } from "@bb/server-contract";
import {
  ResourceInfiniteScrollSentinel,
  useResourceInfiniteItems,
  useResourceViewportPageSize,
} from "@bb/shared-ui/resource-pagination";
import {
  ResourceCollectionPage,
  ResourceCollectionViewport,
  ResourceCreateButton,
  ResourceListPanel,
  ResourceListState,
  ResourceOverflowMenu,
  ResourceRow,
  ResourceRowDetailChevron,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { BbLogo } from "@/components/ui/bb-logo";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { ProvenancePill } from "@/components/tools/ProvenancePill";
import { SkillDetailView } from "@/components/tools/SkillDetailView";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { skillScopeLabel } from "@/components/tools/skill-taxonomy";
import type { ProviderInfo } from "@bb/domain";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import { getProviderIconInfo } from "@/lib/provider-icon";
import type { MarkdownLinkRouting } from "@/components/ui/markdown-link-routing";

export type ProviderRoster = ReadonlyMap<string, ProviderInfo>;

function providerLabel(
  provider: SkillProvider | null,
  providerRoster: ProviderRoster,
): string {
  if (provider === null) return "bb";
  return providerRoster.get(provider)?.displayName ?? provider;
}

export function ProviderLogo({
  providerId,
  provider,
  className,
}: {
  providerId: SkillProvider;
  provider?: ProviderInfo | undefined;
  className?: string;
}) {
  const info = getProviderIconInfo("agent", providerId, provider ?? null);
  if (!info) {
    return null;
  }
  if (provider === undefined) {
    const LogoIcon = info.icon;
    return <LogoIcon className={className} />;
  }
  return (
    <ProviderIconMark
      provider={provider}
      icon={info.icon}
      className={className}
    />
  );
}

export function SkillProvenanceTooltip({
  prefix,
  providerId,
  provider,
  name,
}: {
  prefix: string;
  providerId: SkillProvider | null;
  provider?: ProviderInfo | undefined;
  name: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span>{prefix}</span>
      <span
        data-provider-icon={providerId ?? "bb"}
        aria-hidden="true"
        className="flex size-3.5 shrink-0 items-center justify-center"
      >
        {providerId === null ? (
          <BbLogo className="size-3.5 brightness-0 invert" />
        ) : (
          <ProviderLogo
            providerId={providerId}
            provider={provider}
            className="size-3.5"
          />
        )}
      </span>
      <span>{name}</span>
    </span>
  );
}

function SkillLeading({
  skill,
  providerRoster,
}: {
  skill: SkillSummary;
  providerRoster: ProviderRoster;
}) {
  if (skill.provider !== null) {
    return (
      <ProviderLogo
        providerId={skill.provider}
        provider={providerRoster.get(skill.provider)}
        className="size-6"
      />
    );
  }
  return <BbLogo className="size-6" />;
}

function skillDescription(
  skill: SkillSummary,
  providerRoster: ProviderRoster,
): string {
  return (
    skill.description ??
    skillScopeLabel(skill, providerLabelForScope(skill, providerRoster))
  );
}

function providerLabelForScope(
  skill: SkillSummary,
  providerRoster: ProviderRoster,
): string | undefined {
  return skill.provider === null
    ? undefined
    : providerRoster.get(skill.provider)?.displayName;
}

function providerPluginNameForSkill(skill: SkillSummary): string {
  if (skill.pluginId !== null) return skill.pluginId;
  const separatorIndex = skill.name.indexOf(":");
  return separatorIndex > 0 ? skill.name.slice(0, separatorIndex) : skill.name;
}

function providerPluginDisplayName(skill: SkillSummary): string {
  const name = providerPluginNameForSkill(skill).replace(/[-_]+/gu, " ");
  return name.length === 0 ? name : name[0].toUpperCase() + name.slice(1);
}

function includedPluginDescription(
  skill: SkillSummary,
  providerRoster: ProviderRoster,
): string {
  return `${providerPluginDisplayName(skill)} (${providerLabel(skill.provider, providerRoster)} plugin)`;
}

function skillMutationDisabledReason(
  skill: SkillSummary,
  providerRoster: ProviderRoster,
): string {
  if (skill.scope === "bb-builtin") return "Built-in skill";
  if (skill.scope === "plugin") return "Bundled with plugin";
  return `Bundled with ${providerLabel(skill.provider, providerRoster)}`;
}

const SKILLS_BROWSE_DESCRIPTION = (
  <>
    Trending agent skills from{" "}
    <a
      href="https://skills.sh"
      target="_blank"
      rel="noreferrer"
      className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      skills.sh
    </a>
    . Install one and every agent you use in bb can run it.
  </>
);
const SKILLS_LIBRARY_DESCRIPTION =
  "The skills on this bb host — yours, your providers', and those bundled with plugins. They work with every agent you use in bb.";

const PREFETCH_HOVER_INTENT_MS = 150;

function SkillRow({
  skill,
  providerRoster,
  onSelect,
  onPrefetch,
}: {
  skill: SkillSummary;
  providerRoster: ProviderRoster;
  onSelect: () => void;
  onPrefetch?: (skill: SkillSummary) => void;
}) {
  const description = skillDescription(skill, providerRoster);
  const prefetchTimer = useRef<number | null>(null);
  const cancelScheduledPrefetch = () => {
    if (prefetchTimer.current === null) return;
    window.clearTimeout(prefetchTimer.current);
    prefetchTimer.current = null;
  };
  const schedulePrefetch = () => {
    if (prefetchTimer.current !== null) return;
    prefetchTimer.current = window.setTimeout(() => {
      prefetchTimer.current = null;
      onPrefetch?.(skill);
    }, PREFETCH_HOVER_INTENT_MS);
  };
  useEffect(() => cancelScheduledPrefetch, []);
  return (
    <div
      onPointerEnter={schedulePrefetch}
      onPointerLeave={cancelScheduledPrefetch}
      onFocus={schedulePrefetch}
      onBlur={cancelScheduledPrefetch}
    >
      <ResourceRow
        leading={<SkillLeading skill={skill} providerRoster={providerRoster} />}
        title={skill.name}
        titleMeta={
          skill.scope === "bb-builtin" ? (
            <ProvenancePill label="BB Official" />
          ) : skill.scope === "plugin" ? (
            <ProvenancePill
              label="Included"
              tooltip={
                <SkillProvenanceTooltip
                  prefix="Included with"
                  providerId={skill.provider}
                  provider={
                    skill.provider === null
                      ? undefined
                      : providerRoster.get(skill.provider)
                  }
                  name={`${providerPluginDisplayName(skill)} plugin.`}
                />
              }
              accessibleLabel={`${skill.name} is included with ${includedPluginDescription(skill, providerRoster)}`}
            />
          ) : undefined
        }
        description={description}
        onOpen={onSelect}
        trailingVisual={<ResourceRowDetailChevron />}
      />
    </div>
  );
}

interface SkillsLibraryResultsProps {
  skills: readonly SkillSummary[];
  providerRoster: ProviderRoster;
  isLoading: boolean;
  hasError: boolean;
  query: string;
  action?: ReactNode;
  onSelectSkill: (skill: SkillSummary) => void;
  onPrefetchSkill?: (skill: SkillSummary) => void;
  onQueryChange: (query: string) => void;
  onRetry?: () => void;
}

export function SkillsLibraryResults({
  skills,
  providerRoster,
  isLoading,
  hasError,
  query,
  action,
  onSelectSkill,
  onPrefetchSkill,
  onQueryChange,
  onRetry,
}: SkillsLibraryResultsProps) {
  const [libraryViewport, setLibraryViewport] = useState<HTMLDivElement | null>(
    null,
  );
  const normalizedQuery = query.trim().toLowerCase();
  const libraryPageSize = useResourceViewportPageSize(libraryViewport, {
    resetKey: normalizedQuery,
  });
  const visibleSkills = useMemo(() => {
    const matching =
      normalizedQuery === ""
        ? skills
        : skills.filter((skill) =>
            [
              skill.name,
              skill.description ?? "",
              providerLabel(skill.provider, providerRoster),
              skillScopeLabel(
                skill,
                providerLabelForScope(skill, providerRoster),
              ),
            ]
              .join(" ")
              .toLowerCase()
              .includes(normalizedQuery),
          );
    return [...matching].sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.filePath.localeCompare(right.filePath),
    );
  }, [normalizedQuery, providerRoster, skills]);
  const libraryList = useResourceInfiniteItems(visibleSkills, {
    pageSize: libraryPageSize,
    resetKey: normalizedQuery,
  });
  const libraryBody = hasError ? (
    <ResourceListState
      state="error"
      message="Couldn't load skills."
      onRetry={onRetry}
    />
  ) : isLoading ? (
    <ResourceListState state="loading" message="Loading skills" />
  ) : visibleSkills.length === 0 ? (
    <ResourceListState
      state="empty"
      message={
        normalizedQuery === ""
          ? "No skills in your library."
          : `No skills match "${query}"`
      }
    />
  ) : (
    <>
      <ResourceListPanel>
        {libraryList.items.map((skill) => (
          <SkillRow
            key={`${skill.scope}-${skill.provider ?? "bb"}-${skill.name}-${skill.filePath}`}
            skill={skill}
            providerRoster={providerRoster}
            onSelect={() => onSelectSkill(skill)}
            onPrefetch={onPrefetchSkill}
          />
        ))}
      </ResourceListPanel>
      <ResourceInfiniteScrollSentinel
        itemCount={libraryList.items.length}
        hasMore={libraryList.hasMore}
        onLoadMore={libraryList.loadMore}
      />
    </>
  );

  return (
    <ResourceCollectionViewport
      scrollId="skills-library-results"
      viewportRef={setLibraryViewport}
      bandClassName={TOOLS_PAGE_BAND_CLASSES}
      toolbar={
        <ResourceToolbar
          searchValue={query}
          searchPlaceholder="Search skills"
          onSearchChange={onQueryChange}
          action={action}
        />
      }
    >
      <div className={TOOLS_PAGE_BAND_CLASSES}>{libraryBody}</div>
    </ResourceCollectionViewport>
  );
}

interface SkillsOverviewProps {
  skills: readonly SkillSummary[];
  providerRoster: ProviderRoster;
  isLoading: boolean;
  hasError: boolean;
  query?: string;
  activeMode?: SkillsCollectionMode;
  browseContent?: ReactNode;
  onCreateSkill: () => void;
  onSelectSkill: (skill: SkillSummary) => void;
  onPrefetchSkill?: (skill: SkillSummary) => void;
  onQueryChange?: (query: string) => void;
  onRetry?: () => void;
}

type SkillsCollectionMode = "library" | "browse";

export function SkillsOverview({
  skills,
  providerRoster,
  isLoading,
  hasError,
  query = "",
  activeMode = "library",
  browseContent,
  onCreateSkill,
  onSelectSkill,
  onPrefetchSkill,
  onQueryChange = () => {},
  onRetry,
}: SkillsOverviewProps) {
  return (
    <ResourceCollectionPage
      id="skills-collection"
      description={
        activeMode === "browse"
          ? SKILLS_BROWSE_DESCRIPTION
          : SKILLS_LIBRARY_DESCRIPTION
      }
      bandClassName={TOOLS_PAGE_BAND_CLASSES}
    >
      {activeMode === "browse" ? (
        browseContent
      ) : (
        <SkillsLibraryResults
          skills={skills}
          providerRoster={providerRoster}
          isLoading={isLoading}
          hasError={hasError}
          query={query}
          action={
            <ResourceCreateButton
              label="New bb skill"
              onCreate={onCreateSkill}
            />
          }
          onSelectSkill={onSelectSkill}
          onPrefetchSkill={onPrefetchSkill}
          onQueryChange={onQueryChange}
          onRetry={onRetry}
        />
      )}
    </ResourceCollectionPage>
  );
}

interface SkillDetailDialogViewProps {
  skill: SkillSummary | null;
  providerRoster: ProviderRoster;
  files: readonly string[];
  selectedPath: string;
  onSelectPath: (path: string) => void;
  content: string;
  isLoadingContent: boolean;
  isContentError: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canOpenInEditor: boolean;
  isDeleting: boolean;
  markdownLinkRouting?: MarkdownLinkRouting;
  onEdit: () => void;
  onRetry: () => void;
  onDelete: () => void;
  onOpenInEditor: () => void;
}

export function SkillDetailDialogView({
  skill,
  providerRoster,
  files,
  selectedPath,
  onSelectPath,
  content,
  isLoadingContent,
  isContentError,
  canEdit,
  canDelete,
  canOpenInEditor,
  isDeleting,
  markdownLinkRouting,
  onEdit,
  onRetry,
  onDelete,
  onOpenInEditor,
}: SkillDetailDialogViewProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [skill?.id]);

  if (skill === null) return null;
  const bundledPluginName =
    skill.scope === "plugin" ? providerPluginNameForSkill(skill) : null;
  const disabledReason = skillMutationDisabledReason(skill, providerRoster);
  const canEditSelectedPath = canEdit && selectedPath === "SKILL.md";
  const headerActions =
    skill.scope !== "plugin" &&
    (canEdit || canDelete || canOpenInEditor) &&
    !confirmingDelete ? (
      <ResourceOverflowMenu
        label={`${skill.name} actions`}
        items={[
          {
            label: "Edit",
            icon: "Edit" as const,
            disabled: !canEditSelectedPath,
            disabledReason: !canEdit
              ? disabledReason
              : selectedPath !== "SKILL.md"
                ? "Only SKILL.md can be edited"
                : undefined,
            onSelect: onEdit,
          },
          ...(canOpenInEditor
            ? [
                {
                  label: "Open source",
                  icon: "ExternalLink" as const,
                  onSelect: onOpenInEditor,
                },
              ]
            : []),
          { kind: "separator" as const },
          {
            label: "Delete",
            icon: "Trash2" as const,
            tone: "destructive" as const,
            disabled: !canDelete,
            disabledReason: !canDelete ? disabledReason : undefined,
            onSelect: () => setConfirmingDelete(true),
          },
        ]}
      />
    ) : null;
  return (
    <SkillDetailView
      leading={<SkillLeading skill={skill} providerRoster={providerRoster} />}
      title={skill.name}
      path={skill.filePath}
      titleBadge={
        skill.scope === "bb-builtin"
          ? {
              label: "BB Official",
              tooltip: "Ships with bb",
              accessibleLabel: `${skill.name} is BB Official`,
            }
          : bundledPluginName !== null
            ? {
                label: "Included",
                tooltip: (
                  <SkillProvenanceTooltip
                    prefix="Included with"
                    providerId={skill.provider}
                    provider={
                      skill.provider === null
                        ? undefined
                        : providerRoster.get(skill.provider)
                    }
                    name={`${providerPluginDisplayName(skill)} plugin.`}
                  />
                ),
                accessibleLabel: `${skill.name} is included with ${includedPluginDescription(skill, providerRoster)}`,
              }
            : skill.provider !== null
              ? {
                  label: "Imported",
                  tooltip: (
                    <SkillProvenanceTooltip
                      prefix="Discovered from"
                      providerId={skill.provider}
                      provider={providerRoster.get(skill.provider)}
                      name={providerLabel(skill.provider, providerRoster)}
                    />
                  ),
                  accessibleLabel: `${skill.name} is imported from ${providerLabel(skill.provider, providerRoster)}`,
                }
              : undefined
      }
      files={files.length > 0 ? files : ["SKILL.md"]}
      markdownLinkRouting={markdownLinkRouting}
      selectedPath={selectedPath}
      onSelectFile={onSelectPath}
      contentState={
        isContentError
          ? {
              kind: "error",
              message: `Failed to load ${selectedPath}.`,
              onRetry,
            }
          : isLoadingContent
            ? { kind: "loading" }
            : { kind: "ready", content }
      }
      overflowMenu={headerActions}
      footer={
        <ConfirmDeleteDialog
          open={confirmingDelete}
          onOpenChange={(open) => {
            if (!isDeleting) setConfirmingDelete(open);
          }}
        >
          <ConfirmDeleteDialogContent
            title="Delete skill?"
            description={`Delete "${skill.name}" from its current location? This cannot be undone.`}
            confirmLabel="Delete skill"
            pending={isDeleting}
            onConfirm={onDelete}
            onCancel={() => setConfirmingDelete(false)}
          />
        </ConfirmDeleteDialog>
      }
    />
  );
}
