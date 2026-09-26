import { useState } from "react";
import type { McpToolRisk } from "@bb/domain";
import type { McpToolPolicy } from "@bb/server-contract";
import type { McpServerToolsResult } from "@bb/sdk";

type McpCompactTool = McpServerToolsResult["tools"][number];
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import { Pill } from "@bb/shared-ui/pill";
import { Switch } from "@bb/shared-ui/switch";
import { McpRiskPill } from "./McpRiskPill";

type PolicyMode = McpToolPolicy["mode"];
type GroupId = "read" | "write";
type GroupPolicy = Exclude<PolicyMode, "deny">;

export interface McpToolPolicyChange {
  tool: string;
  mode: PolicyMode;
}

const GROUPS: readonly { id: GroupId; title: string; risks: McpToolRisk[] }[] =
  [
    { id: "read", title: "Read tools", risks: ["read"] },
    { id: "write", title: "Write tools", risks: ["write", "destructive"] },
  ];

const GROUP_POLICY_LABEL: Record<GroupPolicy, string> = {
  inherit: "Default",
  allow: "Run automatically",
  confirm: "Ask first",
};

const GROUP_POLICIES: readonly GroupPolicy[] = ["inherit", "allow", "confirm"];

function isGroupPolicy(value: string): value is GroupPolicy {
  return GROUP_POLICIES.some((policy) => policy === value);
}

function defaultPolicyLabel(group: GroupId): string {
  return group === "read" ? "Run automatically" : "Ask first";
}

export function groupToolsByRisk(tools: readonly McpCompactTool[]) {
  return GROUPS.map((group) => ({
    ...group,
    tools: tools.filter((tool) => group.risks.includes(tool.risk)),
  })).filter((group) => group.tools.length > 0);
}

export function resolveGroupPolicy(
  tools: readonly McpCompactTool[],
  policies: ReadonlyMap<string, McpToolPolicy>,
): GroupPolicy | "mixed" {
  const modes = new Set(
    tools
      .map((tool) => policies.get(tool.name)?.mode ?? "inherit")
      .filter((mode): mode is GroupPolicy => mode !== "deny"),
  );
  if (modes.size === 0) return "inherit";
  if (modes.size > 1) return "mixed";
  return [...modes][0] ?? "inherit";
}

function toolEnabled(
  tool: McpCompactTool,
  policies: ReadonlyMap<string, McpToolPolicy>,
): boolean {
  return (policies.get(tool.name)?.mode ?? "inherit") !== "deny";
}

export function McpToolGroup({
  group,
  policies,
  pending,
  onChange,
}: {
  group: ReturnType<typeof groupToolsByRisk>[number];
  policies: ReadonlyMap<string, McpToolPolicy>;
  pending: boolean;
  onChange: (changes: McpToolPolicyChange[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const enabledTools = group.tools.filter((tool) =>
    toolEnabled(tool, policies),
  );
  const groupPolicy = resolveGroupPolicy(group.tools, policies);
  const restoreMode: PolicyMode =
    groupPolicy === "mixed" ? "inherit" : groupPolicy;
  const allEnabled = enabledTools.length === group.tools.length;
  const bodyId = `mcp-tools-${group.id}`;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon
            name="ChevronDown"
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
          <span className="text-sm font-medium">{group.title}</span>
          <Pill variant="secondary" size="sm">
            {enabledTools.length} of {group.tools.length} enabled
          </Pill>
        </button>
        <select
          aria-label={`${group.title} policy`}
          className="h-7 shrink-0 rounded-md border border-input bg-transparent px-2 text-xs"
          value={groupPolicy}
          disabled={pending || enabledTools.length === 0}
          onChange={(event) => {
            const value = event.target.value;
            if (!isGroupPolicy(value)) return;
            onChange(
              enabledTools.map((tool) => ({ tool: tool.name, mode: value })),
            );
          }}
        >
          {groupPolicy === "mixed" ? (
            <option value="mixed" disabled>
              Mixed
            </option>
          ) : null}
          <option value="inherit">{`${GROUP_POLICY_LABEL.inherit} (${defaultPolicyLabel(group.id)})`}</option>
          <option value="allow">{GROUP_POLICY_LABEL.allow}</option>
          <option value="confirm">{GROUP_POLICY_LABEL.confirm}</option>
        </select>
      </div>
      {open ? (
        <div id={bodyId} className="border-t border-border px-3 pb-1 pt-2">
          <div className="flex items-center justify-between gap-3 pb-1">
            <span className="text-xs text-muted-foreground">
              Customize selection
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              disabled={pending}
              onClick={() =>
                onChange(
                  group.tools.map((tool) => ({
                    tool: tool.name,
                    mode: allEnabled ? "deny" : restoreMode,
                  })),
                )
              }
            >
              {allEnabled ? "Disable all" : "Enable all"}
            </Button>
          </div>
          <ul className="divide-y divide-border">
            {group.tools.map((tool) => {
              const enabled = toolEnabled(tool, policies);
              return (
                <li
                  key={tool.id}
                  className="flex min-w-0 items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p
                        className={cn(
                          "truncate text-sm font-medium",
                          !enabled && "text-muted-foreground",
                        )}
                      >
                        {tool.name}
                      </p>
                      {tool.risk === "destructive" ? (
                        <McpRiskPill risk={tool.risk} />
                      ) : null}
                    </div>
                    {tool.description ? (
                      <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                        {tool.description}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    checked={enabled}
                    disabled={pending}
                    aria-label={`${enabled ? "Disable" : "Enable"} ${tool.name}`}
                    onCheckedChange={(next) =>
                      onChange([
                        { tool: tool.name, mode: next ? restoreMode : "deny" },
                      ])
                    }
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
