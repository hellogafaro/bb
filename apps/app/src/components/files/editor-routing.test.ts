import { describe, expect, it } from "vitest";
import { opensInEditor } from "./editor-routing";

describe("opensInEditor", () => {
  it("keeps streamed previews out of the editor", () => {
    for (const path of [
      "docs/report.pdf",
      "media/demo.mp4",
      "media/voice.mp3",
      "docs/plan.docx",
      "reports/q3.xlsx",
      "decks/roadmap.pptx",
      "dist/bundle.zip",
    ]) {
      expect(opensInEditor(path)).toBe(false);
    }
  });

  it("still opens text and image files in the editor", () => {
    expect(opensInEditor("src/index.ts")).toBe(true);
    expect(opensInEditor("img/logo.png")).toBe(true);
    expect(opensInEditor("Makefile")).toBe(true);
  });

  it("routes html and htm files to the rendered preview instead of the editor", () => {
    expect(opensInEditor("index.html")).toBe(false);
    expect(opensInEditor("legacy/page.htm")).toBe(false);
    expect(opensInEditor("REPORT.HTML")).toBe(false);
  });
});
