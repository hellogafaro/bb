import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

export function Skeleton({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export function TextSkeleton({
  children,
  loading,
  label,
}: {
  children: ReactNode;
  loading: boolean;
  label: string;
}) {
  return (
    <span
      className="relative flex min-w-0 flex-1 items-baseline"
      role={loading ? "status" : undefined}
      aria-label={loading ? label : undefined}
      aria-busy={loading || undefined}
    >
      <span
        aria-hidden={loading || undefined}
        className={cn(
          "flex min-w-0 flex-1 items-baseline",
          loading && "invisible",
        )}
      >
        {children}
      </span>
      {loading ? (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-1/2 h-3.5 max-w-64 -translate-y-1/2 animate-pulse rounded-sm bg-muted motion-reduce:animate-none"
        />
      ) : null}
    </span>
  );
}
