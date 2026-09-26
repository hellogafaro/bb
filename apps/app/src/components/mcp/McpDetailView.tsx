import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RiAtLine } from "react-icons/ri";
import type { McpServer } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceIconFrame,
  ResourceListState,
  ResourceOverflowMenu,
  useResourceRouteLabel,
  type ResourceOverflowMenuItem,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Switch } from "@bb/shared-ui/switch";
import { CUSTOMIZE_CARD_AVATAR_CLASS_NAME } from "@/components/customize/CustomizeCards";
import {
  ConfirmDeleteDialog,
  ConfirmDeleteDialogContent,
} from "@/components/dialogs/ConfirmDeleteDialog";
import { appToast } from "@/components/ui/app-toast";
import {
  useAuthenticateMcpServer,
  useReconnectMcpServer,
  useRemoveMcpServer,
  useSetMcpServerEnabled,
  useSetMcpServerHeaders,
  useSetMcpToolPolicies,
} from "@/hooks/mutations/mcp-mutations";
import {
  useMcpServer,
  useMcpServerTools,
  useMcpToolPolicies,
} from "@/hooks/queries/mcp-queries";
import { getMcpsRoutePath, getRootComposeRoutePath } from "@/lib/route-paths";
import { BbHttpError } from "@/lib/sdk";
import { reserveMcpAuthWindow } from "./mcp-auth-window";
import { mcpNeedsSignIn, mcpTypeIcon, mcpTypeLabel } from "./mcp-display";
import { buildMcpEditThreadPrompt } from "./mcp-prompts";
import { McpHeadersEditor } from "./McpHeadersEditor";
import { McpPageShell } from "./McpPageShell";
import { groupToolsByRisk, McpToolGroup } from "./McpToolGroups";

const MCP_UPDATED_TOAST = "MCP updated";

const AUTH_STATUS_TEXT: Record<McpServer["authStatus"], string> = {
  "not-applicable": "No sign-in needed.",
  unknown: "Sign-in state is not known yet.",
  unauthenticated: "Sign in to load this server's tools.",
  authorizing: "Waiting for sign-in to finish in the browser.",
  authenticated: "Signed in.",
};

function isNotFound(error: unknown): boolean {
  return error instanceof BbHttpError && error.status === 404;
}

export function McpDetailView({ serverRef }: { serverRef: string }) {
  const navigate = useNavigate();
  const serverQuery = useMcpServer(serverRef);
  const server = serverQuery.data ?? null;
  useResourceRouteLabel(server?.name ?? null);
  const backToList = useCallback(
    () => navigate(getMcpsRoutePath()),
    [navigate],
  );

  if (serverQuery.isError) {
    return (
      <McpPageShell>
        {isNotFound(serverQuery.error) ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">That MCP is gone.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={backToList}
            >
              Back to MCPs
            </Button>
          </div>
        ) : (
          <ResourceListState
            state="error"
            message="Couldn't load MCP."
            layout="detail"
            onRetry={() => void serverQuery.refetch()}
          />
        )}
      </McpPageShell>
    );
  }

  return (
    <McpPageShell>
      {server === null ? (
        <div className="space-y-3" role="status" aria-label="Loading MCP">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : (
        <McpServerDetail server={server} onRemoved={backToList} />
      )}
    </McpPageShell>
  );
}

function McpServerDetail({
  server,
  onRemoved,
}: {
  server: McpServer;
  onRemoved: () => void;
}) {
  const navigate = useNavigate();
  const setEnabled = useSetMcpServerEnabled();
  const authenticate = useAuthenticateMcpServer();
  const reconnect = useReconnectMcpServer();
  const remove = useRemoveMcpServer();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const busy =
    setEnabled.isPending ||
    authenticate.isPending ||
    reconnect.isPending ||
    remove.isPending;
  const remote = server.config.type !== "stdio";

  const editInChat = () => {
    navigate(getRootComposeRoutePath(), {
      state: {
        focusPrompt: true,
        initialPrompt: buildMcpEditThreadPrompt({
          name: server.name,
          id: server.id,
          handle: server.handle,
        }),
        replaceInitialPrompt: true,
      },
    });
  };

  const signIn = () => {
    const authWindow = reserveMcpAuthWindow();
    authenticate.mutate(
      { serverId: server.id },
      {
        onSuccess: (result) => {
          if (result.url === null) {
            authWindow.close();
            return;
          }
          authWindow.open(result.url);
        },
        onError: () => authWindow.close(),
      },
    );
  };

  const reconnectServer = () => {
    reconnect.mutate(
      { serverId: server.id },
      {
        onSuccess: (result) => {
          const url = result.url;
          if (url === null) {
            appToast.success("MCP reconnected");
            return;
          }
          appToast.message("Sign in to finish reconnecting", {
            action: {
              label: "Sign in",
              onClick: () => reserveMcpAuthWindow().open(url),
            },
          });
        },
      },
    );
  };

  const removeServer = () => {
    remove.mutate(
      { serverId: server.id },
      {
        onSuccess: () => {
          setConfirmingRemove(false);
          appToast.success("MCP removed");
          onRemoved();
        },
      },
    );
  };

  const menuItems: ResourceOverflowMenuItem[] = [
    {
      label: "Edit in chat",
      icon: "MessageCirclePlus",
      onSelect: editInChat,
    },
    ...(remote
      ? [
          {
            label:
              server.authStatus === "authenticated"
                ? "Re-authenticate"
                : "Authenticate",
            icon: "Lock" as const,
            disabled: busy,
            onSelect: signIn,
          },
        ]
      : []),
    {
      label: "Reconnect",
      icon: "RefreshCw",
      disabled: busy || !server.enabled,
      onSelect: reconnectServer,
    },
    { kind: "separator" },
    {
      label: "Remove",
      icon: "Trash2",
      tone: "destructive",
      disabled: busy,
      onSelect: () => setConfirmingRemove(true),
    },
  ];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <ResourceIconFrame
            className={cn(
              CUSTOMIZE_CARD_AVATAR_CLASS_NAME,
              "size-8 rounded-md",
            )}
          >
            {() => <Icon name="Connector" className="size-5" aria-hidden />}
          </ResourceIconFrame>
          <div className="min-w-0 flex-1 space-y-1">
            <h1 className="min-w-0 truncate text-base font-semibold leading-8">
              {server.name}
            </h1>
            <div className="text-xs text-subtle-foreground">
              <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="inline-flex h-4 min-w-0 items-center gap-1.5 whitespace-nowrap leading-4">
                  <RiAtLine className="size-3.5 shrink-0" aria-label="Handle" />
                  <span className="min-w-0 truncate" title={server.id}>
                    {server.handle}
                  </span>
                </span>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex h-4 min-w-0 items-center gap-1.5 whitespace-nowrap leading-4">
                    <Icon
                      name={mcpTypeIcon(server.type)}
                      className="size-3.5 shrink-0"
                      aria-label="Connection type"
                    />
                    <span>
                      {server.type === "stdio"
                        ? "stdio"
                        : mcpTypeLabel(server.type)}
                    </span>
                  </span>
                </span>
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-1.5">
          <Switch
            checked={server.enabled}
            disabled={busy}
            aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
            onCheckedChange={(enabled) =>
              setEnabled.mutate(
                { serverId: server.id, enabled },
                { onSuccess: () => appToast.success(MCP_UPDATED_TOAST) },
              )
            }
          />
          <ResourceOverflowMenu
            label={`${server.name} actions`}
            items={menuItems}
          />
        </div>
      </div>
      {server.lastError ? (
        <p role="alert" className="text-sm text-destructive">
          {server.lastError}
        </p>
      ) : null}
      {remote && server.authStatus !== "not-applicable" ? (
        <McpAuthSection
          server={server}
          pending={authenticate.isPending}
          onSignIn={signIn}
        />
      ) : null}
      <McpSettingsSection server={server} />
      <McpToolsSection server={server} />
      <ConfirmDeleteDialog
        open={confirmingRemove}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setConfirmingRemove(false);
        }}
      >
        <ConfirmDeleteDialogContent
          title="Remove MCP?"
          description={`“${server.name}” will be removed from BB. You can add it again later.`}
          confirmLabel="Remove"
          pending={remove.isPending}
          onConfirm={removeServer}
          onCancel={() => setConfirmingRemove(false)}
        />
      </ConfirmDeleteDialog>
    </div>
  );
}

function McpAuthSection({
  server,
  pending,
  onSignIn,
}: {
  server: McpServer;
  pending: boolean;
  onSignIn: () => void;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-foreground">Sign-in</h2>
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3.5">
        <p className="min-w-0 text-sm text-muted-foreground">
          {AUTH_STATUS_TEXT[server.authStatus]}
        </p>
        {server.authStatus === "authenticated" ? null : (
          <Button
            type="button"
            size="sm"
            variant={mcpNeedsSignIn(server.authStatus) ? "default" : "outline"}
            disabled={pending}
            onClick={onSignIn}
          >
            Sign in
          </Button>
        )}
      </div>
    </section>
  );
}

function SettingsRows({
  rows,
}: {
  rows: ReadonlyArray<{ label: string; value: string }>;
}) {
  return (
    <dl className="divide-y divide-border">
      {rows.map((row) => (
        <div
          key={row.label}
          className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
        >
          <dt className="shrink-0 text-sm">{row.label}</dt>
          <dd
            className="min-w-0 truncate text-right text-sm text-muted-foreground"
            title={row.value}
          >
            {row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function McpSettingsSection({ server }: { server: McpServer }) {
  const setHeaders = useSetMcpServerHeaders();
  const config = server.config;
  if (config.type === "stdio") {
    const envNames = Object.keys(config.env);
    const rows = [
      { label: "Command", value: config.command },
      ...(config.args.length > 0
        ? [{ label: "Arguments", value: config.args.join(" ") }]
        : []),
      ...(config.cwd
        ? [{ label: "Working directory", value: config.cwd }]
        : []),
      ...(envNames.length > 0
        ? [{ label: "Environment", value: envNames.join(", ") }]
        : []),
    ];
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-foreground">Settings</h2>
        <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5">
          <SettingsRows rows={rows} />
        </div>
      </section>
    );
  }
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-foreground">Settings</h2>
      <div className="space-y-3 overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5">
        <SettingsRows rows={[{ label: "URL", value: config.url }]} />
        <div className="space-y-2 border-t border-border pt-2.5">
          <h3 className="text-sm">Headers</h3>
          <McpHeadersEditor
            key={server.id}
            serverName={server.name}
            headerNames={Object.keys(config.headers)}
            pending={setHeaders.isPending}
            onSave={async (headers) => {
              await setHeaders.mutateAsync({ serverId: server.id, headers });
              appToast.success(MCP_UPDATED_TOAST);
            }}
          />
        </div>
      </div>
    </section>
  );
}

function McpToolsSection({ server }: { server: McpServer }) {
  const toolsQuery = useMcpServerTools(server.id);
  const policiesQuery = useMcpToolPolicies(server.id);
  const setPolicies = useSetMcpToolPolicies();
  const tools = toolsQuery.data?.tools ?? null;
  const catalogError =
    toolsQuery.data?.error ??
    (toolsQuery.isError ? "Couldn't load tools." : null);
  const policies = new Map(
    (policiesQuery.data ?? []).map((policy) => [policy.tool, policy]),
  );

  return (
    <section data-resource-detail-section="definition" className="space-y-3">
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-sm font-medium text-foreground">Tools</h2>
        <p className="text-xs text-muted-foreground">
          Choose which tools agents can use and whether they run automatically
          or ask first.
        </p>
      </div>
      {tools === null && !toolsQuery.isError ? (
        <div
          className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5"
          role="status"
          aria-label="Loading tools"
        >
          <div className="divide-y divide-border">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="space-y-2 py-2.5 first:pt-0 last:pb-0"
                aria-hidden="true"
              >
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>
      ) : tools === null || tools.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {catalogError ??
            (mcpNeedsSignIn(server.authStatus)
              ? "Authenticate to load tools."
              : "No tools reported yet.")}
        </p>
      ) : (
        <div className="space-y-3">
          {groupToolsByRisk(tools).map((group) => (
            <McpToolGroup
              key={group.id}
              group={group}
              policies={policies}
              pending={setPolicies.isPending}
              onChange={(changes) =>
                setPolicies.mutate(
                  { serverId: server.id, changes },
                  { onSuccess: () => appToast.success(MCP_UPDATED_TOAST) },
                )
              }
            />
          ))}
        </div>
      )}
      {policiesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Couldn't load tool policies.
        </p>
      ) : null}
      {catalogError && tools && tools.length > 0 ? (
        <p role="alert" className="text-sm text-destructive">
          {catalogError}
        </p>
      ) : null}
    </section>
  );
}
