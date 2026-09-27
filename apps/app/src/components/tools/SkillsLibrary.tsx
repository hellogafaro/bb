import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { buildSkillEditThreadPrompt } from "@bb/shared-ui/resource-edit-prompt";
import type { EditableSkillScope, SkillSummary } from "@bb/server-contract";
import {
  ResourceListState,
  useResourceRouteLabel,
} from "@bb/shared-ui/resource-list";
import { getToolsOwnedCollectionRoutePath } from "@/components/tools/tools-navigation";
import {
  SkillDetailDialogView,
  SkillsCardResults,
  type ProviderRoster,
} from "@/components/tools/SkillsCollection";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { isSkillEditable } from "@/components/tools/skill-taxonomy";
import { usePrimaryHost } from "@/hooks/queries/host-queries";
import { useHostFilePreview } from "@/hooks/queries/host-file-preview-query";
import { getAbsoluteDirname } from "@/lib/absolute-file-path";
import { buildMarkdownLeaseImageRouting } from "@/components/ui/markdown-file-image-routing";
import {
  getRootComposeRoutePath,
  getSkillDetailRoutePath,
} from "@/lib/route-paths";
import {
  prefetchSkillDetail,
  useDeleteSkill,
  useProjectSkills,
  useSkillContent,
  useSkillFiles,
} from "@/hooks/queries/skills-queries";
import { useLocalOpenTargets } from "@/hooks/useLocalOpenTargets";
import { customizeSkills } from "@/lib/fork-customize-skills";

const EMPTY_SKILLS: readonly SkillSummary[] = [];

function useProviderRoster(): ProviderRoster {
  const providers = useSystemProviders().data;
  return useMemo(
    () => new Map((providers ?? []).map((provider) => [provider.id, provider])),
    [providers],
  );
}
function SkillDetailPage({
  projectId,
  skill,
  onClose,
  onEdit,
}: {
  projectId: string;
  skill: SkillSummary | null;
  onClose: () => void;
  onEdit: (skill: SkillSummary) => void;
}) {
  const providerRoster = useProviderRoster();
  const [selectedPath, setSelectedPath] = useState("SKILL.md");
  useEffect(() => {
    setSelectedPath("SKILL.md");
  }, [skill?.id]);
  const filesQuery = useSkillFiles(projectId, skill);
  const contentQuery = useSkillContent(projectId, skill, selectedPath);
  const primaryHost = usePrimaryHost({ enabled: skill !== null });
  const previewHostId =
    primaryHost?.status === "connected" ? primaryHost.id : null;
  const skillFilePreview = useHostFilePreview(
    previewHostId,
    skill?.filePath ?? null,
    { enabled: skill !== null && previewHostId !== null },
  );
  const deleteSkill = useDeleteSkill(projectId);
  const { canOpenPreferredFileTarget, openPathInPreferredFileTarget } =
    useLocalOpenTargets({ enabled: skill !== null });

  const deletableScope: EditableSkillScope | null =
    skill && skill.manageable && isSkillEditable(skill) ? skill.scope : null;
  const editableScope: EditableSkillScope | null =
    skill && isSkillEditable(skill) ? skill.scope : null;
  const markdownLinkRouting = useMemo(() => {
    if (skill === null) return undefined;
    return buildMarkdownLeaseImageRouting({
      path: selectedPath,
      rootPath: getAbsoluteDirname({ path: skill.filePath }),
      previewUrl: skillFilePreview.data?.url,
    });
  }, [selectedPath, skill, skillFilePreview.data?.url]);

  return (
    <SkillDetailDialogView
      skill={skill}
      providerRoster={providerRoster}
      files={filesQuery.data?.files ?? ["SKILL.md"]}
      selectedPath={selectedPath}
      onSelectPath={setSelectedPath}
      content={contentQuery.data?.content ?? ""}
      isLoadingContent={contentQuery.isLoading}
      isContentError={contentQuery.isError}
      canEdit={editableScope !== null}
      canDelete={deletableScope !== null}
      canOpenInEditor={editableScope !== null && canOpenPreferredFileTarget}
      isDeleting={deleteSkill.isPending}
      markdownLinkRouting={markdownLinkRouting}
      onEdit={() => {
        if (skill) onEdit(skill);
      }}
      onRetry={() => {
        void filesQuery.refetch();
        void contentQuery.refetch();
      }}
      onDelete={() => {
        if (!skill || deletableScope === null) return;
        deleteSkill.mutate(
          { skillId: skill.id, environmentId: null },
          { onSuccess: onClose },
        );
      }}
      onOpenInEditor={() => {
        if (!skill) return;
        void openPathInPreferredFileTarget({
          path: skill.filePath,
          lineNumber: null,
        });
      }}
    />
  );
}

export function SkillsLibrary({ action }: { action?: ReactNode } = {}) {
  const providerRoster = useProviderRoster();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { skillId: routeSkillId } = useParams<{ skillId?: string }>();
  const [libraryQuery, setLibraryQuery] = useState("");
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const listedSkills = skillsQuery.data?.skills ?? EMPTY_SKILLS;
  const skills = useMemo(() => customizeSkills(listedSkills), [listedSkills]);
  const hasError = skillsQuery.isError && skillsQuery.data === undefined;
  const isLoading =
    skillsQuery.isFetching && skillsQuery.data === undefined && !hasError;
  const selectedSkill = useMemo(() => {
    if (routeSkillId === undefined) return null;
    return skills.find((skill) => skill.id === routeSkillId) ?? null;
  }, [routeSkillId, skills]);
  useResourceRouteLabel(selectedSkill?.name ?? null);
  const openSkill = useCallback(
    (skill: SkillSummary) => {
      navigate(
        getSkillDetailRoutePath({
          skillId: skill.id,
        }),
      );
    },
    [navigate],
  );
  const editSkillViaThread = useCallback(
    (skill: SkillSummary) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: buildSkillEditThreadPrompt({
            id: skill.id,
            name: skill.name,
            path: skill.filePath,
          }),
          replaceInitialPrompt: true,
        },
      });
    },
    [navigate],
  );
  const closeSkillDetail = useCallback(() => {
    navigate(getToolsOwnedCollectionRoutePath("skills"));
  }, [navigate]);
  return (
    <>
      {routeSkillId !== undefined && hasError ? (
        <ResourceListState
          state="error"
          message="Couldn't load skill."
          layout="detail"
          onRetry={() => void skillsQuery.refetch()}
        />
      ) : routeSkillId !== undefined && isLoading ? (
        <ResourceListState
          state="loading"
          message="Loading skill"
          layout="detail"
        />
      ) : routeSkillId !== undefined && selectedSkill === null ? (
        <ResourceListState
          state="empty"
          message="Skill not found."
          layout="detail"
        />
      ) : selectedSkill ? (
        <SkillDetailPage
          projectId={PERSONAL_PROJECT_ID}
          skill={selectedSkill}
          onClose={closeSkillDetail}
          onEdit={editSkillViaThread}
        />
      ) : (
        <SkillsCardResults
          skills={skills}
          providerRoster={providerRoster}
          isLoading={isLoading}
          hasError={hasError}
          query={libraryQuery}
          action={action}
          onSelectSkill={openSkill}
          onPrefetchSkill={(skill) =>
            prefetchSkillDetail(queryClient, PERSONAL_PROJECT_ID, skill)
          }
          onQueryChange={setLibraryQuery}
          onRetry={() => void skillsQuery.refetch()}
        />
      )}
    </>
  );
}
