import { Button } from "@bb/shared-ui/button";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";

export type ThreadListPlaceholderState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "crashed"; pluginTitle: string; onReload: () => void };

function LoadingRow({ textWidthClassName }: { textWidthClassName: string }) {
  return (
    <div
      data-sidebar="navigation-loading-row"
      className="grid h-[var(--bb-sidebar-thread-row-height)] grid-rows-[20px_16px] content-center items-center rounded-md py-1.5 pl-2 pr-2"
    >
      <Skeleton
        className={cn(
          "h-2.5 animate-none rounded-sm bg-sidebar-border/60",
          textWidthClassName,
        )}
      />
      <Skeleton className="h-1.5 w-16 animate-none rounded-sm bg-sidebar-border/40" />
    </div>
  );
}

function LoadingSection({ rowWidths }: { rowWidths: readonly string[] }) {
  return (
    <div>
      <div className="flex h-6 items-center pl-2">
        <Skeleton className="h-2 w-14 animate-none rounded-sm bg-sidebar-border/50" />
      </div>
      <div className="mt-1 space-y-0.5">
        {rowWidths.map((width, index) => (
          <LoadingRow key={index} textWidthClassName={width} />
        ))}
      </div>
    </div>
  );
}

export function ThreadListPlaceholder({
  state,
}: {
  state: ThreadListPlaceholderState;
}) {
  if (state.kind === "loading") {
    return (
      <div
        aria-label="Loading sidebar navigation"
        data-thread-list-placeholder="loading"
        className="space-y-4 px-2 pt-2"
      >
        <LoadingSection rowWidths={["w-3/4", "w-1/2"]} />
        <LoadingSection rowWidths={["w-3/4", "w-1/2", "w-2/3", "w-3/4"]} />
      </div>
    );
  }
  if (state.kind === "missing") {
    return (
      <div
        role="status"
        data-thread-list-placeholder="missing"
        className="flex flex-col gap-2 px-3 py-2 text-sm text-muted-foreground"
      >
        <span>No thread list plugin is enabled.</span>
      </div>
    );
  }
  return (
    <div
      role="alert"
      data-thread-list-placeholder="crashed"
      className="flex flex-col gap-2 px-3 py-2 text-sm text-muted-foreground"
    >
      <span>{state.pluginTitle} stopped working.</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={state.onReload}
      >
        Reload
      </Button>
    </div>
  );
}
