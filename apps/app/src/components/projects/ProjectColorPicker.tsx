import { LABEL_COLOR_COUNT } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { labelColorVar } from "./ProjectColorDot";

const LABEL_COLOR_CHOICES = Array.from(
  { length: LABEL_COLOR_COUNT },
  (_, index) => index + 1,
);

export function ProjectColorPicker({
  value,
  disabled = false,
  onChange,
}: {
  value: number;
  disabled?: boolean;
  onChange: (color: number) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Project color"
      className="grid w-max grid-cols-12 gap-1"
    >
      {LABEL_COLOR_CHOICES.map((color) => {
        const selected = color === value;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Color ${color}`}
            disabled={disabled}
            onClick={() => {
              if (!selected) onChange(color);
            }}
            className={cn(
              "flex size-6 items-center justify-center rounded-full border hover:bg-state-hover disabled:cursor-default",
              selected ? "border-foreground/40" : "border-transparent",
            )}
          >
            <span
              aria-hidden="true"
              className="size-4 rounded-full"
              style={{ backgroundColor: labelColorVar(color) }}
            />
          </button>
        );
      })}
    </div>
  );
}
