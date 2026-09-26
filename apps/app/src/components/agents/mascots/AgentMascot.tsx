import type { CSSProperties } from "react";
import type { AgentMascot as AgentMascotName } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { MASCOT_GRID, mascotSprite } from "./mascot-sprites";

export function agentColorVar(color: number): string {
  return `var(--agent-color-${color})`;
}

export function agentAvatarStyle(color: number): CSSProperties {
  const tint = agentColorVar(color);
  return {
    backgroundColor: `color-mix(in oklab, ${tint} 14%, transparent)`,
    borderColor: `color-mix(in oklab, ${tint} 32%, transparent)`,
  };
}

export function AgentMascot({
  mascot,
  color,
  active = false,
  tint,
  className,
}: {
  mascot: AgentMascotName;
  color: number;
  active?: boolean;
  tint?: string;
  className?: string;
}) {
  const sprite = mascotSprite(mascot);
  return (
    <svg
      aria-hidden="true"
      data-agent-mascot={mascot}
      data-agent-mascot-active={active ? "" : undefined}
      viewBox={`0 0 ${MASCOT_GRID} ${MASCOT_GRID}`}
      shapeRendering="crispEdges"
      fill="currentColor"
      className={cn("size-3 shrink-0", active && "mascot-active", className)}
      style={{ color: tint ?? agentColorVar(color) }}
    >
      {active ? (
        <>
          <path className="mascot-rest" d={sprite.restPath} />
          <path className="mascot-talk" d={sprite.talkPath} />
        </>
      ) : (
        <path d={sprite.restPath} />
      )}
    </svg>
  );
}
