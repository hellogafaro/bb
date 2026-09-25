import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceCollectionViewport,
  ResourceListState,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Switch } from "@bb/shared-ui/switch";
import { getMcpDetailRoutePath } from "@/components/tools/customize-navigation";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { useSetMcpServerEnabled } from "@/hooks/mutations/mcp-mutations";
import {
  useMcpServers,
  type McpServerListRow,
} from "@/hooks/queries/mcp-queries";
import { mcpTypeIcon, mcpTypeLabel } from "./mcp-display";
import { McpPagination } from "./McpPageShell";
import { McpProviderGuardNotice } from "./McpProviderGuardNotice";

const PAGE_SIZE = 50;

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
  const [query, setQuery] = useState("");
  const [requestedPage, setPage] = useState(0);
  const servers = serversQuery.data ?? null;

  const filtered = useMemo(() => {
    if (!servers) return null;
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? servers
      : servers.filter((server) => serverHaystack(server).includes(needle));
  }, [servers, query]);

  const total = filtered?.length ?? 0;
  const page = Math.min(
    requestedPage,
    Math.max(0, Math.ceil(total / PAGE_SIZE) - 1),
  );

  return (
    <ResourceCollectionViewport
      scrollId="customize-mcps-results"
      bandClassName={TOOLS_PAGE_BAND_CLASSES}
      toolbar={
        <ResourceToolbar
          searchValue={query}
          searchPlaceholder="Search MCPs"
          onSearchChange={(value) => {
            setQuery(value);
            setPage(0);
          }}
        />
      }
    >
      <div className={TOOLS_PAGE_BAND_CLASSES}>
        <McpProviderGuardNotice />
        {serversQuery.isError ? (
          <ResourceListState
            state="error"
            message="Couldn't load MCP servers."
            onRetry={() => void serversQuery.refetch()}
          />
        ) : (
          <McpServerList
            servers={servers}
            filtered={filtered}
            page={page}
            total={total}
            pending={setEnabled.isPending}
            onPage={setPage}
            onOpen={(server) => navigate(getMcpDetailRoutePath(server.id))}
            onEnabledChange={(server, enabled) =>
              setEnabled.mutate({ serverId: server.id, enabled })
            }
          />
        )}
      </div>
    </ResourceCollectionViewport>
  );
}

function McpServerList({
  servers,
  filtered,
  page,
  total,
  pending,
  onPage,
  onOpen,
  onEnabledChange,
}: {
  servers: McpServerListRow[] | null;
  filtered: McpServerListRow[] | null;
  page: number;
  total: number;
  pending: boolean;
  onPage: (page: number) => void;
  onOpen: (server: McpServerListRow) => void;
  onEnabledChange: (server: McpServerListRow, enabled: boolean) => void;
}) {
  return servers === null || filtered === null ? (
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
        : "No MCPs match this search."}
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
        onPage={onPage}
      />
    </div>
  );
}
