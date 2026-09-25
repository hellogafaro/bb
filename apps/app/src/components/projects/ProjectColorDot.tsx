import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";

export const NEUTRAL_LABEL_COLOR_VAR = "var(--label-color-neutral)";

export function labelColorVar(color: number): string {
  return `var(--label-color-${color})`;
}

export function projectDotColor(project: {
  id: string;
  color: number;
}): number | null {
  return project.id === PERSONAL_PROJECT_ID ? null : project.color;
}

export function ProjectColorDot({
  color,
  className,
  dotClassName,
}: {
  color: number | null;
  className?: string;
  dotClassName?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-project-color-dot={color ?? "neutral"}
      className={cn(
        "flex size-3 shrink-0 items-center justify-center",
        className,
      )}
      style={{
        color: color === null ? NEUTRAL_LABEL_COLOR_VAR : labelColorVar(color),
      }}
    >
      <svg
        viewBox="0 0 10 10"
        className={cn("size-2.5", dotClassName)}
        aria-hidden
      >
        <circle
          cx="5"
          cy="5"
          r="4.25"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>
    </span>
  );
}
