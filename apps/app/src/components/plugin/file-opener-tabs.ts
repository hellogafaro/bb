import type { PluginFileOpenerProps } from "@get-bb/plugin-sdk";
import type {
  PluginPanelFixedPanelTab,
  SecondaryFileFixedPanelTab,
} from "@/lib/fixed-panel-tabs-state";

const FILE_OPENER_ACTION_ID_PREFIX = "file-opener:";

type PluginFileOpenerFile = Pick<PluginFileOpenerProps, "path" | "source">;

export type FileOpenerOriginalTab = Extract<
  SecondaryFileFixedPanelTab,
  {
    kind:
      | "workspace-file-preview"
      | "host-file-preview"
      | "thread-storage-file-preview";
  }
>;

export function fileOpenerIdFromActionId(actionId: string): string | null {
  return actionId.startsWith(FILE_OPENER_ACTION_ID_PREFIX)
    ? actionId.slice(FILE_OPENER_ACTION_ID_PREFIX.length)
    : null;
}

export function parseFileOpenerParams(
  paramsJson: string | null,
): PluginFileOpenerFile | null {
  if (paramsJson === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(paramsJson);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { path, source } = parsed as { path?: unknown; source?: unknown };
  if (typeof path !== "string" || path.length === 0) return null;
  if (typeof source !== "object" || source === null) return null;
  const { kind, threadId, environmentId, projectId, experimental_hostId } =
    source as {
      kind?: unknown;
      threadId?: unknown;
      environmentId?: unknown;
      projectId?: unknown;
      experimental_hostId?: unknown;
    };
  if (kind !== "workspace" && kind !== "host" && kind !== "thread-storage") {
    return null;
  }
  return {
    path,
    source: {
      kind,
      threadId: typeof threadId === "string" ? threadId : null,
      environmentId: typeof environmentId === "string" ? environmentId : null,
      projectId: typeof projectId === "string" ? projectId : null,
      ...(typeof experimental_hostId === "string"
        ? { experimental_hostId }
        : {}),
    },
  };
}

export function createFileOpenerOriginalTab(
  tab: PluginPanelFixedPanelTab,
): FileOpenerOriginalTab | null {
  const owner = tab.fileOpenerOwner;
  const file = parseFileOpenerParams(tab.paramsJson);
  if (owner === undefined || file === null) return null;

  const id = `${tab.id}:file-opener-original`;
  if (
    owner.kind === "workspace-file-preview" &&
    file.source.kind === "workspace"
  ) {
    return {
      ...owner.tab,
      environmentId: file.source.environmentId,
      id,
      kind: "workspace-file-preview",
      path: file.path,
      projectId: file.source.projectId,
    };
  }
  if (owner.kind === "host-file-preview" && file.source.kind === "host") {
    return {
      ...owner.tab,
      environmentId: file.source.environmentId,
      hostId: file.source.experimental_hostId ?? null,
      id,
      kind: "host-file-preview",
      path: file.path,
      threadId: file.source.threadId,
    };
  }
  if (
    owner.kind === "thread-storage-file-preview" &&
    file.source.kind === "thread-storage"
  ) {
    return {
      ...owner.tab,
      environmentId: file.source.environmentId,
      id,
      isPinned: false,
      kind: "thread-storage-file-preview",
      path: file.path,
      threadId: file.source.threadId,
    };
  }
  return null;
}
