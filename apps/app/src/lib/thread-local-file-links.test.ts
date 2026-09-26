import { describe, expect, it } from "vitest";
import {
  buildThreadLocalFileDownloadUrl,
  resolveThreadLocalFileLink,
} from "./thread-local-file-links";

describe("resolveThreadLocalFileLink", () => {
  it("leaves app routes as normal navigation", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: null,
          path: "/projects/proj_gyz9przugq/threads/thr_rq7r4uv8zg",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      kind: "app-route",
    });
  });

  it("opens host file links when there is no ready local workspace", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: null,
          path: "/Users/me/project/src/file.ts",
        },
        threadStorageRootPath: null,
        workspaceRootPath: null,
      }),
    ).toEqual({
      kind: "open-host-path",
      request: {
        lineRange: null,
        path: "/Users/me/project/src/file.ts",
      },
    });
  });

  it("rejects file links when host-file context is unavailable", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: false,
        link: {
          lineRange: { startLineNumber: 12, endLineNumber: 14 },
          path: "/Users/me/.ssh/id_rsa",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      description:
        "Thread file links are only available when the thread has an environment.",
      kind: "error",
    });
  });

  it("opens paths outside the workspace root as host files", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: { startLineNumber: 12, endLineNumber: 14 },
          path: "/Users/me/.ssh/id_rsa",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      kind: "open-host-path",
      request: {
        lineRange: { startLineNumber: 12, endLineNumber: 14 },
        path: "/Users/me/.ssh/id_rsa",
      },
    });
  });

  it("normalizes paths before checking workspace containment", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: { startLineNumber: 12, endLineNumber: 14 },
          path: "/Users/me/project/src/../src/file.ts",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project/",
      }),
    ).toEqual({
      kind: "open-workspace-path",
      request: {
        lineRange: { startLineNumber: 12, endLineNumber: 14 },
        path: "/Users/me/project/src/file.ts",
        relativePath: "src/file.ts",
        workspaceRootPath: "/Users/me/project",
      },
    });
  });

  it("rejects relative file links", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: { startLineNumber: 7, endLineNumber: 7 },
          path: "apps/app/src/main.tsx",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      description: "Thread file links must use absolute file paths.",
      kind: "error",
    });
  });

  it("does not mistake deeper filesystem paths for project routes", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: null,
          path: "/projects/my-repo/src/file.ts",
        },
        threadStorageRootPath: null,
        workspaceRootPath: "/projects/my-repo",
      }),
    ).toEqual({
      kind: "open-workspace-path",
      request: {
        lineRange: null,
        path: "/projects/my-repo/src/file.ts",
        relativePath: "src/file.ts",
        workspaceRootPath: "/projects/my-repo",
      },
    });
  });

  it("opens paths inside the known thread storage root as storage files", () => {
    expect(
      resolveThreadLocalFileLink({
        hostFileLinksAvailable: true,
        link: {
          lineRange: { startLineNumber: 4, endLineNumber: 6 },
          path: "/Users/me/.bb/thread-storage/thr_one/reports/preview.html",
        },
        threadStorageRootPath: "/Users/me/.bb/thread-storage/thr_one",
        workspaceRootPath: "/Users/me/project",
      }),
    ).toEqual({
      kind: "open-thread-storage-path",
      request: {
        lineRange: { startLineNumber: 4, endLineNumber: 6 },
        path: "/Users/me/.bb/thread-storage/thr_one/reports/preview.html",
        relativePath: "reports/preview.html",
        threadStorageRootPath: "/Users/me/.bb/thread-storage/thr_one",
      },
    });
  });
});

describe("buildThreadLocalFileDownloadUrl", () => {
  const resolve = (path: string) =>
    resolveThreadLocalFileLink({
      hostFileLinksAvailable: true,
      link: { lineRange: null, path },
      threadStorageRootPath: "/data/storage/thr_1",
      workspaceRootPath: "/Users/me/project",
    });

  it("routes each link kind to its raw download route", () => {
    expect(
      buildThreadLocalFileDownloadUrl(
        resolve("/Users/me/project/docs/Q3 plan.pdf"),
        "thr_1",
      ),
    ).toBe(
      "/api/v1/threads/thr_1/worktree/files/docs/Q3%20plan.pdf?download=1",
    );
    expect(
      buildThreadLocalFileDownloadUrl(
        resolve("/data/storage/thr_1/out/report.zip"),
        "thr_1",
      ),
    ).toBe(
      "/api/v1/threads/thr_1/thread-storage/files/out/report.zip?download=1",
    );
    const hostUrl = new URL(
      buildThreadLocalFileDownloadUrl(resolve("/tmp/a b.mp4"), "thr_1") ?? "",
      "http://x",
    );
    expect(hostUrl.pathname).toBe("/api/v1/threads/thr_1/host-files/content");
    expect(hostUrl.searchParams.get("path")).toBe("/tmp/a b.mp4");
    expect(hostUrl.searchParams.get("download")).toBe("1");
  });

  it("offers no download for app routes", () => {
    expect(
      buildThreadLocalFileDownloadUrl(
        resolve("/projects/proj_1/threads/thr_2"),
        "thr_1",
      ),
    ).toBeNull();
  });
});
