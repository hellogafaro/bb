import { RiAtLine } from "react-icons/ri";
import { readRpc } from "./lib/read-rpc";
import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { definePluginApp, useBbNavigate, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";
import { crumbsForRoute, detailPath, parseRoute, publishDetailLabel, subscribeDetailLabel } from "@/lib/route";
import { buildMcpEditThreadPrompt, CREATE_MCP_PROMPT, MCP_CREATE_TEMPLATES } from "@/lib/prompts";
import { McpApprovalInteraction } from "@/components/mcp-approval";
import { ProviderGuardNotice } from "@/components/provider-guard";
import { RiskPill, ToolPolicySelect, useToolPolicies } from "@/components/tool-policy";
import { APPROVAL_RENDERER_ID } from "@/src/approval-contract";
import { ResourceCreateButton } from "@bb/shared-ui/resource-list";
import { Textarea } from "@bb/shared-ui/textarea";
import { usePortalScopeProps } from "@/lib/portal-scope";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@bb/shared-ui/icon";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ServerRow = {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  type: string;
  status: string;
  sourceKind: string;
  enabled: boolean;
  authStatus: string;
  lastError: string | null;
  sourceRef: string | null;
  registryName: string | null;
  registryVersion: string | null;
  configJson: string;
  toolCount: number | null;
  guide: string | null;
};

type CompactTool = {
  id: string;
  name: string;
  description: string;
  risk: "read" | "write" | "destructive";
};

type TypeFilter = "http" | "sse" | "stdio";
type StatusFilter = "enabled" | "disabled";
type AuthFilter = "authenticated" | "needs-auth";

const TYPE_FILTERS: Array<[TypeFilter, string]> = [
  ["http", "HTTP"],
  ["sse", "SSE"],
  ["stdio", "Command"],
];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRowAction(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-row-action]"));
}

function typeLabel(type: string): string {
  if (type === "stdio") return "Command";
  if (type === "sse") return "SSE";
  return "HTTP";
}

function typeIcon(type: string): "Terminal" | "Globe" {
  return type === "stdio" ? "Terminal" : "Globe";
}

function stdioConfig(configJson: string): { command: string; args: string[]; cwd: string | null } | null {
  try {
    const cfg = JSON.parse(configJson) as { type?: unknown; command?: unknown; args?: unknown; cwd?: unknown };
    if (cfg.type !== "stdio" || typeof cfg.command !== "string" || cfg.command.length === 0) return null;
    const args = Array.isArray(cfg.args) ? cfg.args.filter((item): item is string => typeof item === "string") : [];
    const cwd = typeof cfg.cwd === "string" && cfg.cwd !== "" && cfg.cwd !== "${PLUGIN_DATA}" ? cfg.cwd : null;
    return { command: cfg.command, args, cwd };
  } catch {
    return null;
  }
}

function toggleFilter<T extends string>(values: T[], id: T, onChange: (next: T[]) => void) {
  onChange(values.includes(id) ? values.filter((item) => item !== id) : [...values, id]);
}

const FilterButton = forwardRef<
  HTMLButtonElement,
  { active: boolean; label: string } & ButtonHTMLAttributes<HTMLButtonElement>
>(function FilterButton({ active, label, className, ...props }, ref) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      size="icon"
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "size-8 shrink-0 rounded-md p-0 text-muted-foreground data-[state=open]:bg-state-active data-[state=open]:text-foreground data-[state=open]:hover:bg-state-active",
        active && "bg-state-active text-foreground hover:bg-state-active",
        className,
      )}
      {...props}
    >
      <Icon name="SlidersHorizontal" className="size-4" />
    </Button>
  );
});

function serverHaystack(server: ServerRow): string {
  return [server.name, server.description, server.type, server.sourceRef, server.registryName, server.authStatus].join(" ").toLowerCase();
}

const CRUMB_LINK =
  "-mx-2 inline-flex min-h-7 shrink-0 cursor-pointer items-center rounded-md px-2 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring [app-region:no-drag] [-webkit-app-region:no-drag]";

function HeaderCrumbs({ subPath }: { subPath: string }) {
  const nav = useBbNavigate();
  const scope = usePortalScopeProps();
  const route = parseRoute(subPath);
  const [name, setName] = useState<string | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  useEffect(() => subscribeDetailLabel(setName), []);

  const pluginAttr = scope["data-bb-plugin"];
  const rootAttr = scope["data-bb-plugin-root"];

  useLayoutEffect(() => {
    const row = document.querySelector("[data-testid='app-page-header-content-row']");
    const inner = row?.firstElementChild?.firstElementChild;
    if (!(inner instanceof HTMLElement)) return;
    const mount = document.createElement("div");
    mount.dataset.mcpsHeaderCrumbs = "";
    if (rootAttr !== undefined) mount.setAttribute("data-bb-plugin-root", "");
    if (pluginAttr !== undefined) mount.setAttribute("data-bb-plugin", pluginAttr);
    mount.className = "min-w-0 max-w-full";
    const hidden: HTMLElement[] = [];
    for (const child of Array.from(inner.children)) {
      if (child instanceof HTMLElement) {
        child.hidden = true;
        hidden.push(child);
      }
    }
    inner.append(mount);
    setHost(mount);
    return () => {
      mount.remove();
      for (const child of hidden) child.hidden = false;
      setHost(null);
    };
  }, [pluginAttr, rootAttr]);

  const crumbs = crumbsForRoute(route, name);
  if (host === null) return null;
  return createPortal(
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1.5 text-sm font-semibold">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? <Icon name="ChevronRight" className="size-3.5 shrink-0 text-subtle-foreground" /> : null}
              {!last && crumb.subPath !== undefined ? (
                <button
                  type="button"
                  className={CRUMB_LINK}
                  onClick={() => nav.toPluginPanel("mcps", { subPath: crumb.subPath })}
                >
                  {crumb.label}
                </button>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "min-w-0 truncate" : "shrink-0 text-muted-foreground"}>
                  {crumb.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>,
    host,
  );
}

function PageShell({ fill, children }: { fill?: boolean; children: ReactNode }) {
  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className={cn("mx-auto box-border min-h-full w-full max-w-5xl px-4 pb-4 pt-3 md:px-5 md:pt-4", fill && "h-full")}>
        {children}
      </div>
    </div>
  );
}

function CollectionChrome({
  actions,
  children,
}: {
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-end gap-2 pr-3">
        {actions}
      </div>
      <p className="pr-3 text-sm leading-5 text-muted-foreground">
        MCP servers every provider can use. Add new ones in chat with New MCP.
      </p>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

function MenuRow({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <>
      <Icon name={icon} className="size-4 shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </>
  );
}

function RemoveDialog({
  name,
  pending,
  onOpenChange,
  onConfirm,
}: {
  name: string | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={name !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove MCP?</AlertDialogTitle>
          <AlertDialogDescription>
            “{name}” will be removed from BB. You can add it again later.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            disabled={pending}
            onClick={onConfirm}
          >
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Pagination({ page, total, onPage, label }: { page: number; total: number; onPage: (page: number) => void; label: string }) {
  if (total <= 50) return null;
  return <div className="flex items-center justify-between gap-3">
    <Button size="sm" variant="outline" aria-label={`Previous ${label}`} disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
    <span className="text-xs text-muted-foreground">{page * 50 + 1}–{Math.min((page + 1) * 50, total)} of {total}</span>
    <Button size="sm" variant="outline" aria-label={`Next ${label}`} disabled={(page + 1) * 50 >= total} onClick={() => onPage(page + 1)}>Next</Button>
  </div>;
}

function useServers() {
  const rpc = useRpc<typeof rpcContract>();
  const [servers, setServers] = useState<ServerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const refetch = useCallback(() => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    readRpc("snapshot", null, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setServers(result.servers);
      setError(null);
    }, (cause) => { if (!controller.signal.aborted) setError(errorText(cause)); });
  }, []);
  useEffect(() => { refetch(); return () => request.current?.abort(); }, [refetch]);
  useRealtime("mcps-changed", refetch);
  return { rpc, servers, error, setError, refetch };
}

function InstalledList({
  servers,
  pending,
  onOpen,
  onEnabledChange,
}: {
  servers: ServerRow[] | null;
  pending: string | null;
  onOpen: (id: string) => void;
  onEnabledChange: (id: string, enabled: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<TypeFilter[]>([]);
  const [statuses, setStatuses] = useState<StatusFilter[]>([]);
  const [auths, setAuths] = useState<AuthFilter[]>([]);

  const filtered = useMemo(() => {
    if (!servers) return null;
    const q = query.trim().toLowerCase();
    return servers.filter((server) => {
      if (q && !serverHaystack(server).includes(q)) return false;
      if (types.length > 0) {
        const kind: TypeFilter = server.type === "stdio" ? "stdio" : server.type === "sse" ? "sse" : "http";
        if (!types.includes(kind)) return false;
      }
      if (statuses.length > 0) {
        const status: StatusFilter = server.enabled ? "enabled" : "disabled";
        if (!statuses.includes(status)) return false;
      }
      if (auths.length > 0 && server.authStatus !== "not-applicable") {
        const auth: AuthFilter = server.authStatus === "authenticated" ? "authenticated" : "needs-auth";
        if (!auths.includes(auth)) return false;
      }
      return true;
    });
  }, [servers, query, types, statuses, auths]);

  const [requestedPage, setPage] = useState(0);
  useEffect(() => setPage(0), [query, types, statuses, auths]);
  const page = Math.min(requestedPage, Math.max(0, Math.ceil((filtered?.length ?? 0) / 50) - 1));
  const filtersActive = types.length + statuses.length + auths.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 pr-3">
        <div className="relative w-full min-w-0 sm:w-auto sm:flex-1">
          <Icon name="Search" className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search MCPs"
            aria-label="Search MCPs"
            className="h-8 pl-8"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <FilterButton active={filtersActive} label={filtersActive ? "Filters on" : "Filters"} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max max-w-64">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Type</DropdownMenuLabel>
            {TYPE_FILTERS.map(([id, label]) => (
              <DropdownMenuCheckboxItem
                key={id}
                checked={types.includes(id)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggleFilter(types, id, setTypes)}
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Status</DropdownMenuLabel>
            {([
              ["enabled", "Enabled"],
              ["disabled", "Disabled"],
            ] as const).map(([id, label]) => (
              <DropdownMenuCheckboxItem
                key={id}
                checked={statuses.includes(id)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggleFilter(statuses, id, setStatuses)}
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Auth</DropdownMenuLabel>
            {([
              ["authenticated", "Authenticated"],
              ["needs-auth", "Needs auth"],
            ] as const).map(([id, label]) => (
              <DropdownMenuCheckboxItem
                key={id}
                checked={auths.includes(id)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggleFilter(auths, id, setAuths)}
              >
                {label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {servers === null ? (
        <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5" role="status" aria-label="Loading MCP servers">
          <div className="divide-y divide-border">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0" aria-hidden="true">
                <Skeleton className="size-6 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : filtered && filtered.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
          {servers.length === 0 ? "No MCP servers yet. Use New MCP to add one in chat." : "No MCPs match these filters."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5">
          <ul className="divide-y divide-border">
            {filtered?.slice(page * 50, (page + 1) * 50).map((server) => (
              <li
                key={server.id}
                className={cn(
                  "group grid cursor-pointer grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-left first:pt-0 last:pb-0",
                  !server.enabled && "opacity-60",
                )}
                onClick={(event) => { if (!isRowAction(event.target)) onOpen(server.id); }}
              >
                <span className="flex size-6 shrink-0 items-center justify-center">
                  <Icon name={typeIcon(server.type)} className="size-4 text-muted-foreground" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">{server.name}</span>
                  <span className="mt-0.5 block truncate text-xs leading-snug text-muted-foreground">
                    {typeLabel(server.type)}
                    {server.enabled ? "" : " · disabled"}
                    {server.authStatus !== "not-applicable" ? ` · ${server.authStatus}` : ""}
                    {server.toolCount !== null ? ` · ${server.toolCount} tools` : ""}
                    {server.lastError ? ` · ${server.lastError}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <span data-row-action="" className="flex items-center" onClick={(event) => event.stopPropagation()}>
                    <Switch
                      checked={server.enabled}
                      disabled={pending !== null}
                      aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
                      onCheckedChange={(enabled) => onEnabledChange(server.id, enabled)}
                    />
                  </span>
                  <Icon name="ChevronRight" className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
              </li>
            ))}
          </ul>
          <Pagination page={page} total={filtered?.length ?? 0} onPage={setPage} label="servers" />
        </div>
      )}
    </div>
  );
}

function DetailPage({
  id,
  servers,
  pending,
  onBack,
  onEnabledChange,
  onRemove,
  onAuth,
  onEditInChat,
  onSaveGuide,
}: {
  id: string;
  servers: ServerRow[] | null;
  pending: string | null;
  onBack: () => void;
  onEnabledChange: (id: string, enabled: boolean) => void;
  onRemove: (server: ServerRow) => void;
  onAuth: (id: string) => void;
  onEditInChat: (server: ServerRow) => void;
  onSaveGuide: (id: string, guide: string | null) => void;
}) {
  const server = servers?.find((item) => (item.id === id || item.handle === id)) ?? null;
  const [tools, setTools] = useState<CompactTool[] | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [toolPage, setToolPage] = useState(0);
  const toolPolicies = useToolPolicies(id, tools);
  const savedGuide = server?.guide ?? "";
  const [guideDraft, setGuideDraft] = useState(savedGuide);
  useEffect(() => setGuideDraft(savedGuide), [savedGuide]);

  useEffect(() => {
    const controller = new AbortController();
    setTools(null);
    setToolPage(0);
    setCatalogError(null);
    readRpc("inspectServer", { id }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setTools(result.tools);
      setCatalogError(result.error);
    }, (cause) => {
      if (controller.signal.aborted) return;
      setTools([]);
      setCatalogError(errorText(cause));
    });
    return () => controller.abort();
  }, [id, server?.status, server?.authStatus, server?.enabled]);

  if (servers !== null && server === null) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">That MCP is gone.</p>
        <Button type="button" variant="outline" size="sm" onClick={onBack}>Back to Installed</Button>
      </div>
    );
  }

  if (!server) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const local = stdioConfig(server.configJson);
  const localRows = local ? [
    { label: "Command", value: local.command },
    ...(local.args.length > 0 ? [{ label: "Arguments", value: local.args.join(" ") }] : []),
    ...(local.cwd ? [{ label: "Working directory", value: local.cwd }] : []),
  ] : [];

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="flex size-4 shrink-0 items-center justify-center">
              <Icon name={typeIcon(server.type)} className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            </span>
            <h1 className="min-w-0 truncate text-base font-semibold">{server.name}</h1>
          </div>
          <div className="text-xs text-subtle-foreground">
            <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
              <span className="inline-flex h-4 min-w-0 items-center gap-1.5 whitespace-nowrap leading-4">
                <RiAtLine className="size-3.5 shrink-0" aria-label="Handle" />
                <span className="min-w-0 truncate" title={server.id}>{server.handle}</span>
              </span>
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span aria-hidden="true">·</span>
                <span className="inline-flex h-4 min-w-0 items-center gap-1.5 whitespace-nowrap leading-4">
                  <Icon name={typeIcon(server.type)} className="size-3.5 shrink-0" aria-label="Connection type" />
                  <span>{server.type === "stdio" ? "stdio" : typeLabel(server.type)}</span>
                </span>
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 pt-0.5">
          <Button type="button" variant="outline" size="sm" onClick={() => onEditInChat(server)}>
            <Icon name="MessageCirclePlus" className="size-4" aria-hidden />
            Edit in chat
          </Button>
          <Switch
            checked={server.enabled}
            disabled={pending !== null}
            aria-label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
            onCheckedChange={(enabled) => onEnabledChange(server.id, enabled)}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 p-0 text-muted-foreground hover:text-foreground"
                aria-label={`${server.name} actions`}
              >
                <Icon name="MoreHorizontal" className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-max min-w-32 max-w-72">
              {server.type === "stdio" ? null : (
                <DropdownMenuItem disabled={pending !== null} onSelect={() => onAuth(server.id)}>
                  <MenuRow icon="Lock">{server.authStatus === "authenticated" ? "Re-authenticate" : "Authenticate"}</MenuRow>
                </DropdownMenuItem>
              )}
              {server.type === "stdio" ? null : <DropdownMenuSeparator />}
              <DropdownMenuItem variant="destructive" disabled={pending !== null} onSelect={() => onRemove(server)}>
                <MenuRow icon="Trash2">Remove</MenuRow>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {server.lastError ? <p role="alert" className="text-sm text-destructive">{server.lastError}</p> : null}
      {localRows.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-foreground">Settings</h2>
          <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5">
            <dl className="divide-y divide-border">
              {localRows.map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                  <dt className="shrink-0 text-sm">{row.label}</dt>
                  <dd className="min-w-0 truncate text-right text-sm text-muted-foreground" title={row.value}>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ) : null}
      <section className="space-y-3">
        <div className="flex min-h-6 items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">Agent guide</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending !== null || guideDraft.trim() === savedGuide.trim()}
            onClick={() => onSaveGuide(server.id, guideDraft.trim() || null)}
          >
            Save guide
          </Button>
        </div>
        <Textarea
          value={guideDraft}
          onChange={(event) => setGuideDraft(event.target.value)}
          placeholder="How agents should use this server, e.g. which workspace or project to search first."
          aria-label="Agent guide"
          maxLength={4000}
          rows={4}
        />
        <p className="text-xs text-muted-foreground">
          Added to agent instructions under this server while it is enabled. Agents see the first 600 characters.
        </p>
      </section>
      <section data-resource-detail-section="definition" className="space-y-3">
        <div className="flex min-h-6 items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-foreground">Tools</h2>
        </div>
        {tools === null ? (
          <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5" role="status" aria-label="Loading tools">
            <div className="divide-y divide-border">
              {[0, 1, 2].map((row) => (
                <div key={row} className="space-y-2 py-2.5 first:pt-0 last:pb-0" aria-hidden="true">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              ))}
            </div>
          </div>
        ) : tools.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
            {catalogError ?? (server.authStatus === "unauthenticated" || server.authStatus === "authorizing"
              ? "Authenticate to load tools."
              : "No tools reported yet.")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card px-4 py-3.5">
            <ul className="divide-y divide-border">
              {tools.slice(toolPage * 50, (toolPage + 1) * 50).map((tool) => (
                <li key={tool.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p className="truncate text-sm font-medium">{tool.name}</p>
                      <RiskPill risk={tool.risk} />
                    </div>
                    {tool.description ? <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{tool.description}</p> : null}
                  </div>
                  <ToolPolicySelect tool={tool.name} policy={toolPolicies.policies.get(tool.name)} onChange={(mode) => void toolPolicies.setMode(tool.name, mode)} />
                </li>
              ))}
            </ul>
          </div>
        )}
        <Pagination page={toolPage} total={tools?.length ?? 0} onPage={setToolPage} label="tools" />
        {toolPolicies.error ? <p role="alert" className="text-sm text-destructive">{toolPolicies.error}</p> : null}
        {catalogError && tools && tools.length > 0 ? (
          <p role="alert" className="text-sm text-destructive">{catalogError}</p>
        ) : null}
      </section>
    </div>
  );
}

function McpsPage({ subPath }: { subPath: string }) {
  const nav = useBbNavigate();
  const { rpc, servers, error, setError, refetch } = useServers();
  const route = parseRoute(subPath);
  const [pending, setPending] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ServerRow | null>(null);

  const go = (next: string, replace = false) => {
    nav.toPluginPanel("mcps", { subPath: next, replace });
  };

  useEffect(() => {
    if (!route.detailId) {
      publishDetailLabel(null);
      return;
    }
    publishDetailLabel(servers?.find((server) => (server.id === route.detailId || server.handle === route.detailId))?.name ?? null);
  }, [route.detailId, servers]);

  const run = async (label: string, work: () => Promise<unknown>) => {
    setPending(label);
    try {
      await work();
      refetch();
    } catch (cause) {
      const message = errorText(cause);
      setError(message);
      toast.error(message);
    } finally {
      setPending(null);
    }
  };

  const createViaChat = (prompt?: string) => {
    nav.toCompose({ focusPrompt: true, initialPrompt: prompt ?? CREATE_MCP_PROMPT });
  };

  const editInChat = (server: ServerRow) => {
    nav.toCompose({
      focusPrompt: true,
      initialPrompt: buildMcpEditThreadPrompt({ name: server.name, id: server.id, handle: server.handle }),
    });
  };

  const saveGuide = (id: string, guide: string | null) => {
    void run(`guide:${id}`, async () => {
      await rpc.call("setGuide", { id, guide });
      toast.success(guide === null ? "Guide cleared" : "Guide saved");
    });
  };

  const removeMcp = () => {
    const target = removeTarget;
    if (!target) return;
    void (async () => {
      setPending(`remove:${target.id}`);
      try {
        await rpc.call("remove", { id: target.id });
        toast.success("MCP deleted");
        setRemoveTarget(null);
        refetch();
        if (route.detailId) go("", true);
      } catch (cause) {
        toast.error(`Failed to delete MCP: ${errorText(cause)}`);
      } finally {
        setPending(null);
      }
    })();
  };

  const authenticate = (id: string) => {
    const authWindow = window.open("about:blank", "_blank");
    void run(`auth:${id}`, async () => {
      const result = await rpc.call("authenticate", { id });
      if (result.url) {
        if (authWindow) authWindow.location.href = result.url;
        else window.open(result.url, "_blank", "noopener,noreferrer");
      } else {
        authWindow?.close();
      }
    });
  };

  if (route.detailId) {
    return (
      <PageShell>
        {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
        <DetailPage
          key={route.detailId}
          id={route.detailId}
          servers={servers}
          pending={pending}
          onBack={() => go("")}
          onEnabledChange={(id, enabled) => void run(`enable:${id}`, () => rpc.call("setEnabled", { id, enabled }))}
          onRemove={setRemoveTarget}
          onAuth={authenticate}
          onEditInChat={editInChat}
          onSaveGuide={saveGuide}
        />
        <RemoveDialog
          name={removeTarget?.name ?? null}
          pending={pending !== null}
          onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
          onConfirm={removeMcp}
        />
      </PageShell>
    );
  }

  return (
    <PageShell fill>
      {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}
      <ProviderGuardNotice />
      <CollectionChrome
        actions={<ResourceCreateButton label="New MCP" templates={MCP_CREATE_TEMPLATES} onCreate={createViaChat} />}
      >
        <InstalledList
          servers={servers}
          pending={pending}
          onOpen={(id) => go(detailPath(id))}
          onEnabledChange={(id, enabled) => void run(`enable:${id}`, () => rpc.call("setEnabled", { id, enabled }))}
        />
      </CollectionChrome>
      <RemoveDialog
        name={removeTarget?.name ?? null}
        pending={pending !== null}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}
        onConfirm={removeMcp}
      />
    </PageShell>
  );
}

export default definePluginApp((app) => {
  app.slots.navPanel({
    id: "mcps",
    title: "MCPs",
    icon: "Layers",
    path: "mcps",
    component: McpsPage,
    headerContent: HeaderCrumbs,
  });
  app.slots.pendingInteraction({ id: APPROVAL_RENDERER_ID, component: McpApprovalInteraction });
});
