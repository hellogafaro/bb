import type { McpToolRisk } from "@bb/domain";
import type { McpToolPolicy } from "@bb/server-contract";
import { Pill, type PillVariant } from "@bb/shared-ui/pill";

type PolicyMode = McpToolPolicy["mode"];
type EffectivePolicy = McpToolPolicy["policy"];

const RISK_VARIANT: Record<McpToolRisk, PillVariant> = {
  read: "secondary",
  write: "outline",
  destructive: "destructive",
};

const POLICY_LABEL: Record<EffectivePolicy, string> = {
  allow: "Allow",
  confirm: "Ask first",
  deny: "Block",
};

const POLICY_MODES: readonly PolicyMode[] = [
  "inherit",
  "allow",
  "confirm",
  "deny",
];

function isPolicyMode(value: string): value is PolicyMode {
  return POLICY_MODES.some((mode) => mode === value);
}

function defaultPolicy(risk: McpToolRisk): EffectivePolicy {
  return risk === "read" ? "allow" : "confirm";
}

export function McpRiskPill({ risk }: { risk: McpToolRisk }) {
  return (
    <Pill variant={RISK_VARIANT[risk]} size="sm">
      {risk}
    </Pill>
  );
}

export function McpToolPolicySelect({
  tool,
  policy,
  disabled,
  onChange,
}: {
  tool: string;
  policy: McpToolPolicy | undefined;
  disabled: boolean;
  onChange: (mode: PolicyMode) => void;
}) {
  if (!policy) return null;
  return (
    <select
      aria-label={`Policy for ${tool}`}
      className="h-7 shrink-0 rounded-md border border-input bg-transparent px-2 text-xs"
      value={policy.mode}
      disabled={disabled}
      onChange={(event) => {
        if (isPolicyMode(event.target.value)) onChange(event.target.value);
      }}
    >
      <option value="inherit">{`Default (${POLICY_LABEL[defaultPolicy(policy.risk)]})`}</option>
      <option value="allow">{POLICY_LABEL.allow}</option>
      <option value="confirm">{POLICY_LABEL.confirm}</option>
      <option value="deny">{POLICY_LABEL.deny}</option>
    </select>
  );
}
