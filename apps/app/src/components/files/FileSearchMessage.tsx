import type { HTMLAttributes } from "react";
import {
  COARSE_POINTER_ICON_SIZE_CLASS,
  COARSE_POINTER_TEXT_SM_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";

interface FileSearchMessageProps extends Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> {
  iconName: "AlertCircle" | "File" | "FileQuestion" | "Spinner";
  iconClassName?: string;
  message: string;
}

export function FileSearchMessage({
  className,
  iconName,
  iconClassName,
  message,
  ...props
}: FileSearchMessageProps) {
  return (
    <EmptyStatePanel
      className={cn("flex min-h-24 items-center justify-center", className)}
      {...props}
    >
      <div className="flex max-w-64 items-center justify-center gap-1.5">
        <Icon
          name={iconName}
          className={cn(
            COARSE_POINTER_ICON_SIZE_CLASS,
            "shrink-0",
            iconClassName,
          )}
        />
        <p className={COARSE_POINTER_TEXT_SM_CLASS}>{message}</p>
      </div>
    </EmptyStatePanel>
  );
}
