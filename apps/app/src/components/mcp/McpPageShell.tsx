import type { ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";

export function McpPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border min-h-full w-full max-w-5xl px-4 pb-4 pt-3 md:px-5 md:pt-4">
        {children}
      </div>
    </div>
  );
}

export function McpPagination({
  page,
  total,
  pageSize,
  label,
  onPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  label: string;
  onPage: (page: number) => void;
}) {
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Previous ${label}`}
        disabled={page === 0}
        onClick={() => onPage(page - 1)}
      >
        Previous
      </Button>
      <span className="text-xs text-muted-foreground">
        {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of{" "}
        {total}
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        aria-label={`Next ${label}`}
        disabled={(page + 1) * pageSize >= total}
        onClick={() => onPage(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
