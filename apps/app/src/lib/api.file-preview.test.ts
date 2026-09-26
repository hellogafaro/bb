import { afterEach, describe, expect, it, vi } from "vitest";
import { TEXT_FILE_PREVIEW_MAX_BYTES } from "@bb/client-core";
import { loadFilePreview } from "./api";

function streamedResponse(
  prefix: Uint8Array<ArrayBuffer>,
  total: number,
  type: string,
) {
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls > 1) {
        throw new Error("read past the first chunk");
      }
      controller.enqueue(prefix);
    },
  });
  return new Response(body, {
    headers: { "content-length": String(total), "content-type": type },
  });
}

describe("loadFilePreview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies streamed media by extension without fetching", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const preview = await loadFilePreview({
      path: "docs/Q3 report.pdf",
      url: "/raw/docs/Q3%20report.pdf",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(preview).toEqual({
      kind: "pdf",
      mimeType: "application/pdf",
      path: "docs/Q3 report.pdf",
      url: "/raw/docs/Q3%20report.pdf",
    });
  });

  it("fills the pptx card with type and size from a one-byte range probe", async () => {
    const pptxMimeType =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from([0x50]), {
        status: 206,
        headers: {
          "content-range": "bytes 0-0/2400000",
          "content-type": pptxMimeType,
        },
      }),
    );

    const preview = await loadFilePreview({
      path: "decks/roadmap.pptx",
      url: "/raw/decks/roadmap.pptx",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("range")).toBe("bytes=0-0");
    expect(preview).toEqual({
      kind: "unsupported",
      mimeType: pptxMimeType,
      path: "decks/roadmap.pptx",
      reason: "type",
      sizeBytes: 2_400_000,
      url: "/raw/decks/roadmap.pptx",
    });
  });

  it("reports a large unknown binary with its type and size from the first chunk", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        streamedResponse(
          Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]),
          2_000_000_000,
          "application/zip",
        ),
      );

    const preview = await loadFilePreview({
      path: "dist/bundle.zip",
      url: "/raw/dist/bundle.zip",
    });

    const init = fetchSpy.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has("range")).toBe(false);
    expect(preview).toMatchObject({
      kind: "unsupported",
      mimeType: "application/zip",
      reason: "type",
      sizeBytes: 2_000_000_000,
    });
  });

  it("marks oversized text as too large instead of unsupported", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      streamedResponse(
        new TextEncoder().encode("2026-09-26 INFO boot\n"),
        TEXT_FILE_PREVIEW_MAX_BYTES + 1,
        "application/octet-stream",
      ),
    );

    const preview = await loadFilePreview({
      path: "logs/server.out",
      url: "/raw/logs/server.out",
    });

    expect(preview).toMatchObject({
      kind: "unsupported",
      reason: "too-large",
      sizeBytes: TEXT_FILE_PREVIEW_MAX_BYTES + 1,
    });
  });

  it("builds text previews from a small complete body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("hello", {
        headers: {
          "content-length": "5",
          "content-type": "text/plain; charset=utf-8",
        },
      }),
    );

    const preview = await loadFilePreview({
      path: "notes/README",
      url: "/raw/notes/README",
    });

    expect(preview).toMatchObject({ kind: "text", content: "hello" });
  });

  it("falls back to the declared mime type for extensionless binaries", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]), {
        status: 200,
        headers: { "content-type": "application/pdf" },
      }),
    );

    const preview = await loadFilePreview({
      path: "exports/scan",
      url: "/raw/exports/scan",
    });

    expect(preview.kind).toBe("pdf");
  });
});
