import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@bb/shared-ui/icon";
import {
  ResourceCollectionViewport,
  ResourceListState,
  ResourceToolbar,
} from "@bb/shared-ui/resource-list";
import {
  CustomizeCard,
  CustomizeCardGrid,
  CustomizeCardSkeletonGrid,
} from "@/components/customize/CustomizeCards";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import {
  useMcpServers,
  type McpServerListRow,
} from "@/hooks/queries/mcp-queries";
import { getMcpDetailRoutePath } from "@/lib/route-paths";
import { mcpTypeLabel } from "./mcp-display";
import { McpProviderGuardNotice } from "./McpProviderGuardNotice";

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

function serverSummary(server: McpServerListRow): string {
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

export function McpsView({ action }: { action?: ReactNode }) {
  const navigate = useNavigate();
  const serversQuery = useMcpServers();
  const [query, setQuery] = useState("");
  const servers = serversQuery.data ?? null;

  const filtered = useMemo(() => {
    if (!servers) return null;
    const needle = query.trim().toLowerCase();
    return needle === ""
      ? servers
      : servers.filter((server) => serverHaystack(server).includes(needle));
  }, [servers, query]);

  return (
    <ResourceCollectionViewport
      scrollId="mcps-results"
      bandClassName={TOOLS_PAGE_BAND_CLASSES}
      toolbar={
        <ResourceToolbar
          searchValue={query}
          searchPlaceholder="Search MCPs"
          onSearchChange={setQuery}
          action={action}
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
        ) : servers === null || filtered === null ? (
          <CustomizeCardSkeletonGrid label="Loading MCP servers" />
        ) : filtered.length === 0 ? (
          <ResourceListState
            state="empty"
            message={
              servers.length === 0
                ? "No MCP servers yet. Use New MCP to add one in chat."
                : "No MCPs match this search."
            }
          />
        ) : (
          <CustomizeCardGrid>
            {filtered.map((server) => (
              <div key={server.id} data-testid={`mcp-card-${server.id}`}>
                <CustomizeCard
                  className={server.enabled ? undefined : "opacity-60"}
                  leading={<Icon name="Connector" className="size-4" />}
                  title={server.name}
                  description={server.description || serverSummary(server)}
                  openLabel={server.name}
                  onOpen={() => navigate(getMcpDetailRoutePath(server.id))}
                />
              </div>
            ))}
          </CustomizeCardGrid>
        )}
      </div>
    </ResourceCollectionViewport>
  );
}
