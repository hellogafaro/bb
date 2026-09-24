import { useNavigate } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@bb/shared-ui/tabs";
import {
  getCustomizeRoutePath,
  type CustomizeTab,
} from "./customize-navigation";

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
        void navigate(getCustomizeRoutePath(value));
      }}
    >
      <TabsList aria-label="Customize">
        <TabsTrigger value="skills">Skills</TabsTrigger>
        <TabsTrigger value="mcps">MCPs</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
