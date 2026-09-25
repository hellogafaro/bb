import { Button } from "@bb/shared-ui/button";
import { useFixProviderGuard } from "@/hooks/mutations/mcp-mutations";
import { useProviderGuard } from "@/hooks/queries/mcp-queries";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function McpProviderGuardNotice() {
  const guardQuery = useProviderGuard();
  const fix = useFixProviderGuard();
  const guard = guardQuery.data;
  if (!guard || guard.issues.length === 0) return null;
  const fixable = guard.issues.some((issue) => issue.fixable);
  const errorMessage = fix.error
    ? getMutationErrorMessage({
        error: fix.error,
        fallbackMessage: "Failed to lock down Claude Code and Codex",
      })
    : null;
  return (
    <section
      role="status"
      aria-label="Provider guard"
      className="mb-4 shrink-0 space-y-2 rounded-lg border border-border bg-card px-4 py-3"
    >
      <p className="text-sm font-medium">
        Claude Code / Codex still load their own MCPs, skills, or plugins on{" "}
        {guard.hostName}.
      </p>
      <ul className="space-y-1 text-xs text-muted-foreground">
        {guard.issues.map((issue) => (
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
      {fixable ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={fix.isPending}
          onClick={() => fix.mutate({ hostId: guard.hostId })}
        >
          Fix
        </Button>
      ) : null}
    </section>
  );
}
