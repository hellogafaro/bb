import { cn } from "@bb/shared-ui/lib/utils";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { COARSE_POINTER_HEADER_PANEL_TOGGLE_ICON_BUTTON_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import type { KeyboardCommandId } from "@bb/domain";
import { useAppCommandRunner } from "@/components/commands/AppCommandProvider";

interface SidebarQuickActionsProps {
  onAction?: () => void;
  className?: string;
}

const SIDEBAR_QUICK_ACTION_BUTTON_CLASS = cn(
  COARSE_POINTER_HEADER_PANEL_TOGGLE_ICON_BUTTON_CLASS,
  "text-muted-foreground ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:ring-2",
);

const SIDEBAR_QUICK_ACTIONS: readonly {
  command: KeyboardCommandId;
  icon: IconName;
  label: string;
}[] = [
  { command: "palette.open", icon: "Search", label: "Search" },
  { command: "thread.new", icon: "EditBox", label: "New thread" },
];

export function SidebarQuickActions({
  onAction,
  className,
}: SidebarQuickActionsProps) {
  const commandRunner = useAppCommandRunner();
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {SIDEBAR_QUICK_ACTIONS.map((action) => (
        <Button
          key={action.command}
          type="button"
          variant="ghost"
          size="icon"
          className={SIDEBAR_QUICK_ACTION_BUTTON_CLASS}
          aria-label={action.label}
          onClick={(event) => {
            commandRunner.dispatch(action.command, event.currentTarget);
            onAction?.();
          }}
        >
          <Icon name={action.icon} aria-hidden />
        </Button>
      ))}
    </div>
  );
}
