import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { makeThread } from "../helpers/command-output-fixtures.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

describe("bb thread generate-title", () => {
  setupCommandOutputTestEnvironment();
  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("generates a title for an explicit thread and prints the result", async () => {
    const thread = makeThread({
      id: "thread-title",
      title: "Generated title",
      projectId: "project",
      providerId: "codex",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.:id.generate-title.$post": post });

    await runCommand(["thread", "generate-title", "thread-title"], register);

    expect(post).toHaveBeenCalledWith({ param: { id: "thread-title" } });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread thread-title title generated",
      "Title: Generated title",
    ]);
  });

  it("resolves --self and prints only the updated thread as JSON", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-self");
    const thread = makeThread({
      id: "thread-self",
      title: "Generated title",
      projectId: "project",
      providerId: "codex",
    });
    const post = vi.fn(async () => thread);
    stubServerApi({ "v1.threads.:id.generate-title.$post": post });

    await runCommand(
      ["thread", "generate-title", "--self", "--json"],
      register,
    );

    expect(post).toHaveBeenCalledWith({ param: { id: "thread-self" } });
    expect(
      JSON.parse(collectLogLines(vi.mocked(console.log)).join("\n")),
    ).toEqual(thread);
  });

  it("rejects an invalid thread identifier before generating", async () => {
    const post = vi.fn();
    stubServerApi({ "v1.threads.:id.generate-title.$post": post });

    await expect(
      runCommand(["thread", "generate-title", "invalid/id"], register),
    ).rejects.toThrow("process.exit:1");

    expect(post).not.toHaveBeenCalled();
  });
});
