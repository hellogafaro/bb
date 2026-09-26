import { Suspense } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { CREATE_SKILL_PROMPT } from "@bb/client-core";
import {
  ResourceCollectionPage,
  ResourceCreateButton,
} from "@bb/shared-ui/resource-list";
import { SkillsLibrary } from "@/components/tools/SkillsLibrary";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { useProjectSkills } from "@/hooks/queries/skills-queries";
import { customizeSkills } from "@/lib/fork-customize-skills";
import {
  getRootComposeRoutePath,
  SETTINGS_SKILL_DETAIL_ROUTE_PATH,
} from "@/lib/route-paths";
import { ResourceBodyFallback, ResourceScrollPage } from "./ToolsView";

export const SKILLS_PAGE_DESCRIPTION =
  "Skills every agent can use. Add new ones in chat.";

export function CustomizeSkillsView() {
  const location = useLocation();
  const isDetail =
    matchPath(SETTINGS_SKILL_DETAIL_ROUTE_PATH, location.pathname) !== null;

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={<ResourceBodyFallback />}>
          {isDetail ? (
            <ResourceScrollPage>
              <SkillsLibrary />
            </ResourceScrollPage>
          ) : (
            <SkillsCollection />
          )}
        </Suspense>
      </div>
    </div>
  );
}

function SkillsCollection() {
  const navigate = useNavigate();
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const count = skillsQuery.data
    ? customizeSkills(skillsQuery.data.skills).length
    : undefined;
  return (
    <div className="box-border h-full w-full pb-4 pt-3 md:pt-4">
      <ResourceCollectionPage
        id="skills"
        description={
          count === undefined
            ? SKILLS_PAGE_DESCRIPTION
            : `${SKILLS_PAGE_DESCRIPTION} ${count} installed.`
        }
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
      >
        <SkillsLibrary
          action={
            <ResourceCreateButton
              label="New skill"
              onCreate={() =>
                navigate(getRootComposeRoutePath(), {
                  state: {
                    focusPrompt: true,
                    replaceInitialPrompt: true,
                    initialPrompt: CREATE_SKILL_PROMPT,
                    createDraftKind: "skill",
                  },
                })
              }
            />
          }
        />
      </ResourceCollectionPage>
    </div>
  );
}
