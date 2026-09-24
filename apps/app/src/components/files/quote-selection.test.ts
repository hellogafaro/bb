import { Text } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  buildLineSelectionText,
  formatLineRange,
  lineRangeForDoc,
  lineRangeForOffsets,
  quoteSelectedText,
} from "./quote-selection";

describe("quote selection", () => {
  it("formats ranges like the source preview", () => {
    expect(formatLineRange(4, 4)).toBe("4");
    expect(formatLineRange(4, 8)).toBe("4-8");
  });

  it("quotes full lines under a path header", () => {
    const contents = "one\ntwo\nthree\n";
    expect(
      buildLineSelectionText({ contents, path: "src/a.ts", start: 2, end: 3 }),
    ).toBe("src/a.ts:2-3\ntwo\nthree");
    expect(
      buildLineSelectionText({ contents, path: "src/a.ts", start: 1, end: 1 }),
    ).toBe("src/a.ts:1\none");
    expect(
      buildLineSelectionText({ contents, path: "src/a.ts", start: 4, end: 4 }),
    ).toBeNull();
  });

  it("drops a trailing line-start caret from offsets and documents", () => {
    const contents = "one\ntwo\nthree";
    const doc = Text.of(["one", "two", "three"]);
    for (const [from, to, expected] of [
      [0, 3, { start: 1, end: 1 }],
      [0, 4, { start: 1, end: 1 }],
      [0, 7, { start: 1, end: 2 }],
      [4, 8, { start: 2, end: 2 }],
    ] as const) {
      expect(lineRangeForOffsets(contents, from, to)).toEqual(expected);
      expect(lineRangeForDoc(doc, from, to)).toEqual(expected);
    }
    expect(lineRangeForOffsets(contents, 2, 2)).toBeNull();
    expect(lineRangeForDoc(doc, 2, 2)).toBeNull();
  });

  it("maps rich markdown selections back to source lines", () => {
    const contents =
      "# Title\n\nA file tree in the BB thread side panel.\nHello **world**.\n";
    expect(
      quoteSelectedText(
        "README.md",
        contents,
        "A file tree in the BB thread side panel.",
      ),
    ).toBe("README.md:3\nA file tree in the BB thread side panel.");
    expect(quoteSelectedText("README.md", contents, "Title")).toBe(
      "README.md:1\n# Title",
    );
    expect(quoteSelectedText("README.md", contents, "not in the file")).toBe(
      "README.md\nnot in the file",
    );
    expect(quoteSelectedText("README.md", contents, "   ")).toBeNull();
  });
});
