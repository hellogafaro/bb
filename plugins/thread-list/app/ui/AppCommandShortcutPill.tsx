import { cn } from "@bb/shared-ui/lib/utils";

interface AppCommandShortcutPillProps {
  ariaHidden?: boolean;
  shortcut: { label: string };
  className?: string;
}

const APP_COMMAND_SHORTCUT_HINT_CLASS =
  "pointer-events-none inline-flex h-4 shrink-0 items-center justify-center whitespace-nowrap rounded-[3px] bg-state-hover px-[3px] font-sans text-2xs font-normal leading-3 tabular-nums text-subtle-foreground opacity-60";

export function AppCommandShortcutPill({
  ariaHidden = true,
  shortcut,
  className,
}: AppCommandShortcutPillProps) {
  return (
    <kbd
      aria-hidden={ariaHidden}
      className={cn(APP_COMMAND_SHORTCUT_HINT_CLASS, className)}
    >
      {shortcut.label}
    </kbd>
  );
}
