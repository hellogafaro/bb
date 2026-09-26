import { matchPath, useLocation, useNavigate } from "react-router-dom";
import {
  ResourceCollectionPage,
  ResourceCreateButton,
} from "@bb/shared-ui/resource-list";
import { McpDetailView } from "@/components/mcp/McpDetailView";
import { McpsView } from "@/components/mcp/McpsView";
import { CREATE_MCP_PROMPT } from "@/components/mcp/mcp-prompts";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { useMcpServers } from "@/hooks/queries/mcp-queries";
import {
  getRootComposeRoutePath,
  MCP_DETAIL_ROUTE_PATH,
} from "@/lib/route-paths";

export const MCPS_PAGE_DESCRIPTION =
  "MCP servers every agent can use. Add new ones in chat.";

function decodeRouteSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function CustomizeMcpsView() {
  const location = useLocation();
  const mcpRef = matchPath(MCP_DETAIL_ROUTE_PATH, location.pathname)?.params
    .mcpRef;

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        {mcpRef !== undefined && mcpRef !== "" ? (
          <McpDetailView key={mcpRef} serverRef={decodeRouteSegment(mcpRef)} />
        ) : (
          <McpsCollection />
        )}
      </div>
    </div>
  );
}

function McpsCollection() {
  const navigate = useNavigate();
  const serversQuery = useMcpServers();
  const count = serversQuery.data?.length;
  return (
    <div className="box-border h-full w-full pb-4 pt-3 md:pt-4">
      <ResourceCollectionPage
        id="mcps"
        description={
          count === undefined
            ? MCPS_PAGE_DESCRIPTION
            : `${MCPS_PAGE_DESCRIPTION} ${count} installed.`
        }
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
      >
        <McpsView
          action={
            <ResourceCreateButton
              label="New MCP"
              onCreate={() =>
                navigate(getRootComposeRoutePath(), {
                  state: {
                    focusPrompt: true,
                    replaceInitialPrompt: true,
                    initialPrompt: CREATE_MCP_PROMPT,
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
