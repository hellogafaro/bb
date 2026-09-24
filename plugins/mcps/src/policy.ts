import type { JsonRecord, ToolRisk } from "./types.js";

export type PolicyMode = "inherit" | "allow" | "deny" | "confirm";
export type EffectivePolicy = Exclude<PolicyMode, "inherit">;

export const POLICY_MODES: readonly PolicyMode[] = ["inherit", "allow", "confirm", "deny"];

export function classifyTool(annotations: JsonRecord | undefined): ToolRisk {
  if (annotations?.destructiveHint === true) return "destructive";
  if (annotations?.readOnlyHint === true) return "read";
  return "write";
}

export function effectivePolicy(mode: PolicyMode, risk: ToolRisk): EffectivePolicy {
  if (mode !== "inherit") return mode;
  return risk === "read" ? "allow" : "confirm";
}

export function isPolicyMode(value: string): value is PolicyMode {
  return (POLICY_MODES as readonly string[]).includes(value);
}

export function formatPolicyRows(rows: Array<{ tool: string; risk: ToolRisk; mode: PolicyMode; policy: EffectivePolicy }>): string {
  const width = Math.max(...rows.map((row) => row.tool.length));
  return rows.map((row) => `${row.tool.padEnd(width)}  ${row.risk.padEnd(11)}  ${row.policy}${row.mode === "inherit" ? " (default)" : ""}`).join("\n");
}
