import {
  createThread,
  getThread,
  listEvents,
  updateThread,
  markThreadDeleted,
} from "@bb/db";
import {
  type ResolvedThreadExecutionOptions,
  systemThreadProvisioningEventDataSchema,
  threadSchema,
  turnScope,
  threadScope,
  encodeClientTurnRequestIdNumber,
} from "@bb/domain";
import { groupHostDaemonEvents } from "@bb/host-daemon-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  internalAuthHeaders,
  listQueuedThreadCommands,
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
  waitForQueuedCommandAfter,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import { skillInput, textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedStoredEvent,
  seedThreadIdentity,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  createTestAppHarness,
  withTestHarness,
  type TestAppHarness,
} from "../helpers/test-app.js";
import { installFakeGitWorktreeProvider } from "../helpers/environment-provider.js";
import { OpenRouterRequestError } from "../../src/services/ai/openrouter.js";
import { runEnvironmentProvisioningSweep } from "../../src/services/system/periodic-sweeps.js";
import { createThreadFromRequest } from "../../src/services/threads/thread-create.js";
import { requestThreadStopForCurrentState } from "../../src/services/threads/thread-lifecycle.js";
import {
  advanceThreadProvisioning,
  requestThreadProvision,
} from "../../src/services/threads/thread-provisioning.js";
import { generateThreadMetadataWithOutcome } from "../../src/services/threads/title-generation.js";
import { appendClientTurnEvent } from "../../src/services/threads/thread-events.js";
import { installOpenRouterChatCompat } from "../helpers/openrouter.js";

const openRouter = installOpenRouterChatCompat();

interface MockThreadMetadata {
  title?: string;
}

function mockThreadMetadataCompletion(metadata: MockThreadMetadata) {
  return {
    content: [
      {
        arguments: metadata,
        id: "tool_result",
        name: "result",
        type: "toolCall",
      },
    ],
  };
}

function mockThreadMetadata(metadata: MockThreadMetadata): void {
  openRouter.complete.mockResolvedValue(mockThreadMetadataCompletion(metadata));
}

function pendingThreadMetadata(): (metadata: MockThreadMetadata) => void {
  let resolveMetadata: (metadata: MockThreadMetadata) => void = () => {
    throw new Error("Metadata inference was not started");
  };
  openRouter.complete.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolveMetadata = (metadata) => {
          resolve(mockThreadMetadataCompletion(metadata));
        };
      }),
  );
  return (metadata) => {
    resolveMetadata(metadata);
  };
}

const THREAD_START_EXECUTION = {
  model: "gpt-5",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "accept-edits",
  source: "client/turn/requested",
} satisfies ResolvedThreadExecutionOptions;

interface CreateManagedWorktreeThreadArgs {
  hostId: string;
  projectId: string;
  text: string;
  title?: string;
}

async function createManagedWorktreeThread(
  harness: TestAppHarness,
  args: CreateManagedWorktreeThreadArgs,
) {
  const response = await harness.app.request("/api/v1/threads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      origin: "app",
      projectId: args.projectId,
      providerId: "codex",
      model: "gpt-5",
      ...(args.title === undefined ? {} : { title: args.title }),
      input: [{ type: "text", text: args.text }],
      environment: {
        type: "host",
        hostId: args.hostId,
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "default" },
        },
      },
    }),
  });
  expect(response.status).toBe(201);
  return threadSchema.parse(await readJson(response));
}

function provisioningEntries(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId })
    .filter((event) => event.type === "system/thread-provisioning")
    .flatMap(
      (event) =>
        systemThreadProvisioningEventDataSchema.parse(JSON.parse(event.data))
          .entries,
    );
}

describe("generated thread titles", () => {
  beforeEach(() => {
    openRouter.complete.mockReset();
    openRouter.requests.length = 0;
  });

  it("resolves a managed-worktree request to the worktree provider once the title is generated", async () => {
    mockThreadMetadata({ title: "Improve Branch Names" });
    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-generated-branch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-branch-project",
      });

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Improve the generated branch naming path",
      });
      expect(thread.title).toBeNull();

      const context = await provider.waitForProvision();
      expect(context.thread.id).toBe(thread.id);
      expect(context.thread.title).toBe("Improve Branch Names");
      expect(context.host?.id).toBe(host.id);
      expect(context.inputs).toEqual({ branch: { kind: "default" } });
      expect(getThread(harness.db, thread.id)?.title).toBe(
        "Improve Branch Names",
      );
      expect(openRouter.complete).toHaveBeenCalledTimes(1);
    });
  });

  it("opens the workspace-setup block before metadata inference completes", async () => {
    const resolveMetadata = pendingThreadMetadata();

    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-managed-early-provisioning-row",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/managed-early-provisioning-row-project",
      });

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Show provisioning before generated branch metadata finishes",
      });

      await vi.waitFor(() => {
        expect(openRouter.complete).toHaveBeenCalledTimes(1);
        expect(provisioningEntries(harness, thread.id)[0]?.key).toBe(
          "workspace-started",
        );
      });
      expect(getThread(harness.db, thread.id)?.environmentId).toBeNull();
      expect(provider.contexts).toHaveLength(0);

      resolveMetadata({ title: "Early Visible Provisioning" });

      const context = await provider.waitForProvision();
      expect(context.thread.title).toBe("Early Visible Provisioning");
    });
  });

  it("does not fail a stopped thread when metadata inference settles", async () => {
    const resolveMetadata = pendingThreadMetadata();

    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-stop-during-metadata",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/stop-during-metadata-project",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "starting",
        title: null,
        titleFallback: "Stop during metadata inference",
      });
      const input = textInput("Stop during metadata inference before setup");
      requestThreadProvision(harness.deps, {
        environmentIntent: {
          type: "provider",
          environmentProviderId: "git-worktree",
          machine: { type: "existing", hostId: host.id },
          inputs: { branch: { kind: "default" } },
          selectionResolved: true,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input,
        startedOnBehalfOf: null,
        thread,
        titleProvided: false,
      });
      const advance = advanceThreadProvisioning(harness.deps, {
        threadId: thread.id,
      });

      await vi.waitFor(() => {
        expect(openRouter.complete).toHaveBeenCalledTimes(1);
      });

      const startingThread = getThread(harness.db, thread.id);
      if (!startingThread) {
        throw new Error("Expected the starting thread");
      }
      expect(startingThread.environmentId).toBeNull();
      requestThreadStopForCurrentState(harness.deps, startingThread, null);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
      });

      resolveMetadata({ title: "Stopped Metadata Race" });
      await advance;

      expect(getThread(harness.db, thread.id)).toMatchObject({
        status: "idle",
      });
      const events = listEvents(harness.db, { threadId: thread.id });
      expect(events.map((event) => event.type)).not.toContain("system/error");
      expect(provider.contexts).toHaveLength(0);
      expect(getThread(harness.db, thread.id)?.environmentId).toBeNull();
    });
  });

  it("does not fail a thread waiting on metadata during provisioning sweeps", async () => {
    const resolveMetadata = pendingThreadMetadata();

    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-managed-prepared-sweep",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/managed-prepared-sweep-project",
      });

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Keep prepared provisioning safe during sweeps",
      });

      await vi.waitFor(() => {
        expect(openRouter.complete).toHaveBeenCalledTimes(1);
        expect(provisioningEntries(harness, thread.id)).not.toHaveLength(0);
      });

      await runEnvironmentProvisioningSweep(harness.deps);

      expect(getThread(harness.db, thread.id)?.status).toBe("starting");
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).not.toContain("system/error");

      resolveMetadata({ title: "Prepared Sweep Safe" });

      const context = await provider.waitForProvision();
      expect(context.thread.title).toBe("Prepared Sweep Safe");
    });
  });

  it("retries provider-path metadata inference after a transient failure", async () => {
    openRouter.complete
      .mockRejectedValueOnce(
        new OpenRouterRequestError("service_unavailable", "overloaded"),
      )
      .mockResolvedValueOnce(
        mockThreadMetadataCompletion({
          title: "Recovered Managed Metadata",
        }),
      );
    await withTestHarness(async (harness) => {
      const provider = installFakeGitWorktreeProvider();
      const { host } = seedHostSession(harness.deps, {
        id: "host-managed-metadata-retry",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/managed-metadata-retry-project",
      });

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Recover managed metadata after transient timeout",
      });

      const context = await provider.waitForProvision();
      expect(context.thread.title).toBe("Recovered Managed Metadata");
      expect(getThread(harness.db, thread.id)?.title).toBe(
        "Recovered Managed Metadata",
      );
      expect(openRouter.complete).toHaveBeenCalledTimes(2);
    });
  });

  it("queues a daemon rename after a generated title thread starts", async () => {
    mockThreadMetadata({ title: "Generated Rename Title" });
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-generated-title-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-title-rename-project",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/generated-title-rename-workspace",
        status: "ready",
      });
      installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: host.id,
          path: "/tmp/generated-title-rename-workspace",
        },
      }));

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Generate a title then sync it after startup",
      });
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-generated-title-rename" },
        { hostId: host.id },
      );

      const rename = await waitForQueuedCommandAfter(
        harness,
        start.row.cursor,
        ({ command }) =>
          command.type === "thread.rename" && command.threadId === thread.id,
      );
      expect(rename.command).toMatchObject({
        type: "thread.rename",
        threadId: thread.id,
        title: "Generated Rename Title",
      });
    });
  });

  it("generates titles for submitted fork threads", async () => {
    mockThreadMetadata({ title: "Generated Fork Title" });

    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-generated-fork-title",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/generated-fork-title-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/generated-fork-title-project",
        status: "ready",
      });
      const sourceThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      seedThreadIdentity(harness.deps, {
        threadId: sourceThread.id,
        providerThreadId: "provider-generated-fork-title-source",
      });
      seedTurnStarted(harness.deps, {
        threadId: sourceThread.id,
        turnId: "turn-generated-fork-title-source",
        providerThreadId: "provider-generated-fork-title-source",
      });

      const input = textInput("Continue this fork and generate a useful title");
      const fork = await createThreadFromRequest(harness.deps, {
        environment: { type: "reuse", environmentId: environment.id },
        input,
        model: "gpt-5",
        origin: "app",
        originKind: "fork",
        projectId: project.id,
        providerId: "codex",
        sourceThreadId: sourceThread.id,
        startedOnBehalfOf: null,
      });

      expect(getThread(harness.db, fork.id)?.titleFallback).toBe(
        "Continue this fork and generate a useful title",
      );

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === fork.id,
      );
      if (start.command.type !== "thread.start") {
        throw new Error("Expected a thread.start command");
      }
      expect(start.command.input).toEqual(input);
      expect(start.command.fork).toEqual({
        sourceProviderThreadId: "provider-generated-fork-title-source",
      });

      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-generated-fork-title" },
        { hostId: host.id },
      );

      await vi.waitFor(() => {
        expect(getThread(harness.db, fork.id)?.title).toBe(
          "Generated Fork Title",
        );
      });
    });
  });
  it("does not queue a daemon rename for user-supplied titles", async () => {
    mockThreadMetadata({ title: "Generated Title" });
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-user-title-no-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/user-title-no-rename-project",
      });
      seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/user-title-no-rename-workspace",
        status: "ready",
      });
      installFakeGitWorktreeProvider(() => ({
        action: "ready",
        environment: {
          type: "host",
          hostId: host.id,
          path: "/tmp/user-title-no-rename-workspace",
        },
      }));

      const thread = await createManagedWorktreeThread(harness, {
        hostId: host.id,
        projectId: project.id,
        text: "Use the user supplied title without daemon rename",
        title: "User Picked Title",
      });
      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-user-title-no-rename" },
        { hostId: host.id },
      );

      await expect(
        waitForQueuedCommandAfter(
          harness,
          start.row.cursor,
          ({ command }) =>
            command.type === "thread.rename" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
      expect(openRouter.complete).not.toHaveBeenCalled();
    });
  });

  it("retries after a transient failure and renames an idle non-managed thread", async () => {
    let resolveMetadata: (metadata: MockThreadMetadata) => void = () => {
      throw new Error("Metadata inference was not started");
    };
    openRouter.complete
      .mockRejectedValueOnce(
        new OpenRouterRequestError(
          "service_unavailable",
          "Our servers are currently overloaded. Please try again later.",
        ),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveMetadata = (metadata) => {
              resolve(mockThreadMetadataCompletion(metadata));
            };
          }),
      );

    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-idle-late-title-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/idle-late-title-rename-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/idle-late-title-rename-workspace",
        status: "ready",
      });
      const thread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "starting",
        title: null,
        titleFallback: "Idle late title rename",
      });

      requestThreadProvision(harness.deps, {
        environmentIntent: {
          type: "reuse",
          environmentId: environment.id,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("Generate a title for this non-managed reuse thread"),
        startedOnBehalfOf: null,
        thread,
        titleProvided: false,
      });
      await advanceThreadProvisioning(harness.deps, {
        threadId: thread.id,
      });

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandSuccess(
        harness,
        start,
        { providerThreadId: "provider-idle-late-title" },
        { hostId: host.id },
      );
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(getThread(harness.db, thread.id)?.title).toBeNull();

      const eventsResponse = await harness.app.request(
        "/internal/session/events",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            eventGroups: groupHostDaemonEvents([
              {
                threadId: thread.id,
                event: {
                  type: "turn/started",
                  threadId: thread.id,
                  providerThreadId: "provider-idle-late-title",
                  scope: turnScope("turn-idle-late-title"),
                },
              },
              {
                threadId: thread.id,
                event: {
                  type: "turn/completed",
                  threadId: thread.id,
                  providerThreadId: "provider-idle-late-title",
                  scope: turnScope("turn-idle-late-title"),
                  status: "completed",
                },
              },
            ]),
          }),
        },
      );
      expect(eventsResponse.status).toBe(200);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");

      await vi.waitFor(() => {
        expect(openRouter.complete).toHaveBeenCalledTimes(2);
      });

      resolveMetadata({ title: "Late Idle Title" });

      const rename = await waitForQueuedCommandAfter(
        harness,
        start.row.cursor,
        ({ command }) =>
          command.type === "thread.rename" && command.threadId === thread.id,
      );
      expect(rename.command).toMatchObject({
        type: "thread.rename",
        threadId: thread.id,
        title: "Late Idle Title",
      });
      expect(getThread(harness.db, thread.id)?.title).toBe("Late Idle Title");
    });
  });

  it("does not rename a non-managed thread that errored before its title landed", async () => {
    let resolveMetadata: (metadata: MockThreadMetadata) => void = () => {
      throw new Error("Metadata inference was not started");
    };
    openRouter.complete.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveMetadata = (metadata) => {
            resolve(mockThreadMetadataCompletion(metadata));
          };
        }),
    );

    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-errored-late-title-no-rename",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/errored-late-title-no-rename-project",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/errored-late-title-no-rename-workspace",
        status: "ready",
      });
      const thread = createThread(harness.db, harness.hub, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        status: "starting",
        title: null,
        titleFallback: "Errored late title no rename",
      });

      requestThreadProvision(harness.deps, {
        environmentIntent: {
          type: "reuse",
          environmentId: environment.id,
        },
        execution: THREAD_START_EXECUTION,
        fork: null,
        input: textInput("Generate a title for this non-managed reuse thread"),
        startedOnBehalfOf: null,
        thread,
        titleProvided: false,
      });
      await advanceThreadProvisioning(harness.deps, {
        threadId: thread.id,
      });

      const start = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "thread.start" && command.threadId === thread.id,
      );
      await reportQueuedCommandError(
        harness,
        start,
        {
          errorCode: "thread_start_failed",
          errorMessage: "Thread start failed",
        },
        { hostId: host.id },
      );
      expect(getThread(harness.db, thread.id)?.status).toBe("error");

      resolveMetadata({ title: "Errored Late Title" });

      await expect(
        waitForQueuedCommandAfter(
          harness,
          start.row.cursor,
          ({ command }) =>
            command.type === "thread.rename" && command.threadId === thread.id,
          100,
        ),
      ).rejects.toThrow("Timed out waiting for queued command");
      expect(
        listQueuedThreadCommands(harness, "thread.rename", thread.id),
      ).toEqual([]);
    });
  });
  it("skips inference entirely when no OpenRouter key is configured", async () => {
    await withTestHarness(
      {
        openRouterApiKey: "",
      },
      async (harness) => {
        await expect(
          generateThreadMetadataWithOutcome(harness.deps, {
            input: textInput("Improve the generated title fallback path"),
            threadId: "thr_inference_unavailable",
          }),
        ).resolves.toMatchObject({
          metadata: null,
          reason: "inference-unavailable",
        });
        expect(openRouter.complete).not.toHaveBeenCalled();
      },
    );
  });

  it("returns no metadata when inference times out", async () => {
    openRouter.complete.mockReturnValue(new Promise(() => undefined));
    const harness = await createTestAppHarness();
    const infoSpy = vi.spyOn(harness.deps.logger, "info");
    try {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Improve timed out metadata generation behavior"),
          threadId: "thr_timeout",
          timeoutMs: 1,
        }),
      ).resolves.toMatchObject({
        metadata: null,
        reason: "timeout",
      });
      expect(openRouter.complete).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 1,
          threadId: "thr_timeout",
          timeoutMs: 1,
        }),
        "Thread metadata inference timed out",
      );
    } finally {
      infoSpy.mockRestore();
      await harness.cleanup();
    }
  });

  it("retries once when metadata inference times out", async () => {
    openRouter.complete
      .mockReturnValueOnce(new Promise(() => undefined))
      .mockResolvedValueOnce(
        mockThreadMetadataCompletion({
          title: "Recovered Metadata",
        }),
      );
    const harness = await createTestAppHarness();
    const infoSpy = vi.spyOn(harness.deps.logger, "info");
    try {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Improve timed out metadata generation behavior"),
          threadId: "thr_retry_timeout",
          timeoutMaxAttempts: 2,
          timeoutMs: 1,
        }),
      ).resolves.toMatchObject({
        metadata: { title: "Recovered Metadata" },
      });
      expect(openRouter.complete).toHaveBeenCalledTimes(2);
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 2,
          threadId: "thr_retry_timeout",
          timeoutMs: 1,
        }),
        "Thread metadata inference failed transiently; retrying",
      );
      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 2,
          threadId: "thr_retry_timeout",
        }),
        "Thread metadata inference completed after retry",
      );
    } finally {
      infoSpy.mockRestore();
      await harness.cleanup();
    }
  });

  it("retries transient OpenRouter failures", async () => {
    openRouter.complete
      .mockRejectedValueOnce(
        new OpenRouterRequestError(
          "service_unavailable",
          "Our servers are currently overloaded. Please try again later.",
        ),
      )
      .mockResolvedValueOnce(
        mockThreadMetadataCompletion({
          title: "Recovered Metadata",
        }),
      );

    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Recover transient metadata provider failures"),
          threadId: "thr_retry_service_unavailable",
          timeoutMaxAttempts: 2,
          timeoutMs: 1_000,
        }),
      ).resolves.toMatchObject({
        metadata: { title: "Recovered Metadata" },
      });
      expect(openRouter.complete).toHaveBeenCalledTimes(2);
    });
  });

  it("titles a skill invocation from the task, not the command token", async () => {
    mockThreadMetadata({ title: "Drop stale release branches" });
    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: skillInput("sync-repo", " and drop the stale release branches"),
          threadId: "thr_skill_metadata",
        }),
      ).resolves.toMatchObject({
        metadata: { title: "Drop stale release branches" },
      });
      const prompt = openRouter.prompt(0);
      expect(prompt).toContain("and drop the stale release branches");
      expect(prompt).toContain(
        "The prompt invokes these commands or skills: /sync-repo.",
      );
      expect(prompt).not.toContain("/sync-repo and drop");
    });
  });

  it.each(["调", "𠮷"])(
    "clamps the task after stripping commands without splitting %s",
    async (character) => {
      mockThreadMetadata({ title: "Investigate the reported issue" });
      await withTestHarness(async (harness) => {
        const input = skillInput("review", ` ${character.repeat(60)}`);
        const original = structuredClone(input);
        await generateThreadMetadataWithOutcome(harness.deps, {
          input,
          threadId: "thr_unicode_skill_metadata",
        });
        const prompt = openRouter.prompt(0);
        expect(prompt).toContain(
          "The prompt invokes these commands or skills: /review.",
        );
        expect(prompt).toContain(`Task:\n${character.repeat(38)}...`);
        expect(prompt).not.toContain(character.repeat(39));
        expect(input).toEqual(original);
      });
    },
  );

  it("titles a bare skill invocation from what the skill does", async () => {
    mockThreadMetadata({ title: "Generate the weekly report" });
    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: skillInput("weekly-report"),
          threadId: "thr_bare_skill_metadata",
        }),
      ).resolves.toMatchObject({
        metadata: { title: "Generate the weekly report" },
      });
      expect(
        openRouter.prompt(0),
      ).toContain(
        "The prompt invokes these commands or skills: /weekly-report.",
      );
      expect(
        openRouter.prompt(0),
      ).toContain("Task:\n/weekly-report");
    });
  });

  it("does not retry non-transient metadata inference failures", async () => {
    openRouter.complete.mockRejectedValue(new Error("metadata failed"));
    await withTestHarness(async (harness) => {
      await expect(
        generateThreadMetadataWithOutcome(harness.deps, {
          input: textInput("Improve failed metadata generation behavior"),
          threadId: "thr_failed_metadata",
          timeoutMaxAttempts: 2,
          timeoutMs: 1,
        }),
      ).resolves.toMatchObject({
        metadata: null,
        reason: "failed",
      });
      expect(openRouter.complete).toHaveBeenCalledTimes(1);
      expect(
        openRouter.prompt(0),
      ).not.toContain("The prompt invokes these commands or skills");
    });
  });
});

describe("generate thread title endpoint", () => {
  beforeEach(() => {
    openRouter.complete.mockReset();
    openRouter.requests.length = 0;
  });

  function seedTitleTask(
    harness: TestAppHarness,
    text = "Fix the flaky login button behavior",
  ) {
    const { host } = seedHostSession(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      title: "Original title",
    });
    function appendInput(
      inputText: string,
      markStart: boolean,
      initiator: "user" | "agent" = "user",
    ) {
      appendClientTurnEvent(harness.deps, {
        threadId: thread.id,
        environmentId: null,
        type: "client/turn/requested",
        input: textInput(inputText),
        execution: THREAD_START_EXECUTION,
        initiator,
        senderThreadId: initiator === "agent" ? "parent-thread" : null,
        requestMethod: "thread/start",
        source: "spawn",
        target: { kind: "thread-start" },
      });
      if (markStart)
        appendClientTurnEvent(harness.deps, {
          threadId: thread.id,
          environmentId: null,
          type: "client/thread/start",
          initiator,
          requestMethod: "thread/start",
          source: "spawn",
        });
    }
    if (text) appendInput(text, true);
    return {
      thread,
      appendInput,
      request: () =>
        harness.app.request(`/api/v1/threads/${thread.id}/generate-title`, {
          method: "POST",
        }),
    };
  }

  it.each([
    ["openai/gpt-6-luna", "none"],
    ["openai/o3", "low"],
  ])("uses supported title reasoning for %s", async (inferenceModel, effort) => {
    mockThreadMetadata({ title: "Fix Login Behavior" });
    await withTestHarness({ inferenceModel }, async (harness) => {
      const { request } = seedTitleTask(harness);
      expect((await request()).status).toBe(200);
      expect(openRouter.requests).toHaveLength(1);
      expect(openRouter.requests[0]?.body).toMatchObject({
        model: inferenceModel,
        reasoning: { effort },
        provider: { sort: "latency" },
      });
    });
  });

  it("replaces a title using the original task and returns the updated thread", async () => {
    mockThreadMetadata({ title: "Fix Login Behavior" });
    await withTestHarness(async (harness) => {
      const { thread, appendInput, request } = seedTitleTask(harness);
      appendInput("Ignore the original task and discuss different work", false);
      const response = await request();
      expect(response.status).toBe(200);
      expect(threadSchema.parse(await readJson(response)).title).toBe(
        "Fix Login Behavior",
      );
      expect(getThread(harness.db, thread.id)?.title).toBe(
        "Fix Login Behavior",
      );
      expect(JSON.stringify(openRouter.requests)).toContain(
        "Fix the flaky login button behavior",
      );
      expect(JSON.stringify(openRouter.requests)).not.toContain(
        "discuss different work",
      );
    });
  });

  it("uses the local start input after inherited fork history, including agent-authored tasks", async () => {
    mockThreadMetadata({ title: "Child Task" });
    await withTestHarness(async (harness) => {
      const { appendInput, request } = seedTitleTask(harness, "");
      appendInput("Inherited source task must not be selected", false);
      appendInput(
        "Implement a separate child task for this fork",
        true,
        "agent",
      );
      expect((await request()).status).toBe(200);
      expect(JSON.stringify(openRouter.requests)).toContain(
        "separate child task",
      );
      expect(JSON.stringify(openRouter.requests)).not.toContain(
        "Inherited source task",
      );
    });
  });

  it("uses a legacy start event's own input instead of earlier requests", async () => {
    mockThreadMetadata({ title: "Legacy title" });
    await withTestHarness(async (harness) => {
      const { thread, appendInput, request } = seedTitleTask(harness, "");
      appendInput("Inherited source task must not be selected", false);
      seedStoredEvent(harness.deps, {
        threadId: thread.id,
        scope: threadScope(),
        sequence: 2,
        type: "client/thread/start",
        data: {
          direction: "outbound",
          requestId: encodeClientTurnRequestIdNumber({ value: 2 }),
          input: textInput("Repair the original legacy thread task"),
          execution: THREAD_START_EXECUTION,
          initiator: "user",
          senderThreadId: null,
          request: { method: "thread/start", params: {} },
          source: "spawn",
        },
      });
      expect((await request()).status).toBe(200);
      expect(JSON.stringify(openRouter.requests)).toContain(
        "original legacy thread task",
      );
      expect(JSON.stringify(openRouter.requests)).not.toContain(
        "Inherited source task",
      );
    });
  });

  it("synchronizes generated titles with a ready provider session", async () => {
    mockThreadMetadata({ title: "Provider title" });
    await withTestHarness(async (harness) => {
      const { thread, request } = seedTitleTask(harness);
      const { host } = seedHostSession(harness.deps);
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: thread.projectId,
        path: "/tmp/title-generation-workspace",
      });
      updateThread(harness.db, harness.hub, thread.id, {
        environmentId: environment.id,
      });
      expect((await request()).status).toBe(200);
      const command = await waitForQueuedCommand(
        harness,
        (entry) => entry.command.type === "thread.rename",
      );
      expect(command.command).toMatchObject({
        type: "thread.rename",
        threadId: thread.id,
        title: "Provider title",
      });
    });
  });

  it("preserves an existing title when input is missing or too short", async () => {
    await withTestHarness(async (harness) => {
      const { thread, appendInput, request } = seedTitleTask(harness, "");
      expect((await request()).status).toBe(422);
      appendInput("Fix it", true);
      expect((await request()).status).toBe(422);
      expect(getThread(harness.db, thread.id)?.title).toBe("Original title");
      expect(openRouter.complete).not.toHaveBeenCalled();
    });
  });

  it("reports missing input when only the lifecycle start marker remains", async () => {
    await withTestHarness(async (harness) => {
      const { thread, request } = seedTitleTask(harness, "");
      appendClientTurnEvent(harness.deps, {
        threadId: thread.id,
        environmentId: null,
        type: "client/thread/start",
        initiator: "user",
        requestMethod: "thread/start",
        source: "spawn",
      });
      expect((await request()).status).toBe(422);
      expect(getThread(harness.db, thread.id)?.title).toBe("Original title");
      expect(openRouter.complete).not.toHaveBeenCalled();
    });
  });

  it("preserves the old title after inference failure and releases the request guard", async () => {
    openRouter.complete.mockRejectedValue(new Error("Inference unavailable"));
    await withTestHarness(async (harness) => {
      const { thread, request } = seedTitleTask(harness);
      expect((await request()).status).toBe(503);
      expect(getThread(harness.db, thread.id)?.title).toBe("Original title");
      mockThreadMetadata({ title: "Recovered title" });
      expect((await request()).status).toBe(200);
    });
  });

  it("rejects duplicate requests and preserves a manual rename during inference", async () => {
    const resolveMetadata = pendingThreadMetadata();
    await withTestHarness(async (harness) => {
      const { thread, request } = seedTitleTask(harness);
      const response = request();
      await vi.waitFor(() =>
        expect(openRouter.complete).toHaveBeenCalledOnce(),
      );
      expect((await request()).status).toBe(409);
      const rename = await harness.app.request(`/api/v1/threads/${thread.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Manual title" }),
      });
      expect(rename.status).toBe(200);
      resolveMetadata({ title: "Generated title" });
      expect((await response).status).toBe(409);
      expect(getThread(harness.db, thread.id)?.title).toBe("Manual title");
    });
  });

  it("does not apply a title after the thread is deleted", async () => {
    const resolveMetadata = pendingThreadMetadata();
    await withTestHarness(async (harness) => {
      const { thread, request } = seedTitleTask(harness);
      const response = request();
      await vi.waitFor(() =>
        expect(openRouter.complete).toHaveBeenCalledOnce(),
      );
      markThreadDeleted(harness.db, harness.hub, { threadId: thread.id });
      resolveMetadata({ title: "Generated title" });
      expect((await response).status).toBe(404);
      expect(getThread(harness.db, thread.id)?.title).toBe("Original title");
    });
  });

  it("returns an identical generated title without writing the thread", async () => {
    mockThreadMetadata({ title: "Original title" });
    await withTestHarness(async (harness) => {
      const { thread, request } = seedTitleTask(harness);
      const before = getThread(harness.db, thread.id);
      expect((await request()).status).toBe(200);
      expect(getThread(harness.db, thread.id)).toEqual(before);
    });
  });
});
