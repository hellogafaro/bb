import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { CREATE_SKILL_PROMPT } from "@bb/client-core";
import {
  ResourceCollectionPage,
  ResourceCreateButton,
} from "@bb/shared-ui/resource-list";
import { McpDetailView } from "@/components/mcp/McpDetailView";
import { McpsView } from "@/components/mcp/McpsView";
import { CREATE_MCP_PROMPT } from "@/components/mcp/mcp-prompts";
import {
  getCustomizeRoutePath,
  resolveCustomizeRoute,
  type CustomizeTab,
} from "@/components/tools/customize-navigation";
import { SkillsLibrary } from "@/components/tools/SkillsLibrary";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { useMcpServers } from "@/hooks/queries/mcp-queries";
import { useProjectSkills } from "@/hooks/queries/skills-queries";
import { getRootComposeRoutePath } from "@/lib/route-paths";

export function CustomizeView() {
  const location = useLocation();
  const route = resolveCustomizeRoute(location.pathname);
  if (route === null) {
    return <Navigate to={getCustomizeRoutePath("skills")} replace />;
  }

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        {route.tab === "mcps" && route.mcpRef !== null ? (
          <McpDetailView key={route.mcpRef} serverRef={route.mcpRef} />
        ) : (
          <CustomizeCollection tab={route.tab} />
        )}
      </div>
    </div>
  );
}

function CustomizeCollection({ tab }: { tab: CustomizeTab }) {
  const navigate = useNavigate();
  const skillsQuery = useProjectSkills(PERSONAL_PROJECT_ID);
  const serversQuery = useMcpServers();
  const create =
    tab === "skills"
      ? {
          label: "New skill",
          state: {
            initialPrompt: CREATE_SKILL_PROMPT,
            createDraftKind: "skill",
          },
        }
      : { label: "New MCP", state: { initialPrompt: CREATE_MCP_PROMPT } };

  return (
    <div className="box-border h-full w-full pb-4 pt-3 md:pt-4">
      <ResourceCollectionPage
        id="customize"
        description="Skills and MCP servers every agent can use. Add new ones in chat."
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
        modes={[
          {
            id: "skills",
            label: "Skills",
            count: skillsQuery.data?.skills.length,
          },
          { id: "mcps", label: "MCPs", count: serversQuery.data?.length },
        ]}
        activeMode={tab}
        onModeChange={(mode) => {
          if (mode !== tab) navigate(getCustomizeRoutePath(mode));
        }}
        actions={
          <ResourceCreateButton
            label={create.label}
            onCreate={() =>
              navigate(getRootComposeRoutePath(), {
                state: {
                  focusPrompt: true,
                  replaceInitialPrompt: true,
                  ...create.state,
                },
              })
            }
          />
        }
      >
        {tab === "skills" ? <SkillsLibrary /> : <McpsView />}
      </ResourceCollectionPage>
    </div>
  );
}
