import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCommitMessage } from "../../src/services/ai/commit-message.js";
import { OpenRouterRequestError } from "../../src/services/ai/openrouter.js";
import { InferenceTimeoutError } from "../../src/services/ai/inference.js";
import type { AppDeps, LoggedWorkSessionDeps } from "../../src/types.js";
import {
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { installOpenRouterChatCompat } from "../helpers/openrouter.js";
import { createTestAppHarness, withTestHarness } from "../helpers/test-app.js";

const openRouter = installOpenRouterChatCompat();

interface TestCommitMessageDeps {
  cleanup: () => Promise<void>;
  deps: LoggedWorkSessionDeps;
  logger: AppDeps["logger"];
}

interface MockCommitMessage {
  message: string;
}

const commitMessageArgs = {
  diffDescription: "uncommitted changes",
  files: "M\tfile.ts\n",
  patch:
    "diff --git a/file.ts b/file.ts\n@@ -1 +1,2 @@\n export {}\n+export const changed = true;\n",
  shortstat: "1 file changed, 1 insertion(+)\n",
};

async function createCommitMessageDeps(): Promise<TestCommitMessageDeps> {
  const harness = await createTestAppHarness({
    inferenceModel: "test/mock-model",
  });
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  return {
    deps: {
      ...harness.deps,
      logger,
    },
    cleanup: harness.cleanup,
    logger,
  };
}

function mockCommitMessageCompletion(commitMessage: MockCommitMessage) {
  return {
    content: [
      {
        arguments: commitMessage,
        id: "tool_result",
        name: "result",
        type: "toolCall",
      },
    ],
  };
}

function mockInvalidCommitMessageCompletion() {
  return {
    content: [
      {
        arguments: {},
        id: "tool_result",
        name: "result",
        type: "toolCall",
      },
    ],
  };
}

function mockNoResultCompletion() {
  return {
    content: [],
  };
}

describe("commit message generation", () => {
  beforeEach(() => {
    openRouter.complete.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries once when commit message inference times out", async () => {
    openRouter.complete
      .mockRejectedValueOnce(new InferenceTimeoutError({ timeoutMs: 5_000 }))
      .mockResolvedValueOnce(
        mockCommitMessageCompletion({
          message: "fix: recover commit message",
        }),
      );
    const { cleanup, deps, logger } = await createCommitMessageDeps();
    vi.useFakeTimers();
    try {
      const pending = generateCommitMessage(deps, commitMessageArgs);
      await vi.advanceTimersByTimeAsync(5_000);
      const message = await pending;

      expect(message).toBe("fix: recover commit message");
      expect(openRouter.complete).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          attempt: 1,
          maxAttempts: 2,
          reason: "transient-failure",
          timeoutMs: 5_000,
        }),
        "Commit message inference failed transiently; retrying",
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 2,
          model: "test/mock-model",
          reason: "transient-failure",
        }),
        "Commit message inference completed after retry",
      );
    } finally {
      await cleanup();
    }
  });

  it("retries after transient service unavailability", async () => {
    openRouter.complete
      .mockRejectedValueOnce(
        new OpenRouterRequestError(
          "service_unavailable",
          "Our servers are currently overloaded. Please try again later.",
        ),
      )
      .mockResolvedValueOnce(
        mockCommitMessageCompletion({
          message: "fix: recover with fallback model",
        }),
      );
    const { cleanup, deps, logger } = await createCommitMessageDeps();
    try {
      await expect(
        generateCommitMessage(deps, commitMessageArgs),
      ).resolves.toBe("fix: recover with fallback model");
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCode: "openrouter_unavailable",
        }),
        "Commit message inference failed transiently; retrying",
      );
    } finally {
      await cleanup();
    }
  });

  it("returns a timeout outcome after exhausting commit message retries", async () => {
    openRouter.complete.mockRejectedValue(
      new InferenceTimeoutError({ timeoutMs: 5_000 }),
    );
    const { cleanup, deps, logger } = await createCommitMessageDeps();
    vi.useFakeTimers();
    try {
      const pending = generateCommitMessage(deps, commitMessageArgs);
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.advanceTimersByTimeAsync(5_000);
      const message = await pending;

      expect(message).toBeNull();
      expect(openRouter.complete).toHaveBeenCalledTimes(2);
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 2,
          reason: "timeout",
          timeoutMs: 5_000,
        }),
        "Commit message inference timed out",
      );
    } finally {
      await cleanup();
    }
  });

  it("returns no-result without retrying when inference completes without a result tool call", async () => {
    openRouter.complete.mockResolvedValue(mockNoResultCompletion());
    const { cleanup, deps, logger } = await createCommitMessageDeps();
    try {
      const message = await generateCommitMessage(deps, commitMessageArgs);

      expect(message).toBeNull();
      expect(openRouter.complete).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 1,
          reason: "no-result",
        }),
        "Commit message inference returned no result",
      );
    } finally {
      await cleanup();
    }
  });

  it("does not retry non-timeout failures", async () => {
    openRouter.complete.mockResolvedValue(mockInvalidCommitMessageCompletion());
    const { cleanup, deps, logger } = await createCommitMessageDeps();
    try {
      const message = await generateCommitMessage(deps, commitMessageArgs);

      expect(message).toBeNull();
      expect(openRouter.complete).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          attempts: 1,
          err: expect.any(Error),
          reason: "failed",
        }),
        "Commit message inference failed",
      );
    } finally {
      await cleanup();
    }
  });

  it("returns null when OpenRouter rejects the request", async () => {
    openRouter.complete.mockRejectedValue(
      new OpenRouterRequestError("request_failed", "Unsupported model"),
    );
    await withTestHarness(async (harness) => {
      await expect(
        generateCommitMessage(harness.deps, commitMessageArgs),
      ).resolves.toBeNull();
      expect(openRouter.complete).toHaveBeenCalledTimes(1);
    });
  });

  it("uses the route fallback message only after commit message retries are exhausted", async () => {
    openRouter.complete.mockRejectedValue(
      new OpenRouterRequestError("service_unavailable", "overloaded"),
    );
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });

      const responsePromise = harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "commit",
          }),
        },
      );

      const statusCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.status" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, statusCommand, {
        outcome: "available",
        workspaceStatus: {
          branch: {
            currentBranch: "feature",
            defaultBranch: "main",
          },
          checkout: {
            kind: "branch",
            branchName: "feature",
            headSha: null,
          },
          mergeBase: null,
          workingTree: {
            deletions: 0,
            files: [],
            hasUncommittedChanges: true,
            insertions: 1,
            lineStatsComplete: true,
            state: "dirty_uncommitted",
          },
        },
      });

      const diffCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.diff" &&
          command.environmentId === environment.id,
      );
      await reportQueuedCommandSuccess(harness, diffCommand, {
        outcome: "available",
        diff: {
          diff: commitMessageArgs.patch,
          files: commitMessageArgs.files,
          mergeBaseRef: null,
          shortstat: commitMessageArgs.shortstat,
          truncated: false,
        },
      });

      const commitCommand = await waitForQueuedCommand(
        harness,
        ({ command }) =>
          command.type === "workspace.commit" &&
          command.environmentId === environment.id,
      );
      expect(commitCommand.command).toMatchObject({
        message: "bb: automated commit",
      });
      expect(openRouter.complete).toHaveBeenCalledTimes(2);
      await reportQueuedCommandSuccess(harness, commitCommand, {
        commitSha: "abc123",
        commitSubject: "bb: automated commit",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toMatchObject({
        action: "commit",
        commitSubject: "bb: automated commit",
        ok: true,
      });
    });
  });

  it("uses the route fallback message when commit-message inference fails", async () => {
    openRouter.complete.mockRejectedValue(
      new OpenRouterRequestError("request_failed", "Unsupported model"),
    );
    await withTestHarness(
      {},
      async (harness) => {
        const { host } = seedHostSession(harness.deps);
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        const environment = seedEnvironment(harness.deps, {
          hostId: host.id,
          projectId: project.id,
        });

        const responsePromise = harness.app.request(
          `/api/v1/environments/${environment.id}/actions`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              action: "commit",
            }),
          },
        );

        const statusCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.status" &&
            command.environmentId === environment.id,
        );
        await reportQueuedCommandSuccess(harness, statusCommand, {
          outcome: "available",
          workspaceStatus: {
            branch: {
              currentBranch: "feature",
              defaultBranch: "main",
            },
            checkout: {
              kind: "branch",
              branchName: "feature",
              headSha: null,
            },
            mergeBase: null,
            workingTree: {
              deletions: 0,
              files: [],
              hasUncommittedChanges: true,
              insertions: 1,
              lineStatsComplete: true,
              state: "dirty_uncommitted",
            },
          },
        });

        const diffCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.diff" &&
            command.environmentId === environment.id,
        );
        await reportQueuedCommandSuccess(harness, diffCommand, {
          outcome: "available",
          diff: {
            diff: commitMessageArgs.patch,
            files: commitMessageArgs.files,
            mergeBaseRef: null,
            shortstat: commitMessageArgs.shortstat,
            truncated: false,
          },
        });

        const commitCommand = await waitForQueuedCommand(
          harness,
          ({ command }) =>
            command.type === "workspace.commit" &&
            command.environmentId === environment.id,
        );
        expect(commitCommand.command).toMatchObject({
          message: "bb: automated commit",
        });
        await reportQueuedCommandSuccess(harness, commitCommand, {
          commitSha: "abc123",
          commitSubject: "bb: automated commit",
        });

        const response = await responsePromise;
        expect(response.status).toBe(200);
        await expect(readJson(response)).resolves.toMatchObject({
          action: "commit",
          commitSubject: "bb: automated commit",
          ok: true,
        });
      },
    );
  });
});
