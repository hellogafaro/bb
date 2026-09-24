import { useEffect, useState } from "react";
import { useRpc, type PluginRpcResult } from "@get-bb/plugin-sdk/app";
import { Button } from "@/components/ui/button";
import type { rpcContract } from "../server";

type ProviderStatus = PluginRpcResult<(typeof rpcContract)["providerStatus"]>;

export function ProviderGuardNotice() {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    rpc.call("providerStatus", {}).then((result) => { if (live) setStatus(result); }, () => undefined);
    return () => { live = false; };
  }, [rpc]);

  if (!status || status.issues.length === 0) return null;
  const fix = async () => {
    setBusy(true);
    setError(null);
    try { setStatus(await rpc.call("providerFix", { hostId: status.hostId })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return (
    <section role="status" aria-label="Provider MCP guard" className="mb-4 shrink-0 space-y-2 rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-sm font-medium">Claude Code or Codex can load MCPs outside this page</p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {status.issues.map((issue) => <li key={issue.message} className="break-words">{issue.message}</li>)}
      </ul>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {status.status.claude.connectorsDisabled ? null : (
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void fix()}>Disable claude.ai connectors</Button>
      )}
    </section>
  );
}
