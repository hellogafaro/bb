import type { CSSProperties, ReactNode } from "react";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceBrowseCard,
  ResourceBrowseGrid,
  ResourceIconFrame,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";

const CUSTOMIZE_CARD_CLASS_NAME =
  "h-full min-h-28 grid-rows-[auto_1fr] rounded-xl p-3";
export const CUSTOMIZE_CARD_AVATAR_CLASS_NAME =
  "size-6 rounded border border-border bg-muted/40 text-muted-foreground";

export function CustomizeCardGrid({ children }: { children: ReactNode }) {
  return (
    <ResourceBrowseGrid className="w-full grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-2">
      {children}
    </ResourceBrowseGrid>
  );
}

export function CustomizeCard({
  leading,
  leadingClassName,
  leadingStyle,
  title,
  headerAction,
  description,
  openLabel,
  onOpen,
  className,
}: {
  leading: ReactNode;
  leadingClassName?: string;
  leadingStyle?: CSSProperties;
  title: string;
  headerAction?: ReactNode;
  description: ReactNode;
  openLabel: string;
  onOpen: (trigger: HTMLButtonElement) => void;
  className?: string;
}) {
  return (
    <ResourceBrowseCard
      className={cn(CUSTOMIZE_CARD_CLASS_NAME, className)}
      leading={
        <ResourceIconFrame
          className={cn(CUSTOMIZE_CARD_AVATAR_CLASS_NAME, leadingClassName)}
          style={leadingStyle}
        >
          {() => leading}
        </ResourceIconFrame>
      }
      leadingClassName="size-6"
      title={<span className="line-clamp-2 whitespace-normal">{title}</span>}
      headerAction={headerAction}
      description={description}
      descriptionClassName="self-end"
      openLabel={openLabel}
      onOpen={onOpen}
    />
  );
}

export function CustomizeCardSkeletonGrid({
  label,
  count = 6,
}: {
  label: string;
  count?: number;
}) {
  return (
    <div role="status" aria-label={label}>
      <CustomizeCardGrid>
        {Array.from({ length: count }, (_, index) => (
          <div
            key={index}
            aria-hidden="true"
            className={cn(
              "grid w-full grid-rows-[auto_1fr] gap-2 border border-border bg-card",
              CUSTOMIZE_CARD_CLASS_NAME,
            )}
          >
            <div className="flex items-center gap-3">
              <Skeleton className="size-6 rounded" />
              <Skeleton className="h-3.5 w-2/5" />
            </div>
            <div className="space-y-1.5 self-end">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-3/4" />
            </div>
          </div>
        ))}
      </CustomizeCardGrid>
    </div>
  );
}
