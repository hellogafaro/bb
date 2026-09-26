import type { McpToolRisk } from "@bb/domain";
import { Pill, type PillVariant } from "@bb/shared-ui/pill";

const RISK_VARIANT: Record<McpToolRisk, PillVariant> = {
  read: "secondary",
  write: "outline",
  destructive: "destructive",
};

export function McpRiskPill({ risk }: { risk: McpToolRisk }) {
  return (
    <Pill variant={RISK_VARIANT[risk]} size="sm">
      {risk}
    </Pill>
  );
}
