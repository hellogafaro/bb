import { useId, useState } from "react";
import type {
  CorePendingInteractionResolution,
  McpApprovalPendingInteractionPayload,
  McpElicitationField,
  McpElicitationPendingInteractionPayload,
  PendingInteraction,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Input } from "@bb/shared-ui/input";
import { Pill } from "@bb/shared-ui/pill";
import { cn } from "@bb/shared-ui/lib/utils";
import { McpRiskPill } from "@/components/mcp/McpToolPolicy";
import { getDetailScrollMaxHeightClass } from "@/components/ui/detail-scroll-size.js";
import { useResolveThreadPendingInteraction } from "@/hooks/mutations/thread-interaction-mutations";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  PendingInteractionShell,
  type PendingInteractionSourceThread,
} from "./PendingInteractionShell";

type Answer = string | number | boolean;
type Answers = Record<string, Answer>;

interface McpBannerProps<Payload> {
  interaction: PendingInteraction;
  payload: Payload;
  sourceThread?: PendingInteractionSourceThread;
  threadId: string;
}

function useMcpResolution({
  interaction,
  threadId,
  fallbackMessage,
}: {
  interaction: PendingInteraction;
  threadId: string;
  fallbackMessage: string;
}) {
  const resolvePendingInteraction = useResolveThreadPendingInteraction();
  const errorMessage = resolvePendingInteraction.error
    ? getMutationErrorMessage({
        error: resolvePendingInteraction.error,
        fallbackMessage,
        lifecycleOperation: "resolve_interaction",
      })
    : null;
  const submit = (resolution: CorePendingInteractionResolution): void => {
    void resolvePendingInteraction
      .mutateAsync({ threadId, interactionId: interaction.id, resolution })
      .catch(() => {});
  };
  return {
    errorMessage,
    submit,
    disabled:
      resolvePendingInteraction.isPending || interaction.status === "resolving",
  };
}

export function McpApprovalBanner({
  interaction,
  payload,
  sourceThread,
  threadId,
}: McpBannerProps<McpApprovalPendingInteractionPayload>) {
  const { errorMessage, submit, disabled } = useMcpResolution({
    interaction,
    threadId,
    fallbackMessage: "Failed to resolve MCP approval",
  });
  return (
    <PendingInteractionShell
      label="MCP approval"
      title={payload.title}
      initiallyExpanded
      errorMessage={errorMessage}
      sourceThread={sourceThread}
      testId="mcp-approval-banner"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => submit({ kind: "mcp_approval", allowed: false })}
          >
            Deny
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => submit({ kind: "mcp_approval", allowed: true })}
          >
            Allow
          </Button>
        </div>
      }
    >
      {() => (
        <div className="space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-sm font-medium">
              {payload.server} / {payload.tool}
            </p>
            <McpRiskPill risk={payload.risk} />
          </div>
          <pre
            className={cn(
              getDetailScrollMaxHeightClass("base"),
              "overflow-auto rounded-md border border-border bg-card p-2 font-mono text-xs",
            )}
          >
            {payload.args}
          </pre>
          {payload.truncated ? (
            <p className="text-xs text-muted-foreground">
              Arguments truncated for display.
            </p>
          ) : null}
        </div>
      )}
    </PendingInteractionShell>
  );
}

function initialAnswers(fields: readonly McpElicitationField[]): Answers {
  const answers: Answers = {};
  for (const field of fields) {
    if (field.defaultValue !== null) answers[field.name] = field.defaultValue;
    else if (field.type === "boolean") answers[field.name] = false;
  }
  return answers;
}

function fieldError(
  field: McpElicitationField,
  value: Answer | undefined,
): string | null {
  if (value === undefined || value === "") {
    return field.required ? "Required" : null;
  }
  if (field.type === "integer" && !Number.isInteger(value)) {
    return "Enter a whole number";
  }
  if (field.type === "number" && typeof value !== "number") {
    return "Enter a number";
  }
  return null;
}

function parseFieldInput(
  field: McpElicitationField,
  raw: string,
): Answer | undefined {
  if (raw === "") return undefined;
  if (field.type === "string") return raw;
  const parsed = Number(raw);
  return Number.isNaN(parsed) ? raw : parsed;
}

function ElicitationFieldInput({
  field,
  value,
  error,
  showError,
  onChange,
}: {
  field: McpElicitationField;
  value: Answer | undefined;
  error: string | null;
  showError: boolean;
  onChange: (value: Answer | undefined) => void;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const label = field.title ?? field.name;
  const invalid = showError && error !== null;
  if (field.type === "boolean") {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{label}</span>
      </label>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {field.required ? " *" : ""}
      </label>
      {field.description ? (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      ) : null}
      {field.options ? (
        <select
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">Choose…</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          type={field.type === "string" ? "text" : "number"}
          step={field.type === "integer" ? 1 : "any"}
          aria-invalid={invalid || undefined}
          aria-describedby={invalid ? errorId : undefined}
          className="h-8 text-sm"
          value={value === undefined ? "" : String(value)}
          onChange={(event) =>
            onChange(parseFieldInput(field, event.target.value))
          }
        />
      )}
      {invalid ? (
        <p id={errorId} className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function McpElicitationBanner({
  interaction,
  payload,
  sourceThread,
  threadId,
}: McpBannerProps<McpElicitationPendingInteractionPayload>) {
  const { errorMessage, submit, disabled } = useMcpResolution({
    interaction,
    threadId,
    fallbackMessage: "Failed to answer MCP request",
  });
  const [answers, setAnswers] = useState<Answers>(() =>
    initialAnswers(payload.fields),
  );
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const [attempted, setAttempted] = useState(false);
  const errors = new Map(
    payload.fields.map((field) => [
      field.name,
      fieldError(field, answers[field.name]),
    ]),
  );
  const invalid = [...errors.values()].some((error) => error !== null);

  const update = (name: string, value: Answer | undefined) => {
    setTouched((current) => new Set(current).add(name));
    setAnswers((current) => {
      const next = { ...current };
      if (value === undefined) delete next[name];
      else next[name] = value;
      return next;
    });
  };
  const accept = () => {
    setAttempted(true);
    if (invalid) return;
    submit({ kind: "mcp_elicitation", action: "accept", content: answers });
  };

  return (
    <PendingInteractionShell
      label="MCP request"
      title={payload.title}
      initiallyExpanded
      errorMessage={errorMessage}
      sourceThread={sourceThread}
      testId="mcp-elicitation-banner"
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() =>
              submit({ kind: "mcp_elicitation", action: "decline" })
            }
          >
            Decline
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={disabled || (attempted && invalid)}
            onClick={accept}
          >
            Submit
          </Button>
        </div>
      }
    >
      {() => (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            accept();
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Pill variant="outline" size="sm">
              {payload.server}
            </Pill>
            <p className="min-w-0 text-sm">{payload.message}</p>
          </div>
          {payload.fields.map((field) => (
            <ElicitationFieldInput
              key={field.name}
              field={field}
              value={answers[field.name]}
              error={errors.get(field.name) ?? null}
              showError={attempted || touched.has(field.name)}
              onChange={(value) => update(field.name, value)}
            />
          ))}
        </form>
      )}
    </PendingInteractionShell>
  );
}
