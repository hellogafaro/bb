import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { registerFileCommands } from "../../commands/file.js";

describe("bb file download", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerFileCommands(program, () => "http://server");
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bb-file-download-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function stubDownload(body: string, init: ResponseInit = {}) {
    return vi
      .mocked(globalThis.fetch)
      .mockImplementation(async () => new Response(body, init));
  }

  it("streams a thread worktree file to --out and prints JSON", async () => {
    const fetchMock = stubDownload("video bytes", {
      headers: { "content-length": "11" },
    });
    const out = join(dir, "movie.mp4");

    await runCommand(
      [
        "file",
        "download",
        "clips/movie night.mp4",
        "--thread",
        "thr_1",
        "--out",
        out,
        "--json",
      ],
      register,
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://server/api/v1/threads/thr_1/worktree/files/clips/movie%20night.mp4?download=1",
    ]);
    await expect(readFile(out, "utf8")).resolves.toBe("video bytes");
    expect(
      JSON.parse(collectLogPayloads(vi.mocked(console.log))[0] ?? ""),
    ).toEqual({ path: out, sizeBytes: 11 });
    expect(await readdir(dir)).toEqual(["movie.mp4"]);
  });

  it("routes storage, host, and project sources", async () => {
    const fetchMock = stubDownload("x");

    await runCommand(
      [
        "file",
        "download",
        "a.txt",
        "--thread",
        "thr_1",
        "--source",
        "storage",
      ].concat(["--out", join(dir, "storage.txt")]),
      register,
    );
    await runCommand(
      [
        "file",
        "download",
        "/tmp/a.txt",
        "--thread",
        "thr_1",
        "--source",
        "host",
      ].concat(["--out", join(dir, "host.txt")]),
      register,
    );
    await runCommand(
      [
        "file",
        "download",
        "docs/a.txt",
        "--project",
        "proj_1",
        "--host",
        "h1",
      ].concat(["--out", join(dir, "project.txt")]),
      register,
    );

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://server/api/v1/threads/thr_1/thread-storage/files/a.txt?download=1",
      "http://server/api/v1/threads/thr_1/host-files/content?path=%2Ftmp%2Fa.txt&download=1",
      "http://server/api/v1/projects/proj_1/files/content?path=docs%2Fa.txt&hostId=h1&download=1",
    ]);
  });

  it("refuses to replace an existing file unless --force is set", async () => {
    stubDownload("new");
    const out = join(dir, "report.pdf");
    await writeFile(out, "old");

    await expect(
      runCommand(
        ["file", "download", "report.pdf", "--thread", "thr_1", "--out", out],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    await expect(readFile(out, "utf8")).resolves.toBe("old");

    await runCommand(
      [
        "file",
        "download",
        "report.pdf",
        "--thread",
        "thr_1",
        "--out",
        out,
        "--force",
      ],
      register,
    );
    await expect(readFile(out, "utf8")).resolves.toBe("new");
  });

  it("removes the partial file when the transfer is short", async () => {
    stubDownload("half", { headers: { "content-length": "8" } });
    const out = join(dir, "big.bin");

    await expect(
      runCommand(
        ["file", "download", "big.bin", "--thread", "thr_1", "--out", out],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(await readdir(dir)).toEqual([]);
  });

  it("reports server errors without creating a file", async () => {
    stubDownload(JSON.stringify({ code: "ENOENT", message: "Missing file" }), {
      status: 404,
    });
    const out = join(dir, "missing.txt");

    await expect(
      runCommand(
        ["file", "download", "missing.txt", "--thread", "thr_1", "--out", out],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(
      String(vi.mocked(console.error).mock.calls.flat().join(" ")),
    ).toContain("Download failed (HTTP 404): Missing file");
    expect(await readdir(dir)).toEqual([]);
  });

  it("requires exactly one of --thread or --project", async () => {
    await expect(
      runCommand(["file", "download", "a.txt"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(
        ["file", "download", "a.txt", "--thread", "t", "--project", "p"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
