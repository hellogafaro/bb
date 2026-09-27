import { describe, expect, it, vi } from "vitest";
import {
  resolveConfinedWorkflowPath,
  resolveWorkflowSource,
  workflowReferenceToSourceInput,
  type WorkflowSourceResolverDependencies,
} from "./source-resolution.js";
import { MAX_WORKFLOW_SOURCE_BYTES } from "./validation.js";

function missingFile(path: string): Error {
  return Object.assign(new Error(`HTTP 404: missing ${path}`), {
    status: 404,
  });
}

function dependencies(
  overrides: Partial<WorkflowSourceResolverDependencies> = {},
): WorkflowSourceResolverDependencies {
  return {
    getThreadEnvironmentId: async () => "env-1",
    getEnvironment: async () => ({
      id: "env-1",
      projectId: "project-1",
      hostId: "host-1",
      path: "/workspace/project",
    }),
    sharedWorkflowsPath: "/data/workflows",
    readFile: async () => ({
      content: "export const meta = {}; return null;",
      contentEncoding: "utf8",
      sizeBytes: 36,
    }),
    ...overrides,
  };
}

describe("workflow source resolution", () => {
  it("maps runtime string references to trusted named resolution", () => {
    expect(workflowReferenceToSourceInput("review-change")).toEqual({
      name: "review-change",
    });
    expect(workflowReferenceToSourceInput({ scriptPath: "child.js" })).toEqual({
      scriptPath: "child.js",
    });
  });
  it("requires exactly one native source mode and treats source as an alias", async () => {
    const deps = dependencies();
    await expect(
      resolveWorkflowSource(
        {},
        { projectId: "project-1", threadId: "thread-1" },
        deps,
      ),
    ).rejects.toThrow("Exactly one");
    await expect(
      resolveWorkflowSource(
        { script: "x", source: "x" },
        { projectId: "project-1", threadId: "thread-1" },
        deps,
      ),
    ).rejects.toThrow("aliases");
    await expect(
      resolveWorkflowSource(
        { source: "inline" },
        { projectId: "project-1", threadId: "thread-1" },
        deps,
      ),
    ).resolves.toMatchObject({ source: "inline", origin: { kind: "script" } });
  });

  it("confines POSIX and Windows paths to the environment root", () => {
    expect(() => resolveConfinedWorkflowPath("relative", "flow.js")).toThrow(
      "root must be an absolute path",
    );
    expect(resolveConfinedWorkflowPath("/repo", "flows/a.js")).toBe(
      "/repo/flows/a.js",
    );
    expect(resolveConfinedWorkflowPath("/repo", "/repo/flows/a.js")).toBe(
      "/repo/flows/a.js",
    );
    expect(() =>
      resolveConfinedWorkflowPath("/repo", "/outside/flow.js"),
    ).toThrow("inside the origin workspace");
    expect(() => resolveConfinedWorkflowPath("/repo", "../secret.js")).toThrow(
      "stay inside",
    );
    expect(() =>
      resolveConfinedWorkflowPath("/repo", "C:\\outside\\flow.js"),
    ).toThrow("absolute path form");
    expect(resolveConfinedWorkflowPath("C:\\repo", "flows\\a.js")).toBe(
      "C:\\repo\\flows\\a.js",
    );
    expect(
      resolveConfinedWorkflowPath(
        "\\\\server\\share\\repo",
        "\\\\server\\share\\repo\\flows\\a.js",
      ),
    ).toBe("\\\\server\\share\\repo\\flows\\a.js");
    expect(() =>
      resolveConfinedWorkflowPath("C:\\repo", "\\\\server\\share\\a.js"),
    ).toThrow("inside the origin workspace");
  });

  it("resolves names on the origin host under .bb/workflows", async () => {
    const readFile = vi.fn(dependencies().readFile);
    const resolved = await resolveWorkflowSource(
      { name: "review-change" },
      { projectId: "project-1", threadId: "thread-1" },
      dependencies({ readFile }),
    );
    expect(readFile).toHaveBeenCalledWith({
      hostId: "host-1",
      rootPath: "/workspace/project",
      path: "/workspace/project/.bb/workflows/review-change.js",
    });
    expect(resolved.origin).toEqual({
      kind: "name",
      name: "review-change",
      path: "/workspace/project/.bb/workflows/review-change.js",
      location: "workspace",
    });
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("falls back to the shared data dir copy when the workspace has none", async () => {
    const readFile = vi.fn(
      async (input: { hostId: string; path: string; rootPath: string }) => {
        if (input.rootPath === "/workspace/project") {
          throw missingFile(input.path);
        }
        return {
          content: "shared",
          contentEncoding: "utf8" as const,
          sizeBytes: 6,
        };
      },
    );
    const resolved = await resolveWorkflowSource(
      { name: "review-change" },
      { projectId: "project-1", environmentId: "env-1" },
      dependencies({ readFile }),
    );
    expect(readFile).toHaveBeenLastCalledWith({
      hostId: "host-1",
      rootPath: "/data/workflows",
      path: "/data/workflows/review-change.js",
    });
    expect(resolved).toMatchObject({
      source: "shared",
      origin: {
        kind: "name",
        name: "review-change",
        path: "/data/workflows/review-change.js",
        location: "shared",
      },
    });
  });

  it("reports both locations when neither has the named workflow", async () => {
    await expect(
      resolveWorkflowSource(
        { name: "review-change" },
        { projectId: "project-1", threadId: "thread-1" },
        dependencies({
          readFile: async ({ path }) => {
            throw missingFile(path);
          },
        }),
      ),
    ).rejects.toThrow(
      "Workflow review-change not found in /workspace/project/.bb/workflows/review-change.js or /data/workflows/review-change.js",
    );
  });

  it("rejects name escapes and does not fall back past a refused read", async () => {
    const readFile = vi.fn(dependencies().readFile);
    for (const name of ["../secret", "a/b", "Review"]) {
      await expect(
        resolveWorkflowSource(
          { name },
          { projectId: "project-1", threadId: "thread-1" },
          dependencies({ readFile }),
        ),
      ).rejects.toThrow("lowercase kebab-case");
    }
    expect(readFile).not.toHaveBeenCalled();

    const escapes = (rootPath: string) =>
      vi.fn(async (input: { path: string; rootPath: string }) => {
        if (input.rootPath !== rootPath) throw missingFile(input.path);
        throw Object.assign(
          new Error(`HTTP 400: Path "${input.path}" escapes read root`),
          { status: 400 },
        );
      });
    const workspaceEscape = escapes("/workspace/project");
    await expect(
      resolveWorkflowSource(
        { name: "review-change" },
        { projectId: "project-1", threadId: "thread-1" },
        dependencies({ readFile: workspaceEscape }),
      ),
    ).rejects.toThrow("escapes read root");
    expect(workspaceEscape).toHaveBeenCalledTimes(1);
    await expect(
      resolveWorkflowSource(
        { name: "review-change" },
        { projectId: "project-1", threadId: "thread-1" },
        dependencies({ readFile: escapes("/data/workflows") }),
      ),
    ).rejects.toThrow("escapes read root");
  });

  it("resolves from persisted environment identity without consulting the origin thread", async () => {
    const getThreadEnvironmentId = vi.fn(async () => {
      throw new Error("origin thread was deleted");
    });
    const readFile = vi.fn(dependencies().readFile);
    await expect(
      resolveWorkflowSource(
        { scriptPath: "flows/child.js" },
        { projectId: "project-1", environmentId: "env-1" },
        dependencies({ getThreadEnvironmentId, readFile }),
      ),
    ).resolves.toMatchObject({
      environmentId: "env-1",
      origin: {
        kind: "scriptPath",
        path: "/workspace/project/flows/child.js",
      },
    });
    expect(getThreadEnvironmentId).not.toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith({
      hostId: "host-1",
      rootPath: "/workspace/project",
      path: "/workspace/project/flows/child.js",
    });
  });

  it("resolves CLI-relative files from cwd without weakening workspace confinement", async () => {
    const readFile = vi.fn(dependencies().readFile);
    await resolveWorkflowSource(
      {
        scriptPath: "flows/review.js",
        scriptPathBase: "/workspace/project/packages/app",
      },
      { projectId: "project-1", threadId: "thread-1" },
      dependencies({ readFile }),
    );
    expect(readFile).toHaveBeenCalledWith({
      hostId: "host-1",
      rootPath: "/workspace/project",
      path: "/workspace/project/packages/app/flows/review.js",
    });
    await expect(
      resolveWorkflowSource(
        { scriptPath: "flow.js", scriptPathBase: "/outside" },
        { projectId: "project-1", threadId: "thread-1" },
        dependencies(),
      ),
    ).rejects.toThrow("inside the origin workspace");
    await expect(
      resolveWorkflowSource(
        {
          scriptPath: "../../../secret.js",
          scriptPathBase: "/workspace/project/packages/app",
        },
        { projectId: "project-1", threadId: "thread-1" },
        dependencies(),
      ),
    ).rejects.toThrow("inside the origin workspace");
  });

  it("rejects missing roots, cross-project environments, non-UTF8, and oversized files", async () => {
    const context = { projectId: "project-1", threadId: "thread-1" };
    await expect(
      resolveWorkflowSource(
        { scriptPath: "flow.js" },
        context,
        dependencies({
          getEnvironment: async () => ({
            id: "env-1",
            projectId: "project-1",
            hostId: "host-1",
            path: null,
          }),
        }),
      ),
    ).rejects.toThrow("no workspace path");
    await expect(
      resolveWorkflowSource(
        { scriptPath: "flow.js" },
        context,
        dependencies({
          getEnvironment: async () => ({
            id: "env-1",
            projectId: "other-project",
            hostId: "host-1",
            path: "/repo",
          }),
        }),
      ),
    ).rejects.toThrow("another project");
    await expect(
      resolveWorkflowSource(
        { scriptPath: "flow.js" },
        context,
        dependencies({
          readFile: async () => ({
            content: "AA==",
            contentEncoding: "base64",
            sizeBytes: 1,
          }),
        }),
      ),
    ).rejects.toThrow("not valid UTF-8");
    await expect(
      resolveWorkflowSource(
        { scriptPath: "flow.js" },
        context,
        dependencies({
          readFile: async () => ({
            content: "x",
            contentEncoding: "utf8",
            sizeBytes: MAX_WORKFLOW_SOURCE_BYTES + 1,
          }),
        }),
      ),
    ).rejects.toThrow("exceeds");
  });
});
