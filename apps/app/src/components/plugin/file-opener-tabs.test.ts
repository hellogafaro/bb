import { describe, expect, it } from "vitest";
import type { PluginFileOpenerSlot } from "@/lib/plugin-slots";
import { buildFileOpenerPanelTab } from "@/test/fixtures/plugins";
import { createFileOpenerOriginalTab } from "./file-opener-tabs";

const MARKDOWN_OPENER = {
  component: () => null,
  extensions: ["md"],
  generation: 1,
  id: "markdown",
  pluginId: "docs",
  title: "Docs editor",
} satisfies PluginFileOpenerSlot;

describe("createFileOpenerOriginalTab", () => {
  it("uses persisted workspace routing while retaining owner presentation", () => {
    const openerTab = buildFileOpenerPanelTab(
      MARKDOWN_OPENER,
      {
        path: "persisted/readme.md",
        source: {
          kind: "workspace",
          environmentId: null,
          experimental_hostId: "host_opened",
          projectId: "proj_opened",
          threadId: null,
        },
      },
      {
        environmentId: "env_stale",
        kind: "workspace-file-preview",
        projectId: "proj_stale",
        tab: {
          lineRange: { endLineNumber: 12, startLineNumber: 8 },
          path: "stale/readme.md",
          source: { kind: "working-tree" },
          statusLabel: null,
        },
        threadId: "thr_stale",
      },
    );

    expect(createFileOpenerOriginalTab(openerTab)).toMatchObject({
      environmentId: null,
      kind: "workspace-file-preview",
      lineRange: { endLineNumber: 12, startLineNumber: 8 },
      path: "persisted/readme.md",
      projectId: "proj_opened",
      source: { kind: "working-tree" },
    });
  });

  it("uses persisted host routing instead of stale owner identity", () => {
    const openerTab = buildFileOpenerPanelTab(
      MARKDOWN_OPENER,
      {
        path: "/persisted/notes.md",
        source: {
          kind: "host",
          environmentId: null,
          experimental_hostId: "host_opened",
          projectId: null,
          threadId: null,
        },
      },
      {
        environmentId: null,
        hostId: "host_stale",
        kind: "host-file-preview",
        tab: {
          lineRange: { endLineNumber: 4, startLineNumber: 4 },
          path: "/stale/notes.md",
        },
        threadId: null,
      },
    );

    expect(createFileOpenerOriginalTab(openerTab)).toMatchObject({
      environmentId: null,
      hostId: "host_opened",
      kind: "host-file-preview",
      lineRange: { endLineNumber: 4, startLineNumber: 4 },
      path: "/persisted/notes.md",
      threadId: null,
    });
  });

  it("uses persisted thread-storage routing instead of stale owner identity", () => {
    const openerTab = buildFileOpenerPanelTab(
      MARKDOWN_OPENER,
      {
        path: "persisted/plan.md",
        source: {
          kind: "thread-storage",
          environmentId: "env_opened",
          projectId: null,
          threadId: "thr_opened",
        },
      },
      {
        environmentId: "env_stale",
        kind: "thread-storage-file-preview",
        tab: { lineRange: null, path: "stale/plan.md" },
        threadId: "thr_stale",
      },
    );

    expect(createFileOpenerOriginalTab(openerTab)).toMatchObject({
      environmentId: "env_opened",
      isPinned: false,
      kind: "thread-storage-file-preview",
      path: "persisted/plan.md",
      threadId: "thr_opened",
    });
  });
});
