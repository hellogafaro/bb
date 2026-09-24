import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { textChange } from "./file-sync";

describe("file sync", () => {
  it("keeps the caret when text is appended externally", () => {
    const state = EditorState.create({
      doc: "abc def ghi",
      selection: { anchor: 4 },
    });
    const next = state.update({
      changes: textChange(state.doc.toString(), "abc def ghi!"),
    }).state;
    expect(next.selection.main.head).toBe(4);
    expect(next.doc.toString()).toBe("abc def ghi!");
  });

  it("produces a single valid edit for any pair of texts", () => {
    const texts = [
      "",
      "abc",
      "ab",
      "😀 first",
      "😁 first",
      "a\r\nb",
      "\n",
      "a".repeat(100_000),
    ];
    for (const before of texts) {
      for (const after of texts) {
        const change = textChange(before, after);
        expect(
          before.slice(0, change.from) +
            change.insert +
            before.slice(change.to),
        ).toBe(after);
      }
    }
  });
});
