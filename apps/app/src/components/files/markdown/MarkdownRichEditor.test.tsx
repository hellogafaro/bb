// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownRichEditor } from "./MarkdownRichEditor";

const SOURCE = [
  "# Title",
  "",
  '<div align="center"><img src="logo.png" onerror="window.pwned = true"></div>',
  "",
  "Press <kbd>Ctrl</kbd> to continue.",
].join("\n");

async function mount(value: string): Promise<Editor> {
  let editor: Editor | null = null;
  render(
    <MarkdownRichEditor
      value={value}
      revision={0}
      disabled={false}
      onDocChange={() => undefined}
      onEditor={(next) => {
        editor = next;
      }}
    />,
  );
  return waitFor(() => {
    if (editor === null) throw new Error("editor not ready");
    return editor;
  });
}

describe("MarkdownRichEditor", () => {
  afterEach(() => cleanup());

  it("keeps raw HTML verbatim and renders it as text", async () => {
    const editor = await mount(SOURCE);
    expect(editor.getMarkdown().trim()).toBe(SOURCE);
    await waitFor(() =>
      expect(
        document.querySelector("[data-raw-markdown-html]")?.textContent,
      ).toContain("<img"),
    );
    expect(document.querySelector("img")).toBeNull();
  });
});
