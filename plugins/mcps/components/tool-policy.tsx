import { useCallback, useEffect, useState } from "react";
import { useRpc, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import { Pill, type PillVariant } from "@bb/shared-ui/pill";
import type { rpcContract } from "../server";
import { effectivePolicy, isPolicyMode } from "../src/policy";

type ToolPolicy = PluginRpcResult<(typeof rpcContract)["setToolPolicy"]>;
type Mode = ToolPolicy["mode"];
type Risk = ToolPolicy["risk"];

const RISK_VARIANT: Record<Risk, PillVariant> = { read: "secondary", write: "outline", destructive: "destructive" };
const POLICY_LABEL: Record<ToolPolicy["policy"], string> = { allow: "Allow", confirm: "Ask first", deny: "Block" };

export function RiskPill({ risk }: { risk: Risk }) {
  return <Pill variant={RISK_VARIANT[risk]} size="sm">{risk}</Pill>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useToolPolicies(serverId: string, refreshKey: unknown) {
  const rpc = useRpc<typeof rpcContract>();
  const [policies, setPolicies] = useState<ReadonlyMap<string, ToolPolicy>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setPolicies(new Map());
    rpc.call("listToolPolicies", { id: serverId }).then(
      (result) => { if (live) setPolicies(new Map(result.tools.map((row) => [row.tool, row]))); },
      (cause) => { if (live) setError(errorText(cause)); },
    );
    return () => { live = false; };
  }, [rpc, serverId, refreshKey]);

  const setMode = useCallback(async (tool: string, mode: Mode) => {
    setError(null);
    try {
      const row = await rpc.call("setToolPolicy", { id: serverId, tool, mode });
      setPolicies((current) => new Map(current).set(row.tool, row));
    } catch (cause) { setError(errorText(cause)); }
  }, [rpc, serverId]);

  return { policies, error, setMode };
}

export function ToolPolicySelect({ tool, policy, onChange }: { tool: string; policy: ToolPolicy | undefined; onChange: (mode: Mode) => void }) {
  if (!policy) return null;
  const inheritLabel = `Default (${POLICY_LABEL[effectivePolicy("inherit", policy.risk)]})`;
  return (
    <select
      aria-label={`Policy for ${tool}`}
      className="h-7 shrink-0 rounded-md border border-input bg-transparent px-2 text-xs"
      value={policy.mode}
      onChange={(event) => { if (isPolicyMode(event.target.value)) onChange(event.target.value); }}
    >
      <option value="inherit">{inheritLabel}</option>
      <option value="allow">{POLICY_LABEL.allow}</option>
      <option value="confirm">{POLICY_LABEL.confirm}</option>
      <option value="deny">{POLICY_LABEL.deny}</option>
    </select>
  );
}
