import {
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { toast as sonnerToast, type Action, type ExternalToast } from "sonner";
import { Button } from "@bb/shared-ui/button";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  openNotificationCenter,
  recordNotification,
} from "@/lib/notifications/notification-store";

export type AppToastTone =
  | "message"
  | "success"
  | "warning"
  | "error"
  | "loading";

type AppToastForwardedOptionKey =
  | "className"
  | "classNames"
  | "dismissible"
  | "duration"
  | "id"
  | "invert"
  | "onAutoClose"
  | "onDismiss"
  | "position"
  | "richColors"
  | "style"
  | "unstyled";

export interface AppToastOptions extends Pick<
  ExternalToast,
  AppToastForwardedOptionKey
> {
  action?: Action;
  cancel?: Action;
  description?: ReactNode;
}

interface AppToastContentProps {
  action?: Action;
  cancel?: Action;
  description?: ReactNode;
  dismissible?: boolean;
  id?: number | string;
  notificationId?: string | null;
  onDismiss?: () => void;
  title: ReactNode;
  tone: AppToastTone;
}

interface ShowAppToastParams {
  options?: AppToastOptions;
  title: ReactNode;
  tone: AppToastTone;
}

interface AppToastActionButtonProps {
  action: Action;
  id?: number | string;
  priority: "primary" | "secondary";
}

type AppToastMethod = (
  title: ReactNode,
  options?: AppToastOptions,
) => string | number;

const DEFAULT_TOAST_DURATION = 4000;

export function iconForTone(tone: AppToastTone): IconName {
  switch (tone) {
    case "success":
      return "CircleCheck";
    case "warning":
      return "AlertTriangle";
    case "error":
      return "AlertCircle";
    case "loading":
      return "Loading";
    case "message":
      return "Info";
  }
}

function dismissToast(id: number | string | undefined): void {
  if (id === undefined) {
    return;
  }
  sonnerToast.dismiss(id);
}

function AppToastActionButton({
  action,
  id,
  priority,
}: AppToastActionButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    action.onClick(event);
    if (priority === "primary" && event.defaultPrevented) {
      return;
    }
    dismissToast(id);
  };

  return <AppToastButton onClick={handleClick}>{action.label}</AppToastButton>;
}

function AppToastButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="block h-7 max-w-[min(25vw,120px)] shrink-0 truncate rounded-sm px-2 text-xs font-normal leading-4 text-muted-foreground shadow-none hover:bg-state-hover hover:text-foreground"
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function toneIconClassName(tone: AppToastTone): string | null {
  switch (tone) {
    case "success":
      return "text-success";
    case "warning":
      return "text-warning";
    case "error":
      return "text-destructive";
    case "loading":
      return "animate-spin text-muted-foreground motion-reduce:animate-none";
    case "message":
      return null;
  }
}

function useIsTruncated(content: ReactNode) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [truncated, setTruncated] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const measure = () => {
      setTruncated(element.scrollWidth - element.clientWidth > 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [content]);

  return { ref, truncated };
}

export function AppToastContent({
  action,
  cancel,
  description,
  dismissible = true,
  id,
  notificationId = null,
  onDismiss,
  title,
  tone,
}: AppToastContentProps) {
  const titleOverflow = useIsTruncated(title);
  const showNotification = () => {
    dismissToast(id);
    openNotificationCenter(notificationId);
  };
  const iconClassName = toneIconClassName(tone);
  const inlineDescription = isValidElement(description) ? description : null;
  const hasTextDescription =
    description !== undefined &&
    description !== null &&
    inlineDescription === null;
  const canShowMore =
    notificationId !== null && (titleOverflow.truncated || hasTextDescription);

  return (
    <div className="w-[var(--width,356px)] max-w-[calc(100vw-32px)] shrink-0 rounded-md border border-border bg-popover py-2 pr-2 pl-3 text-popover-foreground shadow-sm max-[600px]:w-[calc(100vw-32px)]">
      <div className="flex min-h-7 min-w-0 items-center gap-2">
        {iconClassName !== null ? (
          <Icon
            name={iconForTone(tone)}
            className={cn("size-4 shrink-0", iconClassName)}
            style={{ margin: 0 }}
            aria-hidden
          />
        ) : null}
        <div
          ref={titleOverflow.ref}
          data-testid="app-toast-title"
          className={cn(
            "min-w-0 truncate text-sm font-medium leading-5",
            inlineDescription === null
              ? "max-w-[60ch] flex-1"
              : "max-w-[50%] shrink-0",
          )}
        >
          {title}
        </div>
        {inlineDescription !== null ? (
          <div
            data-testid="app-toast-description"
            className="flex min-w-0 flex-1 items-center gap-1 text-sm leading-5 text-muted-foreground"
          >
            <span aria-hidden className="shrink-0">
              ·
            </span>
            <span className="min-w-0 flex-1 truncate">{inlineDescription}</span>
          </div>
        ) : null}
        {canShowMore ? (
          <AppToastButton onClick={showNotification}>Show more</AppToastButton>
        ) : null}
        {action ? (
          <AppToastActionButton action={action} id={id} priority="primary" />
        ) : null}
        {cancel ? (
          <AppToastActionButton action={cancel} id={id} priority="secondary" />
        ) : null}
        {dismissible ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-sm text-muted-foreground"
            aria-label="Dismiss notification"
            onClick={() => (onDismiss ? onDismiss() : dismissToast(id))}
          >
            <Icon
              name="X"
              className="size-3.5"
              style={{ margin: 0 }}
              aria-hidden
            />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function showAppToast({
  options,
  title,
  tone,
}: ShowAppToastParams): string | number {
  const {
    action,
    cancel,
    className,
    description,
    dismissible = true,
    duration,
    ...sonnerOptions
  } = options ?? {};
  const nextDuration =
    duration ?? (tone === "loading" ? Infinity : DEFAULT_TOAST_DURATION);
  const notificationId =
    tone === "loading"
      ? null
      : recordNotification({
          toastId: sonnerOptions.id ?? null,
          tone,
          title,
          description: description ?? null,
          createdAt: Date.now(),
        });

  return sonnerToast.custom(
    (id) => (
      <AppToastContent
        action={action}
        cancel={cancel}
        description={description}
        dismissible={dismissible}
        id={id}
        notificationId={notificationId}
        title={title}
        tone={tone}
      />
    ),
    {
      ...sonnerOptions,
      className: cn("bb-app-toast", className),
      dismissible,
      duration: nextDuration,
    },
  );
}

const showMessageToast: AppToastMethod = (title, options) =>
  showAppToast({ options, title, tone: "message" });

const showSuccessToast: AppToastMethod = (title, options) =>
  showAppToast({ options, title, tone: "success" });

const showWarningToast: AppToastMethod = (title, options) =>
  showAppToast({ options, title, tone: "warning" });

const showErrorToast: AppToastMethod = (title, options) =>
  showAppToast({ options, title, tone: "error" });

const showLoadingToast: AppToastMethod = (title, options) =>
  showAppToast({ options, title, tone: "loading" });

export const appToast = {
  dismiss: sonnerToast.dismiss,
  error: showErrorToast,
  loading: showLoadingToast,
  message: showMessageToast,
  success: showSuccessToast,
  warning: showWarningToast,
};
