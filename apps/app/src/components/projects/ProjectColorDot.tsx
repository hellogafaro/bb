import { cn } from "@bb/shared-ui/lib/utils";

export function labelColorVar(color: number): string {
  return `var(--label-color-${color})`;
}

export function ProjectColorDot({
  color,
  className,
  dotClassName,
}: {
  color: number;
  className?: string;
  dotClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-project-color-dot={color}
      className={cn(
        "flex size-3 shrink-0 items-center justify-center",
        className,
      )}
    >
      <span
        className={cn("size-2.5 rounded-full", dotClassName)}
        style={{ backgroundColor: labelColorVar(color) }}
      />
    </span>
  );
}
