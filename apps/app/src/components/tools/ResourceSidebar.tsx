import type { MouseEvent as ReactMouseEvent } from "react";
import { useLocation } from "react-router-dom";
import {
  SectionSidebar,
  SectionSidebarLabel,
  SectionSidebarRow,
} from "@/components/sidebar/SectionSidebar";
import { PLUGIN_PAGES, resolveToolsActivePage } from "./tools-navigation";

export function ResourceSidebar({
  appRoutePath,
  isResizing,
  mobileHosted,
  onResizeMouseDown,
}: {
  appRoutePath: string;
  isResizing: boolean;
  mobileHosted?: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const location = useLocation();
  const activePage = resolveToolsActivePage(location.search);

  return (
    <SectionSidebar
      backLabel="Back to app"
      backTo={appRoutePath}
      isResizing={isResizing}
      mobileHosted={mobileHosted}
      onResizeMouseDown={onResizeMouseDown}
      testIdPrefix="plugins"
    >
      <SectionSidebarLabel>Plugins</SectionSidebarLabel>
      <div className="mt-1 space-y-0.5">
        {PLUGIN_PAGES.map((page) => (
          <SectionSidebarRow
            key={page.id}
            active={activePage === page.id}
            label={page.label}
            to={page.to}
          />
        ))}
      </div>
    </SectionSidebar>
  );
}
