// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRawFileUrl,
  downloadRawFile,
  withRawFileDownload,
} from "./raw-file-url";

const workspace = {
  kind: "workspace" as const,
  environmentId: null,
  hostId: null,
  projectId: null,
  threadId: "thr_1",
};

describe("buildRawFileUrl", () => {
  it("encodes each worktree path segment and keeps nested directories", () => {
    expect(buildRawFileUrl(workspace, "docs/Q3 plan #2?/résumé 📄.pdf")).toBe(
      "/api/v1/threads/thr_1/worktree/files/docs/Q3%20plan%20%232%3F/r%C3%A9sum%C3%A9%20%F0%9F%93%84.pdf",
    );
  });

  it("encodes thread storage paths as segments", () => {
    expect(
      buildRawFileUrl(
        { kind: "thread-storage", threadId: "thr_1" },
        "out/a b#c.zip",
      ),
    ).toBe("/api/v1/threads/thr_1/thread-storage/files/out/a%20b%23c.zip");
  });

  it("passes host paths through the query string", () => {
    const url = buildRawFileUrl(
      { kind: "host", threadId: "thr_1" },
      "/Users/me/My Files/a#b?.mp4",
    );
    expect(url?.startsWith("/api/v1/threads/thr_1/host-files/content?")).toBe(
      true,
    );
    expect(new URL(url ?? "", "http://x").searchParams.get("path")).toBe(
      "/Users/me/My Files/a#b?.mp4",
    );
  });

  it("routes workspace files without a thread through the project route", () => {
    const url = buildRawFileUrl(
      { ...workspace, threadId: null, projectId: "prj_1", hostId: "host_1" },
      "src/über file.docx",
    );
    const parsed = new URL(url ?? "", "http://x");
    expect(parsed.pathname).toBe("/api/v1/projects/prj_1/files/content");
    expect(parsed.searchParams.get("path")).toBe("src/über file.docx");
    expect(parsed.searchParams.get("hostId")).toBe("host_1");
  });

  it("prefers the environment over the host for project routing", () => {
    const url = buildRawFileUrl(
      {
        ...workspace,
        threadId: null,
        projectId: "prj_1",
        environmentId: "env_1",
        hostId: "host_1",
      },
      "a.pdf",
    );
    const parsed = new URL(url ?? "", "http://x");
    expect(parsed.searchParams.get("environmentId")).toBe("env_1");
    expect(parsed.searchParams.has("hostId")).toBe(false);
  });

  it("returns null when a workspace file has no thread or project", () => {
    expect(buildRawFileUrl({ ...workspace, threadId: null }, "a.pdf")).toBe(
      null,
    );
  });

  it("appends the download flag to path and query routes", () => {
    expect(buildRawFileUrl(workspace, "a b.zip", { download: true })).toBe(
      "/api/v1/threads/thr_1/worktree/files/a%20b.zip?download=1",
    );
    const hostUrl = buildRawFileUrl(
      { kind: "host", threadId: "thr_1" },
      "/tmp/a.zip",
      { download: true },
    );
    const parsed = new URL(hostUrl ?? "", "http://x");
    expect(parsed.searchParams.get("download")).toBe("1");
    expect(parsed.searchParams.get("path")).toBe("/tmp/a.zip");
  });

  it("leaves inline data urls untouched when adding the download flag", () => {
    expect(withRawFileDownload("data:text/plain,hi")).toBe(
      "data:text/plain,hi",
    );
  });
});

describe("downloadRawFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clicks a temporary download anchor and removes it", () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clicked.push(this);
      },
    );

    downloadRawFile(
      "/api/v1/threads/t/worktree/files/a.zip?download=1",
      "a.zip",
    );

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.getAttribute("href")).toBe(
      "/api/v1/threads/t/worktree/files/a.zip?download=1",
    );
    expect(clicked[0]?.download).toBe("a.zip");
    expect(document.querySelector("a[download]")).toBeNull();
  });
});
