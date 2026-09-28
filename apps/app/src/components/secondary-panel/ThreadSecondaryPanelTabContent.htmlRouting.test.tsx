// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const filePreviewQueryResult = {
  data: undefined,
  error: null,
  isLoading: false,
  isFetching: false,
  refetch: vi.fn(),
};

vi.mock("@/hooks/queries/environment-queries", () => ({
  useEnvironment: () => ({ data: undefined }),
  useEnvironmentFilePreview: () => filePreviewQueryResult,
}));
vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreadHostFilePreview: () => filePreviewQueryResult,
  useThreadStorageFilePreview: () => filePreviewQueryResult,
}));
vi.mock("@/hooks/queries/host-file-preview-query", () => ({
  useHostFilePreview: () => ({ data: undefined }),
}));
vi.mock("@/components/files/LazyFileEditor", () => ({
  LazyFileEditor: () => <div data-testid="lazy-file-editor" />,
}));
vi.mock("./ThreadStorageFilePreview", () => ({
  SecondaryPanelFilePreview: () => (
    <div data-testid="secondary-panel-file-preview" />
  ),
}));

import {
  HostFilePreviewTabContent,
  HostScopedFilePreviewTabContent,
  ThreadStorageFilePreviewTabContent,
  WorkspaceFilePreviewTabContent,
} from "./ThreadSecondaryPanelTabContent";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("html/htm routing across the four file preview gates", () => {
  it.each(["index.html", "legacy/page.htm"])(
    "routes workspace %s to the rendered preview, not the editor",
    (path) => {
      render(
        <WorkspaceFilePreviewTabContent
          activePath={path}
          environmentId="env-1"
          isPanelOpen
          lineRange={null}
          source={{ kind: "working-tree" }}
          statusLabel={null}
        />,
      );
      expect(screen.queryByTestId("secondary-panel-file-preview")).toBeTruthy();
      expect(screen.queryByTestId("lazy-file-editor")).toBeNull();
    },
  );

  it("still routes non-html workspace files to the editor", () => {
    render(
      <WorkspaceFilePreviewTabContent
        activePath="src/index.ts"
        environmentId="env-1"
        isPanelOpen
        lineRange={null}
        source={{ kind: "working-tree" }}
        statusLabel={null}
      />,
    );
    expect(screen.queryByTestId("lazy-file-editor")).toBeTruthy();
  });

  it.each(["index.html", "legacy/page.htm"])(
    "routes host %s to the rendered preview, not the editor",
    (path) => {
      render(
        <HostFilePreviewTabContent
          activePath={path}
          copyPath={path}
          environmentId="env-1"
          isPanelOpen
          lineRange={null}
          threadId="thr-1"
        />,
      );
      expect(screen.queryByTestId("secondary-panel-file-preview")).toBeTruthy();
      expect(screen.queryByTestId("lazy-file-editor")).toBeNull();
    },
  );

  it.each(["index.html", "legacy/page.htm"])(
    "routes host-scoped %s to the rendered preview, not the editor",
    (path) => {
      render(
        <HostScopedFilePreviewTabContent
          activePath={path}
          hostId="host-1"
          isPanelOpen
          lineRange={null}
        />,
      );
      expect(screen.queryByTestId("secondary-panel-file-preview")).toBeTruthy();
      expect(screen.queryByTestId("lazy-file-editor")).toBeNull();
    },
  );

  it.each(["index.html", "legacy/page.htm"])(
    "routes thread-storage %s to the rendered preview, not the editor",
    (path) => {
      render(
        <ThreadStorageFilePreviewTabContent
          activePath={path}
          isPanelOpen
          lineRange={null}
          threadId="thr-1"
        />,
      );
      expect(screen.queryByTestId("secondary-panel-file-preview")).toBeTruthy();
      expect(screen.queryByTestId("lazy-file-editor")).toBeNull();
    },
  );
});
