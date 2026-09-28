import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@bb/shared-ui/icon";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { Button } from "@bb/shared-ui/button";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  definePluginApp,
  Markdown,
  useBbNavigate,
  useRpc,
  type PluginMessageDirectiveProps,
  type MarkdownProps,
} from "@get-bb/plugin-sdk/app";
import type { canvasRpcContract } from "./server.js";

type PreviewSource = "workspace" | "thread-storage";

type PreviewTarget = NonNullable<
  MarkdownProps["experimental_document"]
>["target"];

const PREVIEW_ROUTE = {
  workspace: "worktree/files",
  "thread-storage": "thread-storage/files",
} as const satisfies Record<PreviewSource, string>;

type Display = "card" | "inline";
type Kind = "plan" | "report" | "chart" | "demo" | "notes" | "mockup";

const KIND_META: Record<Kind, { label: string; icon: string }> = {
  plan: { label: "Plan", icon: "ListTodo" },
  report: { label: "Report", icon: "FileText" },
  chart: { label: "Chart", icon: "ChartColumn" },
  demo: { label: "Demo", icon: "Play" },
  notes: { label: "Notes", icon: "EditBox" },
  mockup: { label: "Mockup", icon: "Palette" },
};

const DEFAULT_KIND_META = { label: "Canvas", icon: "AppWindow" };

function resolveKindMeta(value: string | undefined): {
  label: string;
  icon: string;
} {
  return value !== undefined && value in KIND_META
    ? KIND_META[value as Kind]
    : DEFAULT_KIND_META;
}

function isMarkdownFile(file: string): boolean {
  return /\.(md|markdown)$/i.test(file);
}

function resolveDisplay(
  value: string | undefined,
  file: string,
): Display {
  if (value === "card" || value === "inline") return value;
  return isMarkdownFile(file) ? "inline" : "card";
}

type LoadState =
  | { status: "missing-file" }
  | { status: "invalid-height"; message: string }
  | { status: "loading"; file: string }
  | {
      status: "ready";
      kind: "html";
      file: string;
      source: PreviewSource;
      target: PreviewTarget;
      title: string | null;
    }
  | {
      status: "ready";
      kind: "markdown";
      file: string;
      source: PreviewSource;
      target: PreviewTarget;
      rootPath: string;
      content: string;
      title: string | null;
    }
  | { status: "error"; file: string; message: string };

const DEFAULT_HEIGHT_PX = 224;
const MIN_HEIGHT_PX = 120;
const MAX_HEIGHT_PX = 1_200;

function encodePathSegments(file: string): string {
  return file.split("/").map(encodeURIComponent).join("/");
}

function buildPreviewUrl(
  threadId: string,
  file: string,
  source: PreviewSource,
): string {
  return `/api/v1/threads/${encodeURIComponent(threadId)}/${PREVIEW_ROUTE[source]}/${encodePathSegments(file)}`;
}

function parsePreviewHeight(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (normalized.length === 0) return DEFAULT_HEIGHT_PX;
  if (!/^\d+$/.test(normalized)) return null;
  const height = Number(normalized);
  return Number.isSafeInteger(height) &&
    height >= MIN_HEIGHT_PX &&
    height <= MAX_HEIGHT_PX
    ? height
    : null;
}

function CanvasIconTile({ icon }: { icon: string }) {
  return (
    <div
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
    >
      <Icon name={icon} aria-hidden className="size-4" />
    </div>
  );
}

function CanvasHeader({
  icon,
  title,
  subtitle,
  onOpen,
  clickable,
  showCollapse,
  collapsed,
  onToggleCollapse,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onOpen: (() => void) | null;
  clickable: boolean;
  showCollapse: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  return (
    <div
      data-testid="canvas-header"
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? onOpen ?? undefined : undefined}
      onKeyDown={
        clickable && onOpen
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      className={cn(
        "flex items-center gap-2 px-3 py-2",
        clickable && "cursor-pointer",
      )}
    >
      <CanvasIconTile icon={icon} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-foreground">
          {title}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {subtitle}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {onOpen ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
          >
            Open
          </Button>
        ) : null}
        {showCollapse ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} canvas ${title}`}
            title={collapsed ? "Expand canvas" : "Collapse canvas"}
            className="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse();
            }}
          >
            <Icon
              name={collapsed ? "ChevronRight" : "ChevronDown"}
              aria-hidden
              className="size-3.5"
            />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CanvasCard({
  icon,
  title,
  subtitle,
  onOpen,
  clickable,
  showCollapse,
  collapsed,
  onToggleCollapse,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  onOpen: (() => void) | null;
  clickable: boolean;
  showCollapse: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  children: ReactNode;
}) {
  const hasBody = children !== null && !(showCollapse && collapsed);
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-border bg-card">
      <div className={cn(hasBody && "border-b border-border")}>
        <CanvasHeader
          icon={icon}
          title={title}
          subtitle={subtitle}
          onOpen={onOpen}
          clickable={clickable}
          showCollapse={showCollapse}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
        />
      </div>
      {hasBody ? children : null}
    </div>
  );
}

function CanvasAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
    >
      {message}
    </div>
  );
}

function CanvasDirective({
  attributes,
  source,
  message,
}: PluginMessageDirectiveProps) {
  const rpc = useRpc<typeof canvasRpcContract>();
  const navigate = useBbNavigate();
  const fileAttr = attributes.file?.trim() ?? "";
  const sourceAttr = attributes.source;
  const heightAttr = attributes.height;
  const titleAttr = attributes.title?.trim();
  const kindMeta = resolveKindMeta(attributes.kind);
  const display = resolveDisplay(attributes.display, fileAttr);
  const previewHeight = parsePreviewHeight(heightAttr);
  const heightError =
    display === "inline" && previewHeight === null
      ? `canvas height must be a whole number from ${MIN_HEIGHT_PX} to ${MAX_HEIGHT_PX} pixels.`
      : null;
  const [state, setState] = useState<LoadState>(() =>
    heightError
      ? { status: "invalid-height", message: heightError }
      : fileAttr
        ? { status: "loading", file: fileAttr }
        : { status: "missing-file" },
  );
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (heightError) {
      setState({ status: "invalid-height", message: heightError });
      return;
    }
    if (!fileAttr) {
      setState({ status: "missing-file" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", file: fileAttr });

    void (async () => {
      try {
        const result = await rpc.call("preparePreview", {
          threadId: message.threadId,
          file: fileAttr,
          ...(sourceAttr === undefined ? {} : { source: sourceAttr }),
        });
        if (cancelled) return;
        setState({ status: "ready", ...result });
      } catch (error) {
        if (cancelled) return;
        setState({
          status: "error",
          file: fileAttr,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileAttr, heightError, message.threadId, rpc, sourceAttr]);

  const resolvedTitle =
    titleAttr ||
    (state.status === "ready" ? state.title : null) ||
    fileAttr ||
    "Canvas";
  const subtitle = fileAttr
    ? `${kindMeta.label} · ${fileAttr}`
    : kindMeta.label;

  const onOpen =
    state.status === "ready"
      ? () => {
          navigate.experimental_openFilePreview({
            target: state.target,
            location: null,
          });
        }
      : null;

  if (state.status === "missing-file") {
    return (
      <CanvasCard
        icon={kindMeta.icon}
        title={resolvedTitle}
        subtitle={subtitle}
        onOpen={null}
        clickable={false}
        showCollapse={false}
        collapsed={false}
        onToggleCollapse={() => {}}
      >
        <div className="p-3" title={source}>
          <CanvasAlert
            message={
              'canvas requires a file attribute, e.g. ::canvas{file="demo.html"}'
            }
          />
        </div>
      </CanvasCard>
    );
  }

  if (state.status === "invalid-height") {
    return (
      <CanvasCard
        icon={kindMeta.icon}
        title={resolvedTitle}
        subtitle={subtitle}
        onOpen={null}
        clickable={false}
        showCollapse={false}
        collapsed={false}
        onToggleCollapse={() => {}}
      >
        <div className="p-3" title={source}>
          <CanvasAlert message={state.message} />
        </div>
      </CanvasCard>
    );
  }

  if (state.status === "error") {
    return (
      <CanvasCard
        icon={kindMeta.icon}
        title={resolvedTitle}
        subtitle={subtitle}
        onOpen={null}
        clickable={false}
        showCollapse={false}
        collapsed={false}
        onToggleCollapse={() => {}}
      >
        <div className="p-3" title={source}>
          <CanvasAlert message={`Failed to load ${state.file}: ${state.message}`} />
        </div>
      </CanvasCard>
    );
  }

  if (state.status === "loading") {
    return (
      <CanvasCard
        icon={kindMeta.icon}
        title={resolvedTitle}
        subtitle={subtitle}
        onOpen={null}
        clickable={false}
        showCollapse={false}
        collapsed={false}
        onToggleCollapse={() => {}}
      >
        {display === "inline" ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={`Loading canvas ${state.file}`}
            style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
            className="w-full p-3"
          >
            <Skeleton className="size-full" />
          </div>
        ) : null}
      </CanvasCard>
    );
  }

  // status === "ready"
  return (
    <CanvasCard
      icon={kindMeta.icon}
      title={resolvedTitle}
      subtitle={subtitle}
      onOpen={onOpen}
      clickable={display === "card"}
      showCollapse={display === "inline"}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((value) => !value)}
    >
      {display === "inline" ? (
        state.kind === "markdown" ? (
          <div
            style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
            className="overflow-auto p-3"
          >
            <Markdown
              content={state.content}
              experimental_document={{
                threadId: message.threadId,
                rootPath: state.rootPath,
                target: state.target,
              }}
            />
          </div>
        ) : (
          <iframe
            title={`canvas: ${state.file}`}
            src={buildPreviewUrl(message.threadId, state.file, state.source)}
            sandbox="allow-scripts"
            style={{ height: previewHeight ?? DEFAULT_HEIGHT_PX }}
            className="block w-full border-0 bg-background"
          />
        )
      ) : null}
    </CanvasCard>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: "canvas",
    component: CanvasDirective,
  });
  // Deprecated alias, kept so old messages still render. Remove next release.
  app.slots.messageDirective({
    id: "inline-vis",
    component: CanvasDirective,
  });
});
