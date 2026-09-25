import { Button } from "@bb/shared-ui/button";
import { useFixMcpProviders } from "@/hooks/mutations/mcp-mutations";
import { useMcpProviderStatus } from "@/hooks/queries/mcp-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function McpProviderGuardNotice() {
  const statusQuery = useMcpProviderStatus();
  const fix = useFixMcpProviders();
  const status = statusQuery.data;
  if (!status || status.issues.length === 0) return null;
  const errorMessage = fix.error
    ? getMutationErrorMessage({
        error: fix.error,
        fallbackMessage: "Failed to disable claude.ai connectors",
      })
    : null;
  return (
    <section
      role="status"
      aria-label="Provider MCP guard"
      className="mb-4 shrink-0 space-y-2 rounded-lg border border-border bg-card px-4 py-3"
    >
      <p className="text-sm font-medium">
        Claude Code or Codex can load MCPs outside this page
      </p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {status.issues.map((issue) => (
          <li key={issue.message} className="break-words">
            {issue.message}
          </li>
        ))}
      </ul>
      {errorMessage ? (
        <p role="alert" className="text-xs text-destructive">
          {errorMessage}
        </p>
      ) : null}
      {status.status.claude.connectorsDisabled ? null : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fix.isPending}
          onClick={() => fix.mutate({ hostId: status.hostId })}
        >
          Disable claude.ai connectors
        </Button>
      )}
    </section>
  );
}
