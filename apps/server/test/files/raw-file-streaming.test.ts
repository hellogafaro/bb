import { Buffer } from "node:buffer";
import { setTimeout as delay } from "node:timers/promises";
import {
  HOST_READ_FILE_RANGE_MAX_BYTES,
  type HostDaemonOnlineRpcResultByType,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  attachmentContentDisposition,
  createDaemonFileRangeStream,
  createStreamedDaemonFileResponse,
  parseByteRangeHeader,
  resolveByteRange,
  type RawFileRequest,
} from "../../src/services/hosts/daemon-file-response.js";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

type RangeResult = HostDaemonOnlineRpcResultByType["host.read_file_range"];

const MODIFIED_AT_MS = Date.UTC(2026, 8, 1, 12, 0, 0);

function patternBytes(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) {
    bytes[index] = (index * 31 + 7) % 251;
  }
  return bytes;
}

function readRangeFrom(bytes: Buffer, calls: [number, number][] = []) {
  return async (offset: number, length: number): Promise<RangeResult> => {
    calls.push([offset, length]);
    return {
      path: "/files/movie.mp4",
      mimeType: "video/mp4",
      sizeBytes: bytes.byteLength,
      modifiedAtMs: MODIFIED_AT_MS,
      offset,
      content: bytes.subarray(offset, offset + length).toString("base64"),
    };
  };
}

function rawRequest(overrides: Partial<RawFileRequest> = {}): RawFileRequest {
  return {
    download: false,
    ifNoneMatch: undefined,
    ifRange: undefined,
    range: undefined,
    ...overrides,
  };
}

function metadataFor(bytes: Buffer) {
  return {
    mimeType: "video/mp4",
    modifiedAtMs: MODIFIED_AT_MS,
    sizeBytes: bytes.byteLength,
  };
}

describe("attachmentContentDisposition", () => {
  it("quotes plain names and percent-encodes spaces", () => {
    expect(attachmentContentDisposition("docs/final report.pdf")).toBe(
      `attachment; filename="final report.pdf"; filename*=UTF-8''final%20report.pdf`,
    );
  });

  it("replaces quotes, backslashes, percent signs, and semicolons in the ASCII fallback", () => {
    expect(attachmentContentDisposition('a"b;c%d.txt')).toBe(
      `attachment; filename="a_b_c_d.txt"; filename*=UTF-8''a%22b%3Bc%25d.txt`,
    );
    expect(attachmentContentDisposition("it's (1)*.txt")).toBe(
      `attachment; filename="it's (1)*.txt"; filename*=UTF-8''it%27s%20%281%29%2A.txt`,
    );
  });

  it("keeps unicode in filename* and transliterates the fallback", () => {
    expect(attachmentContentDisposition("résumé 日本.pdf")).toBe(
      `attachment; filename="resume __.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%E6%97%A5%E6%9C%AC.pdf`,
    );
  });

  it("uses only the base name so traversal segments never reach the header", () => {
    expect(attachmentContentDisposition("../../etc/passwd")).toBe(
      `attachment; filename="passwd"; filename*=UTF-8''passwd`,
    );
    expect(attachmentContentDisposition("C:\\Users\\me\\notes.txt")).toBe(
      `attachment; filename="notes.txt"; filename*=UTF-8''notes.txt`,
    );
    expect(attachmentContentDisposition("a\r\nb.txt")).toBe(
      `attachment; filename="ab.txt"; filename*=UTF-8''ab.txt`,
    );
    for (const name of ["..", "/", "dir/..", ""]) {
      expect(attachmentContentDisposition(name)).toBe(
        `attachment; filename="download"; filename*=UTF-8''download`,
      );
    }
  });
});

describe("parseByteRangeHeader and resolveByteRange", () => {
  it("parses bounded, open-ended, and suffix ranges", () => {
    expect(parseByteRangeHeader("bytes=0-99")).toEqual({
      kind: "from",
      start: 0,
      end: 99,
    });
    expect(parseByteRangeHeader("bytes=100-")).toEqual({
      kind: "from",
      start: 100,
      end: undefined,
    });
    expect(parseByteRangeHeader("bytes=-500")).toEqual({
      kind: "suffix",
      length: 500,
    });
  });

  it("ignores absent, malformed, reversed, non-byte, and multi-range headers", () => {
    for (const header of [
      undefined,
      "",
      "bytes=",
      "bytes=-",
      "bytes=abc",
      "bytes=5-2",
      "items=0-1",
      "bytes=0-1,5-6",
      "bytes=99999999999999999999-",
    ]) {
      expect(parseByteRangeHeader(header)).toBeNull();
    }
  });

  it("clamps satisfiable ranges to the file size", () => {
    expect(resolveByteRange({ kind: "from", start: 0, end: 99 }, 1000)).toEqual(
      { start: 0, end: 99 },
    );
    expect(
      resolveByteRange({ kind: "from", start: 900, end: 5000 }, 1000),
    ).toEqual({ start: 900, end: 999 });
    expect(
      resolveByteRange({ kind: "from", start: 999, end: undefined }, 1000),
    ).toEqual({ start: 999, end: 999 });
    expect(resolveByteRange({ kind: "suffix", length: 500 }, 1000)).toEqual({
      start: 500,
      end: 999,
    });
    expect(resolveByteRange({ kind: "suffix", length: 5000 }, 1000)).toEqual({
      start: 0,
      end: 999,
    });
  });

  it("reports unsatisfiable ranges", () => {
    expect(
      resolveByteRange({ kind: "from", start: 1000, end: undefined }, 1000),
    ).toBeNull();
    expect(resolveByteRange({ kind: "suffix", length: 0 }, 1000)).toBeNull();
    expect(
      resolveByteRange({ kind: "from", start: 0, end: undefined }, 0),
    ).toBeNull();
    expect(resolveByteRange({ kind: "suffix", length: 1 }, 0)).toBeNull();
  });
});

describe("createStreamedDaemonFileResponse", () => {
  const bytes = patternBytes(4096);

  it("answers a single range with 206 and Content-Range", async () => {
    const response = createStreamedDaemonFileResponse(
      readRangeFrom(bytes),
      metadataFor(bytes),
      {
        fileName: "movie.mp4",
        headers: { "x-content-type-options": "nosniff" },
        request: rawRequest({ range: "bytes=1000-1999" }),
        revalidate: true,
      },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1000-1999/4096");
    expect(response.headers.get("content-length")).toBe("1000");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-cache, no-transform",
    );
    expect(response.headers.get("last-modified")).toBe(
      new Date(MODIFIED_AT_MS).toUTCString(),
    );
    expect(response.headers.has("content-disposition")).toBe(false);
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      bytes.subarray(1000, 2000),
    );
  });

  it("answers a suffix range", async () => {
    const response = createStreamedDaemonFileResponse(
      readRangeFrom(bytes),
      metadataFor(bytes),
      {
        fileName: "movie.mp4",
        request: rawRequest({ range: "bytes=-96" }),
        revalidate: true,
      },
    );
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 4000-4095/4096");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      bytes.subarray(4000),
    );
  });

  it("answers an unsatisfiable range with 416 and the full size", async () => {
    const calls: [number, number][] = [];
    const response = createStreamedDaemonFileResponse(
      readRangeFrom(bytes, calls),
      metadataFor(bytes),
      {
        fileName: "movie.mp4",
        request: rawRequest({ range: "bytes=4096-" }),
        revalidate: true,
      },
    );
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe("bytes */4096");
    expect(response.headers.get("content-length")).toBe("0");
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(calls).toEqual([]);
  });

  it("serves the whole file with 200 for multi-range requests", async () => {
    const response = createStreamedDaemonFileResponse(
      readRangeFrom(bytes),
      metadataFor(bytes),
      {
        fileName: "movie.mp4",
        request: rawRequest({ range: "bytes=0-1,10-20" }),
        revalidate: true,
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.has("content-range")).toBe(false);
    expect(response.headers.get("content-length")).toBe("4096");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("ignores Range when If-Range does not match the current file", async () => {
    const stale = createStreamedDaemonFileResponse(
      readRangeFrom(bytes),
      metadataFor(bytes),
      {
        fileName: "movie.mp4",
        request: rawRequest({
          range: "bytes=0-9",
          ifRange: new Date(MODIFIED_AT_MS - 60_000).toUTCString(),
        }),
        revalidate: true,
      },
    );
    expect(stale.status).toBe(200);
    expect(stale.headers.get("content-length")).toBe("4096");

    const entityTag = createStreamedDaemonFileResponse(
      readRangeFrom(bytes),
      metadataFor(bytes),
      {
        fileName: "movie.mp4",
        request: rawRequest({ range: "bytes=0-9", ifRange: '"abc"' }),
        revalidate: true,
      },
    );
    expect(entityTag.status).toBe(200);

    const current = createStreamedDaemonFileResponse(
      readRangeFrom(bytes),
      metadataFor(bytes),
      {
        fileName: "movie.mp4",
        request: rawRequest({
          range: "bytes=0-9",
          ifRange: new Date(MODIFIED_AT_MS).toUTCString(),
        }),
        revalidate: true,
      },
    );
    expect(current.status).toBe(206);
  });

  it("adds an attachment disposition for downloads and skips the inline size check", async () => {
    const response = createStreamedDaemonFileResponse(
      readRangeFrom(bytes),
      metadataFor(bytes),
      {
        assertInlineSize: () => {
          throw new Error("inline size check must not run for downloads");
        },
        fileName: "clips/movie night.mp4",
        headers: { "cache-control": "no-store" },
        request: rawRequest({ download: true }),
        revalidate: false,
      },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="movie night.mp4"; filename*=UTF-8''movie%20night.mp4`,
    );
    expect(response.headers.get("cache-control")).toBe(
      "no-store, no-transform",
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it("serves an empty file with 200 and no daemon reads", async () => {
    const empty = Buffer.alloc(0);
    const calls: [number, number][] = [];
    const response = createStreamedDaemonFileResponse(
      readRangeFrom(empty, calls),
      metadataFor(empty),
      { fileName: "empty.bin", request: rawRequest(), revalidate: true },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe("0");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("createDaemonFileRangeStream", () => {
  it("pulls sequential bounded chunks in order", async () => {
    const size = HOST_READ_FILE_RANGE_MAX_BYTES * 2 + 1234;
    const bytes = patternBytes(size);
    const calls: [number, number][] = [];
    const stream = createDaemonFileRangeStream(
      readRangeFrom(bytes, calls),
      metadataFor(bytes),
      { start: 10, end: size - 1 },
    );
    const received = Buffer.from(await new Response(stream).arrayBuffer());

    expect(received.equals(bytes.subarray(10))).toBe(true);
    expect(calls).toEqual([
      [10, HOST_READ_FILE_RANGE_MAX_BYTES],
      [10 + HOST_READ_FILE_RANGE_MAX_BYTES, HOST_READ_FILE_RANGE_MAX_BYTES],
      [10 + HOST_READ_FILE_RANGE_MAX_BYTES * 2, 1224],
    ]);
  });

  it("reads ahead at most one chunk beyond what the consumer took", async () => {
    const size = HOST_READ_FILE_RANGE_MAX_BYTES * 5;
    const bytes = patternBytes(size);
    const calls: [number, number][] = [];
    const reader = createDaemonFileRangeStream(
      readRangeFrom(bytes, calls),
      metadataFor(bytes),
      { start: 0, end: size - 1 },
    ).getReader();

    await delay(20);
    expect(calls).toHaveLength(1);
    await reader.read();
    await delay(20);
    expect(calls).toHaveLength(2);
    await reader.read();
    await reader.read();
    await delay(20);
    expect(calls).toHaveLength(4);
    await reader.cancel();
  });

  it("fails the stream when the file changes between chunks", async () => {
    const size = HOST_READ_FILE_RANGE_MAX_BYTES + 10;
    const bytes = patternBytes(size);
    const base = readRangeFrom(bytes);
    let reads = 0;
    const stream = createDaemonFileRangeStream(
      async (offset, length) => {
        const result = await base(offset, length);
        reads += 1;
        return reads === 1
          ? result
          : { ...result, modifiedAtMs: MODIFIED_AT_MS + 1 };
      },
      metadataFor(bytes),
      { start: 0, end: size - 1 },
    );
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow(
      "File changed while streaming",
    );
  });

  it("fails the stream when the file is truncated mid-read", async () => {
    const bytes = patternBytes(100);
    const stream = createDaemonFileRangeStream(
      async (offset) => ({
        path: "/files/movie.mp4",
        sizeBytes: 100,
        modifiedAtMs: MODIFIED_AT_MS,
        offset,
        content: bytes.subarray(offset, 50).toString("base64"),
      }),
      metadataFor(bytes),
      { start: 0, end: 99 },
    );
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow(
      "File changed while streaming",
    );
  });
});

describe("raw file routes", () => {
  const FILE_BYTES = patternBytes(HOST_READ_FILE_RANGE_MAX_BYTES + 1_500_000);

  async function withRawFileHost(
    run: (args: {
      request: (url: string, init?: RequestInit) => Promise<Response>;
      commandTypes: () => string[];
      threadId: string;
      projectId: string;
      hostId: string;
    }) => Promise<void>,
    readFile: "too_large" | "unexpected" = "unexpected",
  ): Promise<void> {
    await withTestHarness(async (harness) => {
      const { host, session, project, thread } = seedThreadFixture(harness, {
        environment: { path: "/tmp/raw-file-worktree" },
      });
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          const command = request.command;
          if (command.type === "host.read_file" && readFile === "too_large") {
            return {
              ok: false,
              errorCode: "file_too_large",
              errorMessage: "File size exceeds the 25 MB limit",
            };
          }
          if (command.type !== "host.read_file_range") {
            throw new Error(`Unexpected RPC ${command.type}`);
          }
          return {
            ok: true,
            result: {
              path: command.path,
              mimeType: "video/mp4",
              sizeBytes: FILE_BYTES.byteLength,
              modifiedAtMs: MODIFIED_AT_MS,
              offset: command.offset,
              content: FILE_BYTES.subarray(
                command.offset,
                command.offset + command.length,
              ).toString("base64"),
            },
          };
        },
      });
      await run({
        request: async (url, init) => harness.app.request(url, init),
        commandTypes: () => responder.requests.map((r) => r.command.type),
        threadId: thread.id,
        projectId: project.id,
        hostId: host.id,
      });
    });
  }

  function routeUrls(args: {
    threadId: string;
    projectId: string;
    hostId: string;
  }): string[] {
    return [
      `/api/v1/threads/${args.threadId}/worktree/files/clips/movie%20night.mp4?download=1`,
      `/api/v1/threads/${args.threadId}/thread-storage/files/clips/movie%20night.mp4?download=1`,
      `/api/v1/threads/${args.threadId}/host-files/content?path=${encodeURIComponent("/tmp/raw-file-worktree/clips/movie night.mp4")}&download=1`,
      `/api/v1/projects/${args.projectId}/files/content?hostId=${args.hostId}&path=${encodeURIComponent("clips/movie night.mp4")}&download=1`,
    ];
  }

  it("streams download=1 as an attachment on all four routes", async () => {
    await withRawFileHost(async (context) => {
      for (const url of routeUrls(context)) {
        const response = await context.request(url);
        expect(response.status, url).toBe(200);
        expect(response.headers.get("content-disposition"), url).toBe(
          `attachment; filename="movie night.mp4"; filename*=UTF-8''movie%20night.mp4`,
        );
        expect(response.headers.get("accept-ranges"), url).toBe("bytes");
        expect(response.headers.get("content-type"), url).toBe("video/mp4");
        expect(response.headers.get("x-content-type-options"), url).toBe(
          "nosniff",
        );
        expect(response.headers.get("content-length"), url).toBe(
          String(FILE_BYTES.byteLength),
        );
        const body = Buffer.from(await response.arrayBuffer());
        expect(body.equals(FILE_BYTES), url).toBe(true);
      }
      expect(context.commandTypes()).not.toContain("host.read_file");
    });
  });

  it("answers Range requests with 206 on all four routes", async () => {
    await withRawFileHost(async (context) => {
      for (const url of routeUrls(context)) {
        const inlineUrl = url.replace(/[?&]download=1$/u, "");
        const response = await context.request(inlineUrl, {
          headers: { range: "bytes=1000-1999" },
        });
        expect(response.status, inlineUrl).toBe(206);
        expect(response.headers.get("content-range"), inlineUrl).toBe(
          `bytes 1000-1999/${FILE_BYTES.byteLength}`,
        );
        expect(response.headers.get("content-length"), inlineUrl).toBe("1000");
        expect(response.headers.has("content-disposition"), inlineUrl).toBe(
          false,
        );
        const body = Buffer.from(await response.arrayBuffer());
        expect(body.equals(FILE_BYTES.subarray(1000, 2000)), inlineUrl).toBe(
          true,
        );
      }
    });
  });

  it("falls back to streaming inline reads the whole-file RPC refuses", async () => {
    await withRawFileHost(async (context) => {
      const response = await context.request(
        `/api/v1/threads/${context.threadId}/worktree/files/movie.mp4`,
      );
      expect(response.status).toBe(200);
      expect(response.headers.has("content-disposition")).toBe(false);
      expect(response.headers.get("content-length")).toBe(
        String(FILE_BYTES.byteLength),
      );
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.equals(FILE_BYTES)).toBe(true);
      expect(context.commandTypes()[0]).toBe("host.read_file");
    }, "too_large");
  });

  it("keeps the HTML inline limit but lets large HTML download", async () => {
    await withRawFileHost(async (context) => {
      const inline = await context.request(
        `/api/v1/threads/${context.threadId}/worktree/files/report.html`,
        { headers: { range: "bytes=0-9" } },
      );
      expect(inline.status).toBe(413);

      const download = await context.request(
        `/api/v1/threads/${context.threadId}/worktree/files/report.html?download=1`,
      );
      expect(download.status).toBe(200);
      expect(download.headers.get("content-security-policy")).toBe(
        "sandbox allow-scripts",
      );
      expect(download.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      expect(download.headers.get("cache-control")).toBe(
        "no-store, no-transform",
      );
      await download.arrayBuffer();
    });
  });

  it("rejects unknown download values", async () => {
    await withRawFileHost(async (context) => {
      const response = await context.request(
        `/api/v1/threads/${context.threadId}/worktree/files/movie.mp4?download=yes`,
      );
      expect(response.status).toBe(400);
    });
  });
});
