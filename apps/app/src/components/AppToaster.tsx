import { Toaster, type ToasterProps } from "sonner";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { Icon } from "@bb/shared-ui/icon";
import { usePreferredTheme } from "@/hooks/useTheme";

const COMPACT_TOAST_OFFSET: NonNullable<ToasterProps["offset"]> = {
  top: "calc(env(safe-area-inset-top) + var(--bb-app-chrome-row-height) + 16px)",
};
const COMPACT_TOAST_SWIPE_DIRECTIONS: NonNullable<
  ToasterProps["swipeDirections"]
> = ["top", "left", "right"];
const PLUGIN_TOAST_BUTTON_CLASS =
  "h-7 max-w-[min(25vw,120px)] shrink-0 truncate rounded-sm border border-border bg-transparent px-2 text-xs leading-4 text-muted-foreground hover:bg-state-hover hover:text-foreground";
const PLUGIN_TOAST_OPTIONS: NonNullable<ToasterProps["toastOptions"]> = {
  unstyled: true,
  classNames: {
    toast:
      "[&:not(.bb-app-toast)]:flex [&:not(.bb-app-toast)]:w-[var(--width,356px)] [&:not(.bb-app-toast)]:max-w-[calc(100vw-32px)] [&:not(.bb-app-toast)]:min-h-[46px] [&:not(.bb-app-toast)]:items-center [&:not(.bb-app-toast)]:gap-2 [&:not(.bb-app-toast)]:rounded-md [&:not(.bb-app-toast)]:border [&:not(.bb-app-toast)]:border-border [&:not(.bb-app-toast)]:bg-popover [&:not(.bb-app-toast)]:py-2 [&:not(.bb-app-toast)]:pr-2 [&:not(.bb-app-toast)]:pl-3 [&:not(.bb-app-toast)]:font-sans [&:not(.bb-app-toast)]:text-sm [&:not(.bb-app-toast)]:leading-5 [&:not(.bb-app-toast)]:text-popover-foreground [&:not(.bb-app-toast)]:shadow-sm",
    content: "min-w-0 flex-1",
    title: "truncate font-medium",
    description: "hidden",
    icon: "flex size-4 shrink-0 items-center justify-center empty:hidden",
    actionButton: PLUGIN_TOAST_BUTTON_CLASS,
    cancelButton: PLUGIN_TOAST_BUTTON_CLASS,
    closeButton:
      "order-last flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-state-hover hover:text-foreground",
  },
};
const PLUGIN_TOAST_ICONS: NonNullable<ToasterProps["icons"]> = {
  success: (
    <Icon name="CircleCheck" className="size-4 text-success" aria-hidden />
  ),
  warning: (
    <Icon name="AlertTriangle" className="size-4 text-warning" aria-hidden />
  ),
  error: (
    <Icon name="AlertCircle" className="size-4 text-destructive" aria-hidden />
  ),
  info: <></>,
};

export function AppToaster() {
  const theme = usePreferredTheme();
  const isCompactViewport = useIsCompactViewport();
  return (
    <Toaster
      theme={theme}
      icons={PLUGIN_TOAST_ICONS}
      toastOptions={PLUGIN_TOAST_OPTIONS}
      position={isCompactViewport ? "top-center" : "bottom-right"}
      offset={isCompactViewport ? COMPACT_TOAST_OFFSET : undefined}
      mobileOffset={isCompactViewport ? COMPACT_TOAST_OFFSET : undefined}
      swipeDirections={
        isCompactViewport ? COMPACT_TOAST_SWIPE_DIRECTIONS : undefined
      }
    />
  );
}
