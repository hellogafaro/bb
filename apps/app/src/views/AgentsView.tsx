import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { CREATE_AGENT_PROMPT, getAgentsRoutePath } from "@bb/client-core";
import {
  ResourceCollectionPage,
  ResourceCreateButton,
} from "@bb/shared-ui/resource-list";
import { AgentDetailView } from "@/components/agents/AgentDetailView";
import { AgentsList } from "@/components/agents/AgentsList";
import { resolveAgentsRoute } from "@/components/agents/agents-navigation";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { getRootComposeRoutePath } from "@/lib/route-paths";

export const AGENTS_PAGE_DESCRIPTION =
  "Agents run your threads. Each one picks a provider, model, skills, MCPs, and instructions.";

export function AgentsView() {
  const location = useLocation();
  const route = resolveAgentsRoute(location.pathname);
  if (route === null) {
    return <Navigate to={getAgentsRoutePath()} replace />;
  }

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        {route.agentRef !== null ? (
          <AgentDetailView key={route.agentRef} agentRef={route.agentRef} />
        ) : (
          <AgentsCollection />
        )}
      </div>
    </div>
  );
}

function AgentsCollection() {
  const navigate = useNavigate();
  return (
    <div className="box-border h-full w-full pb-4 pt-3 md:pt-4">
      <ResourceCollectionPage
        id="agents"
        description={AGENTS_PAGE_DESCRIPTION}
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
      >
        <AgentsList
          action={
            <ResourceCreateButton
              label="New agent"
              onCreate={() =>
                navigate(getRootComposeRoutePath(), {
                  state: {
                    focusPrompt: true,
                    replaceInitialPrompt: true,
                    initialPrompt: CREATE_AGENT_PROMPT,
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
