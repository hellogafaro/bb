import { useMemo, useState } from "react";
import type { PluginPendingInteractionProps } from "@get-bb/plugin-sdk/app";
import { Pill } from "@bb/shared-ui/pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  approvalPayloadSchema,
  type ElicitationField,
} from "../src/approval-contract";
import { RiskPill } from "./tool-policy";

type Answer = string | number | boolean;

function initialAnswers(fields: ElicitationField[]): Record<string, Answer> {
  const answers: Record<string, Answer> = {};
  for (const field of fields) {
    if (field.defaultValue !== null) answers[field.name] = field.defaultValue;
    else if (field.type === "boolean") answers[field.name] = false;
  }
  return answers;
}

function FieldInput({ field, value, onChange }: { field: ElicitationField; value: Answer | undefined; onChange: (value: Answer | undefined) => void }) {
  const id = `mcp-elicitation-${field.name}`;
  const label = field.title ?? field.name;
  if (field.type === "boolean") {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <input id={id} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
    );
  }
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">{label}{field.required ? " *" : ""}</label>
      {field.description ? <p className="text-xs text-muted-foreground">{field.description}</p> : null}
      {field.options ? (
        <select
          id={id}
          className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || undefined)}
        >
          <option value="">Choose…</option>
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <Input
          id={id}
          type={field.type === "string" ? "text" : "number"}
          step={field.type === "integer" ? 1 : "any"}
          className="h-8 text-sm"
          value={value === undefined ? "" : String(value)}
          onChange={(event) => {
            const raw = event.target.value;
            if (!raw) onChange(undefined);
            else onChange(field.type === "string" ? raw : Number(raw));
          }}
        />
      )}
    </div>
  );
}

export function McpApprovalInteraction({ interaction, submit, cancel }: PluginPendingInteractionProps) {
  const parsed = useMemo(() => approvalPayloadSchema.safeParse(interaction.payload), [interaction.payload]);
  const [answers, setAnswers] = useState<Record<string, Answer>>(() => parsed.success && parsed.data.kind === "elicitation" ? initialAnswers(parsed.data.fields) : {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (value: Parameters<typeof submit>[0]) => {
    setBusy(true);
    setError(null);
    try { await submit(value); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); setBusy(false); }
  };

  if (!parsed.success) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">This MCP request is invalid.</p>
        <Button variant="outline" onClick={() => void cancel().catch(() => undefined)}>Dismiss</Button>
      </div>
    );
  }

  const payload = parsed.data;
  if (payload.kind === "tool") {
    return (
      <div className="space-y-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <p className="min-w-0 truncate text-sm font-medium">{payload.server} / {payload.tool}</p>
          <RiskPill risk={payload.risk} />
        </div>
        <pre className="max-h-48 overflow-auto rounded-md border border-border bg-card p-2 font-mono text-xs">{payload.args}{payload.truncated ? "\n…" : ""}</pre>
        {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={() => void send({ approved: false })}>Deny</Button>
          <Button disabled={busy} onClick={() => void send({ approved: true })}>Approve</Button>
        </div>
      </div>
    );
  }

  const missing = payload.fields.some((field) => field.required && (answers[field.name] === undefined || answers[field.name] === ""));
  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-center gap-2">
        <Pill variant="outline" size="sm">{payload.server}</Pill>
        <p className="min-w-0 text-sm">{payload.message}</p>
      </div>
      <div className="space-y-3">
        {payload.fields.map((field) => (
          <FieldInput
            key={field.name}
            field={field}
            value={answers[field.name]}
            onChange={(value) => setAnswers((current) => {
              const next = { ...current };
              if (value === undefined) delete next[field.name]; else next[field.name] = value;
              return next;
            })}
          />
        ))}
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="outline" disabled={busy} onClick={() => void send({ action: "decline" })}>Decline</Button>
        <Button disabled={busy || missing} onClick={() => void send({ action: "accept", content: answers })}>Submit</Button>
      </div>
    </div>
  );
}
