import {
  archiveThread,
  createThread,
  deleteThread,
  setProjectGitRemoteUrlIfMissing,
  upsertThreadSearchSegments,
} from "@bb/db";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { readJson } from "../helpers/json.js";
import { seedHost, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const searchResponseSchema = z.object({
  query: z.string(),
  groups: z.array(
    z.object({
      kind: z.string(),
      results: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          subtitle: z.string().optional(),
          thread: z.object({ id: z.string() }).optional(),
          highlights: z.array(
            z.object({ field: z.string(), start: z.number(), end: z.number() }),
          ),
          snippet: z.string().optional(),
          messageAnchor: z.number().optional(),
          archived: z.boolean().optional(),
        }),
      ),
      nextCursor: z.string().optional(),
    }),
  ),
});

function requestPath(
  query: string,
  params: Record<string, string> = {},
): string {
  return `/api/v1/search?${new URLSearchParams({ query, ...params })}`;
}

describe("public search", () => {
  it("returns canonical groups and ranked, visible thread results", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps, { name: "Search Host" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Search Project",
      });
      const exact = createThread(harness.db, harness.hub, {
        projectId: project.id,
        providerId: "codex",
        title: "café",
      });
      const archived = createThread(harness.db, harness.hub, {
        projectId: project.id,
        providerId: "codex",
        title: "café notes",
      });
      archiveThread(harness.db, harness.hub, archived.id);
      const content = createThread(harness.db, harness.hub, {
        projectId: project.id,
        providerId: "codex",
        title: "draft",
      });
      upsertThreadSearchSegments(harness.db, {
        segments: [
          {
            threadId: content.id,
            sourceKind: "user_message",
            sourceKey: "one",
            sourceSeq: 7,
            text: "I like café options",
          },
        ],
      });
      const deleted = createThread(harness.db, harness.hub, {
        projectId: project.id,
        providerId: "codex",
        title: "café removed",
      });
      deleteThread(harness.db, harness.hub, deleted.id);
      createThread(harness.db, harness.hub, {
        projectId: project.id,
        providerId: "codex",
        title: "café hidden",
        visibility: "hidden",
      });

      const response = await harness.app.request(requestPath(" CAFÉ "));
      expect(response.status).toBe(200);
      const body = searchResponseSchema.parse(await readJson(response));
      expect(body.query).toBe("cafe");
      const threads =
        body.groups.find((group) => group.kind === "threads")?.results ?? [];
      expect(threads.map((row) => row.id)).toEqual([
        `thread:${exact.id}`,
        `thread:${archived.id}`,
        `thread:${content.id}`,
      ]);
      expect(threads[0]?.highlights).toContainEqual({
        field: "label",
        start: 0,
        end: 4,
      });
      expect(threads[0]?.thread?.id).toBe(exact.id);
      expect(threads[1]?.archived).toBe(true);
      expect(threads[2]).toMatchObject({
        messageAnchor: 7,
        snippet: "I like café options",
      });
      expect(body.groups.some((group) => group.kind === "projects")).toBe(
        false,
      );
      const fuzzy = searchResponseSchema.parse(
        await readJson(await harness.app.request(requestPath("cfaé"))),
      );
      expect(
        fuzzy.groups
          .find((group) => group.kind === "threads")
          ?.results.map((row) => row.id),
      ).toContain(`thread:${exact.id}`);
    });
  });

  it("displays repository identity without credentials or query parameters", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Codebase",
      });
      setProjectGitRemoteUrlIfMissing(
        harness.db,
        harness.hub,
        project.id,
        "https://alice:private-token@github.com/team/repo.git?secret=private-token#fragment",
      );
      const response = await harness.app.request(requestPath("repo"));
      const rawBody = await readJson(response);
      const body = searchResponseSchema.parse(rawBody);
      const projects =
        body.groups.find((group) => group.kind === "projects")?.results ?? [];
      expect(projects).toHaveLength(1);
      expect(projects[0]).toMatchObject({ id: `project:${project.id}` });
      expect(JSON.stringify(rawBody)).toContain("github.com/team/repo");
      expect(JSON.stringify(rawBody)).not.toContain("private-token");
      const credentialSearch = searchResponseSchema.parse(
        await readJson(await harness.app.request(requestPath("private-token"))),
      );
      expect(
        credentialSearch.groups.find((group) => group.kind === "projects"),
      ).toBeUndefined();
    });
  });

  it("continues one group and rejects malformed or mismatched cursors", async () => {
    await withTestHarness(async (harness) => {
      const host = seedHost(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        name: "Pagination",
      });
      for (let index = 0; index < 23; index += 1)
        createThread(harness.db, harness.hub, {
          projectId: project.id,
          providerId: "codex",
          title: `needle ${index}`,
        });
      const firstResponse = await harness.app.request(requestPath("needle"));
      const first = searchResponseSchema.parse(await readJson(firstResponse));
      const firstThreads = first.groups.find(
        (group) => group.kind === "threads",
      );
      expect(firstThreads?.results).toHaveLength(20);
      expect(firstThreads?.nextCursor).toBeDefined();
      const secondResponse = await harness.app.request(
        requestPath("needle", { cursor: firstThreads!.nextCursor! }),
      );
      expect(secondResponse.status).toBe(200);
      const second = searchResponseSchema.parse(await readJson(secondResponse));
      expect(second.groups).toHaveLength(1);
      expect(second.groups[0]?.results).toHaveLength(3);
      expect(
        new Set(
          [...firstThreads!.results, ...second.groups[0]!.results].map(
            (row) => row.id,
          ),
        ).size,
      ).toBe(23);

      const tampered = JSON.parse(
        Buffer.from(firstThreads!.nextCursor!, "base64url").toString("utf8"),
      );
      tampered.thread.updatedAt = "Infinity";
      const invalidCursor = Buffer.from(JSON.stringify(tampered)).toString(
        "base64url",
      );
      expect(
        (
          await harness.app.request(
            requestPath("needle", { cursor: invalidCursor }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await harness.app.request(
            requestPath("different", { cursor: firstThreads!.nextCursor! }),
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await harness.app.request(
            requestPath("needle", {
              cursor: firstThreads!.nextCursor!,
              contextProjectId: project.id,
            }),
          )
        ).status,
      ).toBe(400);
    });
  });

  it("validates Unicode query length and strict limits, including empty queries", async () => {
    await withTestHarness(async (harness) => {
      expect(
        (await harness.app.request(requestPath("😀".repeat(256)))).status,
      ).toBe(200);
      expect(
        (await harness.app.request(requestPath("😀".repeat(257)))).status,
      ).toBe(400);
      for (const limitPerGroup of [
        "0",
        "51",
        "1.5",
        "1e1",
        "Infinity",
        "NaN",
      ]) {
        expect(
          (await harness.app.request(requestPath(" ", { limitPerGroup })))
            .status,
        ).toBe(400);
      }
      expect((await harness.app.request(requestPath("  "))).status).toBe(200);
    });
  });
});
