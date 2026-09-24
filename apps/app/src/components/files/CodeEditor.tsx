import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import {
  Compartment,
  EditorState,
  Prec,
  Text,
  Transaction,
} from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { useCodeTheme } from "@/lib/plugin-code-theme";
import {
  codeMirrorTheme,
  editorChrome,
  selectionForeground,
} from "./code-editor-theme";
import { editorSurface } from "./code-theme-colors";
import { loadLanguageForPath } from "./code-editor-language";
import { textChange } from "./file-sync";
import {
  ScrollEdgeFades,
  watchOverflowEdges,
  type OverflowEdges,
} from "./scroll-fade";
import { useEditorSelectionMenu } from "./useEditorSelectionMenu";

export interface FileEditorHandle {
  getDoc(): string;
  blur(): void;
  isComposing(): boolean;
}

function baseExtensions() {
  return [
    editorChrome,
    lineNumbers(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    selectionForeground,
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    keymap.of([
      indentWithTab,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
    ]),
  ];
}

function toText(value: string): Text {
  return Text.of(value.split(/\r\n?|\n/));
}

function lineSeparator(value: string): string {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

interface CodeEditorProps {
  path: string;
  value: string;
  cleanValue: string;
  revision: number;
  onDirty: (dirty: boolean) => void;
  onSave: () => void;
  onAddToChat?: (text: string) => void;
  readOnly: boolean;
  wrap: boolean;
  startLine?: number | null;
  endLine?: number | null;
  handleRef: MutableRefObject<FileEditorHandle | null>;
}

export const CodeEditor = memo(function CodeEditor({
  path,
  value,
  cleanValue,
  revision,
  onDirty,
  onSave,
  onAddToChat,
  readOnly,
  wrap,
  startLine,
  endLine,
  handleRef,
}: CodeEditorProps) {
  const parent = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const skipSelectionMenu = useRef(false);
  const language = useRef(new Compartment());
  const theme = useRef(new Compartment());
  const editable = useRef(new Compartment());
  const wrapping = useRef(new Compartment());
  const separator = useRef(new Compartment());
  const baseline = useRef(Text.empty);
  const applying = useRef(false);
  const onDirtyRef = useRef(onDirty);
  const onSaveRef = useRef(onSave);
  onDirtyRef.current = onDirty;
  onSaveRef.current = onSave;
  const codeTheme = useCodeTheme();
  const configuration = useRef({ theme: codeTheme.theme, readOnly, wrap });
  const surface =
    codeTheme.theme === null
      ? "var(--background)"
      : editorSurface(codeTheme.theme);
  const [edges, setEdges] = useState<OverflowEdges>({
    above: false,
    below: false,
  });
  const menu = useEditorSelectionMenu({
    containerRef: parent,
    viewRef,
    path,
    skipRef: skipSelectionMenu,
    onAddToChat,
  });

  useLayoutEffect(() => {
    const node = parent.current;
    if (node === null) return;
    let schedule = () => {};
    const view = new EditorView({
      parent: node,
      state: EditorState.create({
        doc: toText(value),
        extensions: [
          baseExtensions(),
          separator.current.of(EditorState.lineSeparator.of(lineSeparator(value))),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-s",
                preventDefault: true,
                run: () => {
                  onSaveRef.current();
                  return true;
                },
              },
            ]),
          ),
          wrapping.current.of(wrap ? EditorView.lineWrapping : []),
          language.current.of([]),
          theme.current.of(
            codeTheme.theme !== null
              ? codeMirrorTheme(codeTheme.theme)
              : syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ),
          editable.current.of(EditorState.readOnly.of(readOnly)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !applying.current) {
              onDirtyRef.current(!update.state.doc.eq(baseline.current));
            }
            if (update.docChanged || update.heightChanged) schedule();
          }),
        ],
      }),
    });
    viewRef.current = view;
    handleRef.current = {
      getDoc: () => view.state.sliceDoc(),
      blur: () => view.contentDOM.blur(),
      isComposing: () => view.composing,
    };
    baseline.current = toText(cleanValue);
    const watch = watchOverflowEdges(view.scrollDOM, setEdges);
    schedule = watch.schedule;
    return () => {
      watch.disconnect();
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLanguageForPath(path).then((extensions) => {
      const view = viewRef.current;
      if (cancelled || view === null) return;
      view.dispatch({ effects: language.current.reconfigure(extensions) });
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const previous = view.state.doc.toString();
    const normalized = value.replace(/\r\n?/g, "\n");
    const nextSeparator = lineSeparator(value);
    const effects =
      view.state.lineBreak === nextSeparator
        ? []
        : [
            separator.current.reconfigure(
              EditorState.lineSeparator.of(nextSeparator),
            ),
          ];
    if (previous === normalized) {
      if (effects.length > 0) view.dispatch({ effects });
      return;
    }
    const scrollTop = view.scrollDOM.scrollTop;
    const scrollLeft = view.scrollDOM.scrollLeft;
    applying.current = true;
    try {
      const change = textChange(previous, normalized);
      view.dispatch({
        changes: { ...change, insert: toText(change.insert) },
        effects,
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      applying.current = false;
    }
    view.scrollDOM.scrollTop = scrollTop;
    view.scrollDOM.scrollLeft = scrollLeft;
  }, [value, revision]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    baseline.current = toText(cleanValue);
    onDirtyRef.current(!view.state.doc.eq(baseline.current));
  }, [cleanValue, revision]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    const previous = configuration.current;
    const effects = [];
    if (previous.theme !== codeTheme.theme) {
      effects.push(
        theme.current.reconfigure(
          codeTheme.theme === null
            ? syntaxHighlighting(defaultHighlightStyle, { fallback: true })
            : codeMirrorTheme(codeTheme.theme),
        ),
      );
    }
    if (previous.readOnly !== readOnly) {
      effects.push(
        editable.current.reconfigure(EditorState.readOnly.of(readOnly)),
      );
    }
    if (previous.wrap !== wrap) {
      effects.push(
        wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []),
      );
    }
    configuration.current = { theme: codeTheme.theme, readOnly, wrap };
    if (effects.length > 0) view.dispatch({ effects });
  }, [codeTheme.theme, readOnly, wrap]);

  useLayoutEffect(() => {
    const view = viewRef.current;
    if (view === null || startLine == null) return;
    const doc = view.state.doc;
    const fromLine = Math.min(Math.max(startLine, 1), doc.lines);
    const toLine = Math.min(
      Math.max(endLine ?? startLine, fromLine),
      doc.lines,
    );
    const start = doc.line(fromLine);
    const end = doc.line(toLine);
    const selection = view.state.selection.main;
    if (selection.from === start.from && selection.to === end.to) return;
    skipSelectionMenu.current = true;
    view.dispatch({
      selection: { anchor: start.from, head: end.to },
      scrollIntoView: true,
    });
  }, [path, startLine, endLine, revision]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden px-4">
      <div ref={parent} className="h-full min-h-0 overflow-hidden" />
      {menu}
      <ScrollEdgeFades
        above={edges.above}
        below={edges.below}
        color={surface}
      />
    </div>
  );
});
