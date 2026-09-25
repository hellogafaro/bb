import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-foreground/[0.07] motion-reduce:animate-none", className)} {...props} />;
}

export { Skeleton };
