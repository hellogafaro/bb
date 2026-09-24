import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@bb/shared-ui/tabs";
import { getPluginPanelRoutePath, getSkillsRoutePath } from "@/lib/route-paths";

export type CustomizeTab = "skills" | "mcps";

export const CUSTOMIZE_TAB_ROUTE_PATHS = {
  skills: `${getSkillsRoutePath()}?view=library`,
  mcps: getPluginPanelRoutePath({ pluginId: "mcps", path: "mcps" }),
} as const satisfies Record<CustomizeTab, string>;

function isCustomizeTab(value: string): value is CustomizeTab {
  return value === "skills" || value === "mcps";
}

export function CustomizeTabs({ active }: { active: CustomizeTab }) {
  const navigate = useNavigate();
  return (
    <Tabs
      value={active}
      onValueChange={(value) => {
        if (!isCustomizeTab(value) || value === active) return;
        void navigate(CUSTOMIZE_TAB_ROUTE_PATHS[value]);
      }}
    >
      <TabsList aria-label="Customize">
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="mcps">MCPs</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
