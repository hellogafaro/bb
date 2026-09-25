import { Navigate, useLocation } from "react-router-dom";
import { McpDetailView } from "@/components/mcp/McpDetailView";
import { McpsView } from "@/components/mcp/McpsView";
import { CustomizeTabs } from "@/components/tools/CustomizeTabs";
import {
  getCustomizeRoutePath,
  resolveCustomizeRoute,
} from "@/components/tools/customize-navigation";
import { SkillsLibrary } from "@/components/tools/SkillsLibrary";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";

export function CustomizeView() {
  const location = useLocation();
  const route = resolveCustomizeRoute(location.pathname);
  if (route === null) {
    return <Navigate to={getCustomizeRoutePath("skills")} replace />;
  }

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="shrink-0 pt-3 md:pr-3 md:pt-4">
        <div className={TOOLS_PAGE_BAND_CLASSES}>
          <CustomizeTabs active={route.tab} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {route.tab === "skills" ? (
          <div className="box-border h-full w-full pb-4 pt-3 md:pt-4">
            <SkillsLibrary />
          </div>
        ) : route.mcpRef === null ? (
          <McpsView />
        ) : (
          <McpDetailView key={route.mcpRef} serverRef={route.mcpRef} />
        )}
      </div>
    </div>
  );
}
