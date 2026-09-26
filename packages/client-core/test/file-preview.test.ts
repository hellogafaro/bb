import { describe, expect, it } from "vitest";
import {
  areEnvironmentFilePreviewSourcesEqual,
  buildFilePreview,
  getStreamedFilePreviewType,
  isCsvFilePreview,
  isMarkdownFilePreview,
  normalizeFilePreviewMimeType,
} from "../src/file-preview.js";

describe("file-preview", () => {
  it("builds text previews from declared text mime types or detected UTF-8 content", () => {
    const declaredTextPreview = buildFilePreview({
      contentBytes: new TextEncoder().encode("export const value = 1;\n"),
      mimeType: "text/plain",
      name: "notes.txt",
      path: "notes.txt",
      url: "/files/notes.txt",
    });
    const detectedUtf8Preview = buildFilePreview({
      contentBytes: new TextEncoder().encode('{"ok":true}\n'),
      mimeType: "application/octet-stream",
      path: "result.log",
      url: "/files/result.log",
    });

    expect(declaredTextPreview).toEqual({
      kind: "text",
      mimeType: "text/plain",
      name: "notes.txt",
      path: "notes.txt",
      url: "/files/notes.txt",
      content: "export const value = 1;\n",
    });
    expect(detectedUtf8Preview).toEqual({
      kind: "text",
      mimeType: "application/octet-stream",
      path: "result.log",
      url: "/files/result.log",
      content: '{"ok":true}\n',
    });
  });

  it("builds image previews for image mime types", () => {
    const preview = buildFilePreview({
      contentBytes: Uint8Array.from([137, 80, 78, 71]),
      mimeType: "image/png",
      name: "diagram.png",
      path: "diagram.png",
      url: "/files/diagram.png",
    });

    expect(preview).toEqual({
      kind: "image",
      mimeType: "image/png",
      name: "diagram.png",
      path: "diagram.png",
      url: "/files/diagram.png",
    });
  });

  it("builds video previews for video mime types", () => {
    const preview = buildFilePreview({
      contentBytes: Uint8Array.from([0, 0, 0, 24]),
      mimeType: "video/mp4",
      name: "demo.mp4",
      path: "demo.mp4",
      url: "/files/demo.mp4",
    });

    expect(preview).toEqual({
      kind: "video",
      mimeType: "video/mp4",
      name: "demo.mp4",
      path: "demo.mp4",
      url: "/files/demo.mp4",
    });
  });

  it("prefers UTF-8 text over ambiguous video mime types", () => {
    const preview = buildFilePreview({
      contentBytes: new TextEncoder().encode("export const value = 1;\n"),
      mimeType: "video/mp2t",
      name: "commands.ts",
      path: "apps/server/test/helpers/commands.ts",
      url: "/files/commands.ts",
    });

    expect(preview).toEqual({
      kind: "text",
      mimeType: "video/mp2t",
      name: "commands.ts",
      path: "apps/server/test/helpers/commands.ts",
      url: "/files/commands.ts",
      content: "export const value = 1;\n",
    });
  });

  it("marks null-byte text and non-text binary files as unsupported", () => {
    const textWithNullBytePreview = buildFilePreview({
      contentBytes: Uint8Array.from([97, 0, 98]),
      mimeType: "text/plain",
      path: "broken.txt",
      url: "/files/broken.txt",
    });
    const binaryPreview = buildFilePreview({
      contentBytes: Uint8Array.from([0, 1, 2, 3]),
      mimeType: "application/octet-stream",
      path: "archive.bin",
      url: "/files/archive.bin",
    });

    expect(textWithNullBytePreview).toEqual({
      kind: "unsupported",
      mimeType: "text/plain",
      path: "broken.txt",
      reason: "type",
      sizeBytes: 3,
      url: "/files/broken.txt",
    });
    expect(binaryPreview).toEqual({
      kind: "unsupported",
      mimeType: "application/octet-stream",
      path: "archive.bin",
      reason: "type",
      sizeBytes: 4,
      url: "/files/archive.bin",
    });
  });

  it("classifies streamed previews by extension before any fetch", () => {
    expect(getStreamedFilePreviewType("docs/Report Final.PDF")).toEqual({
      kind: "pdf",
      mimeType: "application/pdf",
    });
    expect(getStreamedFilePreviewType("media/intro.mp3")).toEqual({
      kind: "audio",
      mimeType: "audio/mpeg",
    });
    expect(getStreamedFilePreviewType("media/demo.webm")?.kind).toBe("video");
    expect(getStreamedFilePreviewType("img/logo.png")?.kind).toBe("image");
    expect(getStreamedFilePreviewType("q3/budget.xlsx")).toMatchObject({
      kind: "office",
      format: "xlsx",
    });
    expect(getStreamedFilePreviewType("notes.docx")).toMatchObject({
      kind: "office",
      format: "docx",
    });
    expect(getStreamedFilePreviewType("deck.pptx")).toMatchObject({
      kind: "office",
      format: "pptx",
    });
    expect(getStreamedFilePreviewType("src/index.ts")).toBeNull();
    expect(getStreamedFilePreviewType("archive.zip")).toBeNull();
    expect(getStreamedFilePreviewType(".pdf")).toBeNull();
  });

  it("falls back to the mime type when the extension is unknown", () => {
    expect(
      getStreamedFilePreviewType("download", "application/pdf; charset=binary"),
    ).toEqual({ kind: "pdf", mimeType: "application/pdf" });
    expect(getStreamedFilePreviewType("voice", "audio/ogg")?.kind).toBe(
      "audio",
    );
    expect(
      getStreamedFilePreviewType(
        "export",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toMatchObject({ kind: "office", format: "xlsx" });
    expect(
      getStreamedFilePreviewType("blob", "application/octet-stream"),
    ).toBeNull();
  });

  it("keeps fetched pptx bodies on the unsupported card with their size", () => {
    expect(
      buildFilePreview({
        contentBytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff]),
        mimeType:
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        path: "deck",
        url: "/files/deck",
      }),
    ).toMatchObject({ kind: "unsupported", reason: "type", sizeBytes: 6 });
  });

  it("classifies fetched binary bodies by their declared mime type", () => {
    expect(
      buildFilePreview({
        contentBytes: Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]),
        mimeType: "application/pdf",
        path: "scan",
        url: "/files/scan",
      }),
    ).toEqual({
      kind: "pdf",
      mimeType: "application/pdf",
      path: "scan",
      url: "/files/scan",
    });
  });

  it("normalizes file preview mime types", () => {
    expect(normalizeFilePreviewMimeType("text/plain; charset=utf-8")).toBe(
      "text/plain",
    );
    expect(normalizeFilePreviewMimeType(null)).toBe("application/octet-stream");
  });

  it("compares environment file preview sources structurally", () => {
    expect(
      areEnvironmentFilePreviewSourcesEqual(
        { kind: "working-tree" },
        { kind: "working-tree" },
      ),
    ).toBe(true);
    expect(
      areEnvironmentFilePreviewSourcesEqual({ kind: "head" }, { kind: "head" }),
    ).toBe(true);
    expect(
      areEnvironmentFilePreviewSourcesEqual(
        { kind: "merge-base", ref: "abc1234" },
        { kind: "merge-base", ref: "abc1234" },
      ),
    ).toBe(true);
    expect(
      areEnvironmentFilePreviewSourcesEqual(
        { kind: "merge-base", ref: "abc1234" },
        { kind: "merge-base", ref: "def5678" },
      ),
    ).toBe(false);
    expect(
      areEnvironmentFilePreviewSourcesEqual(
        { kind: "working-tree" },
        { kind: "head" },
      ),
    ).toBe(false);
  });

  it("detects Markdown text previews by extension and mime type", () => {
    const markdownByPath = buildFilePreview({
      contentBytes: new TextEncoder().encode("# Notes\n"),
      mimeType: "text/plain",
      path: "docs/notes.md",
      url: "/files/docs/notes.md",
    });
    const markdownByMime = buildFilePreview({
      contentBytes: new TextEncoder().encode("# Notes\n"),
      mimeType: "text/markdown",
      path: "docs/notes",
      url: "/files/docs/notes",
    });
    const plainText = buildFilePreview({
      contentBytes: new TextEncoder().encode("# Notes\n"),
      mimeType: "text/plain",
      path: "docs/notes.txt",
      url: "/files/docs/notes.txt",
    });

    expect(isMarkdownFilePreview(markdownByPath)).toBe(true);
    expect(isMarkdownFilePreview(markdownByMime)).toBe(true);
    expect(isMarkdownFilePreview(plainText)).toBe(false);
  });

  it("detects CSV text previews by extension and mime type", () => {
    const csvByPath = buildFilePreview({
      contentBytes: new TextEncoder().encode("name,score\nAda,10\n"),
      mimeType: "text/plain",
      path: "reports/scores.csv",
      url: "/files/reports/scores.csv",
    });
    const csvByMime = buildFilePreview({
      contentBytes: new TextEncoder().encode("name,score\nAda,10\n"),
      mimeType: "text/csv",
      path: "reports/scores",
      url: "/files/reports/scores",
    });
    const plainText = buildFilePreview({
      contentBytes: new TextEncoder().encode("name,score\nAda,10\n"),
      mimeType: "text/plain",
      path: "reports/scores.txt",
      url: "/files/reports/scores.txt",
    });

    expect(isCsvFilePreview(csvByPath)).toBe(true);
    expect(isCsvFilePreview(csvByMime)).toBe(true);
    expect(isCsvFilePreview(plainText)).toBe(false);
  });
});
