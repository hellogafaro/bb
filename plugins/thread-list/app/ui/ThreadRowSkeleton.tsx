import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";

const ROW_TITLE_WIDTHS = ["w-3/4", "w-1/2", "w-2/3"] as const;

export function ThreadRowSkeleton({
  titleWidthClassName,
}: {
  titleWidthClassName: string;
}) {
  return (
    <div
      data-sidebar="thread-row-skeleton"
      className="grid h-[var(--bb-sidebar-thread-row-height)] grid-rows-[20px_16px] content-center items-center rounded-md py-1.5 pl-2 pr-2"
    >
      <Skeleton
        className={cn(
          "h-2.5 rounded-sm bg-sidebar-border/60",
          titleWidthClassName,
        )}
      />
      <Skeleton className="h-1.5 w-16 rounded-sm bg-sidebar-border/40" />
    </div>
  );
}

export function ThreadListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-0.5">
      {Array.from({ length: rows }, (_, index) => (
        <ThreadRowSkeleton
          key={index}
          titleWidthClassName={
            ROW_TITLE_WIDTHS[index % ROW_TITLE_WIDTHS.length]!
          }
        />
      ))}
    </div>
  );
}

export function ThreadListSectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div>
      <div className="flex h-6 items-center pl-2">
        <Skeleton className="h-2 w-14 rounded-sm bg-sidebar-border/50" />
      </div>
      <div className="mt-1">
        <ThreadListSkeleton rows={rows} />
      </div>
    </div>
  );
}
