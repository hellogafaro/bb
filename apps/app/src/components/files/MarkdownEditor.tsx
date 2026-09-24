import {
  memo,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import type { Editor as TiptapEditor } from "@tiptap/core";
import { useCodeTheme } from "@/lib/plugin-code-theme";
import type { FileEditorHandle } from "./CodeEditor";
import { editorSelectionPaint } from "./code-theme-colors";
import { MarkdownRichEditor } from "./markdown/MarkdownRichEditor";
import { quoteSelectedText } from "./quote-selection";
import "./markdown/markdown-editor.css";

interface MarkdownEditorProps {
  path: string;
  value: string;
  revision: number;
  onDirty: (dirty: boolean) => void;
  onAddToChat?: (text: string) => void;
  readOnly: boolean;
  handleRef: MutableRefObject<FileEditorHandle | null>;
}

export const MarkdownEditor = memo(function MarkdownEditor({
  path,
  value,
  revision,
  onDirty,
  onAddToChat,
  readOnly,
  handleRef,
}: MarkdownEditorProps) {
  const editor = useRef<TiptapEditor | null>(null);
  const loaded = useRef(value);
  const composing = useRef(false);
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  const paint = editorSelectionPaint(useCodeTheme().theme);

  useLayoutEffect(() => {
    loaded.current = value;
  }, [value, revision]);

  useLayoutEffect(() => {
    handleRef.current = {
      getDoc() {
        const current = editor.current;
        if (current === null) return loaded.current;
        try {
          const markdown = current.getMarkdown().replace(/\s+$/u, "");
          return loaded.current.endsWith("\n") ? `${markdown}\n` : markdown;
        } catch {
          return loaded.current;
        }
      },
      isComposing: () => composing.current,
      blur() {
        const current = editor.current;
        if (current !== null && !current.isDestroyed) {
          current.commands.blur();
        }
      },
    };
  }, [handleRef]);

  return (
    <div
      onCompositionStartCapture={() => {
        composing.current = true;
      }}
      onCompositionEndCapture={() => {
        composing.current = false;
      }}
      className="bb-file-markdown h-full min-h-0 overflow-auto"
      style={
        {
          "--bb-file-sel-bg": paint.background,
          "--bb-file-sel-fg": paint.color,
        } as CSSProperties
      }
    >
      <MarkdownRichEditor
        value={value}
        revision={revision}
        disabled={readOnly}
        className="h-full min-h-0"
        onEditor={(next) => {
          editor.current = next;
        }}
        onDocChange={() => onDirtyRef.current(true)}
        onAddToChat={
          onAddToChat === undefined
            ? undefined
            : (markdown) => {
                const current = editor.current;
                const contents =
                  current === null ? loaded.current : current.getMarkdown();
                const text = quoteSelectedText(path, contents, markdown);
                if (text !== null) onAddToChat(text);
              }
        }
      />
    </div>
  );
});
