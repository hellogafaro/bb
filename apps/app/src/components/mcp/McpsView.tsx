import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@bb/shared-ui/input";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceCreateButton,
  ResourceFilterMenu,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Switch } from "@bb/shared-ui/switch";
import { getMcpDetailRoutePath } from "@/components/tools/customize-navigation";
import { useSetMcpServerEnabled } from "@/hooks/mutations/mcp-mutations";
import {
  useMcpServers,
  type McpServerListRow,
} from "@/hooks/queries/mcp-queries";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { mcpTypeIcon, mcpTypeLabel } from "./mcp-display";
import { CREATE_MCP_PROMPT, MCP_CREATE_TEMPLATES } from "./mcp-prompts";
import { McpPageShell, McpPagination } from "./McpPageShell";
import { McpProviderGuardNotice } from "./McpProviderGuardNotice";

type TypeFilter = "http" | "sse" | "stdio";
type StatusFilter = "enabled" | "disabled";
type AuthFilter = "authenticated" | "needs-auth";

const PAGE_SIZE = 50;

const TYPE_OPTIONS: ReadonlyArray<{ id: TypeFilter; label: string }> = [
  { id: "http", label: "HTTP" },
  { id: "sse", label: "SSE" },
  { id: "stdio", label: "Command" },
];
const STATUS_OPTIONS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: "enabled", label: "Enabled" },
  { id: "disabled", label: "Disabled" },
];
const AUTH_OPTIONS: ReadonlyArray<{ id: AuthFilter; label: string }> = [
  { id: "authenticated", label: "Authenticated" },
  { id: "needs-auth", label: "Needs auth" },
];

function pickOptions<T extends string>(
  options: ReadonlyArray<{ id: T }>,
  values: readonly string[],
): T[] {
  return options
    .filter((option) => values.includes(option.id))
    .map((option) => option.id);
}

function typeFilterOf(server: McpServerListRow): TypeFilter {
  if (server.type === "stdio") return "stdio";
  return server.type === "sse" ? "sse" : "http";
}

function serverHaystack(server: McpServerListRow): string {
  return [
    server.name,
    server.handle,
    server.description,
    mcpTypeLabel(server.type),
    server.sourceRef,
    server.registryName,
    server.authStatus,
  ]
    .join(" ")
    .toLowerCase();
}

function serverSubtitle(server: McpServerListRow): string {
  return [
    mcpTypeLabel(server.type),
    server.enabled ? null : "disabled",
    server.authStatus !== "not-applicable" ? server.authStatus : null,
    server.toolCount !== null ? `${server.toolCount} tools` : null,
    server.lastError,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

function isRowAction(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest("[data-row-action]") !== null
  );
}

export function McpsView() {
  const navigate = useNavigate();
  const serversQuery = useMcpServers();
  const setEnabled = useSetMcpServerEnabled();
  const createViaChat = useCallback(
    (prompt?: string) => {
      navigate(getRootComposeRoutePath(), {
        state: {
          focusPrompt: true,
          initialPrompt: prompt ?? CREATE_MCP_PROMPT,
          replaceInitialPrompt: true,
        },
      });
    },
    [navigate],
  );

  return (
    <McpPageShell fill>
      <McpProviderGuardNotice />
      <div className="flex h-full min-h-0 flex-col gap-5">
        <div className="flex flex-wrap items-center justify-end gap-2 pr-3">
          <ResourceCreateButton
            label="New MCP"
            templates={MCP_CREATE_TEMPLATES}
            onCreate={createViaChat}
          />
        </div>
        <p className="pr-3 text-sm leading-5 text-muted-foreground">
          MCP servers every provider can use. Add new ones in chat with New MCP.
        </p>
        <div className="min-h-0 flex-1">
          {serversQuery.isError ? (
            <ResourceListState
              state="error"
              message="Couldn't load MCP servers."
              onRetry={() => void serversQuery.refetch()}
            />
          ) : (
            <McpServerList
              servers={serversQuery.data ?? null}
              pending={setEnabled.isPending}
              onOpen={(server) => navigate(getMcpDetailRoutePath(server.id))}
              onEnabledChange={(server, enabled) =>
                setEnabled.mutate({ serverId: server.id, enabled })
              }
            />
          )}
        </div>
      </div>
    </McpPageShell>
  );
}

function McpServerList({
  servers,
  pending,
  onOpen,
  onEnabledChange,
}: {
  servers: McpServerListRow[] | null;
  pending: boolean;
  onOpen: (server: McpServerListRow) => void;
  onEnabledChange: (server: McpServerListRow, enabled: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<TypeFilter[]>([]);
  const [statuses, setStatuses] = useState<StatusFilter[]>([]);
  const [auths, setAuths] = useState<AuthFilter[]>([]);
  const [requestedPage, setPage] = useState(0);

  const filtered = useMemo(() => {
    if (!servers) return null;
    const needle = query.trim().toLowerCase();
    return servers.filter((server) => {
      if (needle && !serverHaystack(server).includes(needle)) return false;
      if (types.length > 0 && !types.includes(typeFilterOf(server))) {
        return false;
      }
      if (
        statuses.length > 0 &&
        !statuses.includes(server.enabled ? "enabled" : "disabled")
      ) {
        return false;
      }
      if (auths.length > 0 && server.authStatus !== "not-applicable") {
        const auth: AuthFilter =
          server.authStatus === "authenticated"
            ? "authenticated"
            : "needs-auth";
        if (!auths.includes(auth)) return false;
      }
      return true;
    });
  }, [servers, query, types, statuses, auths]);

  const total = filtered?.length ?? 0;
  const page = Math.min(
    requestedPage,
    Math.max(0, Math.ceil(total / PAGE_SIZE) - 1),
  );
  const filterChange =
    <T extends string>(
      options: ReadonlyArray<{ id: T }>,
      update: (values: T[]) => void,
    ) =>
    (values: string[]) => {
      update(pickOptions(options, values));
      setPage(0);
    };

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 pr-3">
        <div className="relative w-full min-w-0 sm:w-auto sm:flex-1">
          <Icon
            name="Search"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Search MCPs"
            aria-label="Search MCPs"
            className="h-8 pl-8"
          />
        </div>
        <ResourceFilterMenu
          compact
          groups={[
            {
              id: "type",
              label: "Type",
              options: TYPE_OPTIONS,
              selectedValues: types,
              onChange: filterChange(TYPE_OPTIONS, setTypes),
            },
            {
              id: "status",
              label: "Status",
              options: STATUS_OPTIONS,
              selectedValues: statuses,
              onChange: filterChange(STATUS_OPTIONS, setStatuses),
            },
            {
              id: "auth",
              label: "Auth",
              options: AUTH_OPTIONS,
              selectedValues: auths,
              onChange: filterChange(AUTH_OPTIONS, setAuths),
            },
          ]}
        />
      </div>
      {servers === null || filtered === null ? (
        <div
          className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5"
          role="status"
          aria-label="Loading MCP servers"
        >
          <div className="divide-y divide-border">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                aria-hidden="true"
              >
                <Skeleton className="size-6 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {servers.length === 0
            ? "No MCP servers yet. Use New MCP to add one in chat."
            : "No MCPs match these filters."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5">
          <ul className="divide-y divide-border">
            {filtered
              .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
              .map((server) => (
                <li
                  key={server.id}
                  className={cn(
                    "group grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left first:pt-0 last:pb-0",
                    !server.enabled && "opacity-60",
                  )}
                  onClick={(event) => {
                    if (!isRowAction(event.target)) onOpen(server);
                  }}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center">
                    <Icon
                      name={mcpTypeIcon(server.type)}
                      className="size-4 text-muted-foreground"
                    />
                  </span>
                  <span className="min-w-0">
                    <button
                      type="button"
                      className="block max-w-full truncate text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(server);
                      }}
                    >
                      {server.name}
                    </button>
                    <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">
                      {serverSubtitle(server)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span
                      data-row-action=""
                      className="flex items-center"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Switch
                        checked={server.enabled}
                        disabled={pending}
                        aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                        onCheckedChange={(enabled) =>
                          onEnabledChange(server, enabled)
                        }
                      />
                    </span>
                    <Icon
                      name="ChevronRight"
                      className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    />
                  </span>
                </li>
              ))}
          </ul>
          <McpPagination
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            label="servers"
            onPage={setPage}
          />
        </div>
      )}
    </div>
  );
}
