import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import {
  Node as TiptapNode,
  createDocument,
  type Editor as TiptapEditor,
  type JSONContent,
} from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { Markdown } from "@tiptap/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { cn } from "@bb/shared-ui/lib/utils";
import { CONTROL_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { FILES_COPY } from "../files-copy";
import {
  EditorIcon as Icon,
  type EditorIconName as IconName,
} from "./editor-icons";
import "./typeset.css";
import SlashCommands from "./slash-command/commands";

const COPY = FILES_COPY.markdown;
const BUBBLE_PLUGIN_KEY = "editor-bubble";
const RAW_HTML_BLOCK = "rawMarkdownHtmlBlock";
const RAW_HTML_INLINE = "rawMarkdownHtmlInline";
const INLINE_HTML_TAG =
  /^(?:<!--[\s\S]*?-->|<\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>)/u;

function isInsertableImageSrc(src: string): boolean {
  const trimmed = src.trim();
  return trimmed.length > 0 && !/^(javascript|vbscript):/i.test(trimmed);
}

function rawHtml(node: ProseMirrorNode | JSONContent): string {
  const html = node.attrs?.["html"];
  return typeof html === "string" ? html : "";
}

const rawHtmlAttributes = () => ({
  html: {
    default: "",
    parseHTML: (element: HTMLElement) =>
      element.getAttribute("data-raw-markdown-html") ?? "",
    renderHTML: () => ({}),
  },
});

const RawHtmlInline = TiptapNode.create({
  name: RAW_HTML_INLINE,
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes: rawHtmlAttributes,
  parseHTML: () => [{ tag: "span[data-raw-markdown-html]" }],
  renderHTML: ({ node }) => [
    "span",
    { "data-raw-markdown-html": rawHtml(node), contenteditable: "false" },
    rawHtml(node),
  ],
  markdownTokenizer: {
    name: RAW_HTML_INLINE,
    level: "inline",
    start: "<",
    tokenize: (src: string) => {
      const match = INLINE_HTML_TAG.exec(src);
      return match === null
        ? undefined
        : { type: RAW_HTML_INLINE, raw: match[0], text: match[0] };
    },
  },
  markdownTokenName: RAW_HTML_INLINE,
  parseMarkdown: (token) => ({
    type: RAW_HTML_INLINE,
    attrs: { html: String(token.raw ?? "") },
  }),
  renderMarkdown: (node) => rawHtml(node),
});

const RawHtmlBlock = TiptapNode.create({
  name: RAW_HTML_BLOCK,
  group: "block",
  atom: true,
  selectable: false,
  draggable: false,
  addAttributes: rawHtmlAttributes,
  parseHTML: () => [{ tag: "div[data-raw-markdown-html]" }],
  renderHTML: ({ node }) => [
    "div",
    { "data-raw-markdown-html": rawHtml(node), contenteditable: "false" },
    rawHtml(node),
  ],
  markdownTokenName: "html",
  parseMarkdown(token) {
    const html = String(token.raw || token.text || "");
    if (html.trim().length === 0) return [];
    return token["block"] === true
      ? { type: RAW_HTML_BLOCK, attrs: { html: html.replace(/\s+$/u, "") } }
      : { type: RAW_HTML_INLINE, attrs: { html } };
  },
  renderMarkdown: (node) => rawHtml(node),
});

type IconButtonOptions = {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled: boolean;
  toggle?: boolean;
  pressed?: boolean;
  className?: string;
  onMouseDown?: (event: MouseEvent<HTMLButtonElement>) => void;
};

type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock";

const BLOCK_OPTIONS: ReadonlyArray<{ value: BlockType; label: string }> = [
  { value: "paragraph", label: COPY.text },
  { value: "heading1", label: COPY.heading1 },
  { value: "heading2", label: COPY.heading2 },
  { value: "heading3", label: COPY.heading3 },
  { value: "bulletList", label: COPY.bulletList },
  { value: "orderedList", label: COPY.orderedList },
  { value: "blockquote", label: COPY.quote },
  { value: "codeBlock", label: COPY.codeBlock },
];

function isBlockType(value: string): value is BlockType {
  return BLOCK_OPTIONS.some((option) => option.value === value);
}

const INACTIVE_STATE = {
  blockType: "paragraph",
  bold: false,
  italic: false,
  strike: false,
  code: false,
  link: false,
  inTable: false,
  onImage: false,
} as const satisfies Record<string, BlockType | boolean>;

function activeBlockType(editor: TiptapEditor): BlockType {
  if (editor.isActive("heading", { level: 1 })) return "heading1";
  if (editor.isActive("heading", { level: 2 })) return "heading2";
  if (editor.isActive("heading", { level: 3 })) return "heading3";
  if (editor.isActive("bulletList")) return "bulletList";
  if (editor.isActive("orderedList")) return "orderedList";
  if (editor.isActive("blockquote")) return "blockquote";
  if (editor.isActive("codeBlock")) return "codeBlock";
  return "paragraph";
}

const TOOLBAR_BUTTON_CLASS = `inline-flex size-7 cursor-pointer items-center justify-center rounded-sm ${CONTROL_HOVER_TRANSITION} hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50`;
const TOOLBAR_TOGGLE_BUTTON_CLASS = `${TOOLBAR_BUTTON_CLASS} aria-pressed:bg-state-active aria-pressed:text-foreground aria-pressed:hover:bg-state-active`;
const TOOLBAR_INPUT_CLASS =
  "border-input bg-background text-foreground h-7 min-w-56 flex-1 rounded-sm border px-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";
const TOOLBAR_ROW_CLASS =
  "border-border bg-popover flex flex-nowrap items-center gap-0.5 overflow-x-auto overflow-y-hidden rounded-md border p-1 shadow-sm whitespace-nowrap";
const TOOLBAR_PANEL_CLASS = `${TOOLBAR_ROW_CLASS} data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:slide-in-from-top-1 duration-200`;
const SURFACE_CLASS =
  "typeset typeset-editor min-h-full w-full bg-transparent px-4 py-3 outline-none [&_p.is-empty::before]:text-muted-foreground [&_p.is-empty::before]:content-[attr(data-placeholder)] [&_p.is-empty::before]:pointer-events-none [&_p.is-empty::before]:float-left [&_p.is-empty::before]:h-0 [&_td_p.is-empty::before]:content-none [&_th_p.is-empty::before]:content-none";

function IconButton({
  label,
  icon,
  onClick,
  disabled,
  toggle = false,
  pressed = false,
  className,
  onMouseDown,
}: IconButtonOptions) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseDown={onMouseDown}
      disabled={disabled}
      aria-label={label}
      aria-pressed={toggle ? pressed : undefined}
      className={cn(
        toggle ? TOOLBAR_TOGGLE_BUTTON_CLASS : TOOLBAR_BUTTON_CLASS,
        className,
      )}
      title={label}
    >
      <Icon name={icon} className="size-4" aria-hidden />
    </button>
  );
}

export function MarkdownRichEditor({
  value,
  revision,
  disabled,
  className,
  onAddToChat,
  onDocChange,
  onEditor,
}: {
  value: string;
  revision: number;
  disabled: boolean;
  className?: string;
  onAddToChat?: (markdown: string) => void;
  onDocChange: () => void;
  onEditor: (editor: TiptapEditor) => void;
}) {
  const onDocChangeRef = useRef(onDocChange);
  onDocChangeRef.current = onDocChange;
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [showTableActions, setShowTableActions] = useState(false);
  const [showAltInput, setShowAltInput] = useState(false);
  const [showImageUrlInput, setShowImageUrlInput] = useState(false);
  const showImageUrlInputRef = useRef(false);
  const editorRef = useRef<TiptapEditor | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageAltText, setImageAltText] = useState("");
  const bubbleMenuRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const imageUrlInputRef = useRef<HTMLInputElement>(null);
  const imageUrlWaiterRef = useRef<((src: string | null) => void) | null>(
    null,
  );
  const appliedValue = useRef(value);
  const appliedRevision = useRef(revision);

  const hideBubbleMenu = () => {
    const current = editorRef.current;
    if (current === null || current.isDestroyed) return;
    current.view.dispatch(current.state.tr.setMeta(BUBBLE_PLUGIN_KEY, "hide"));
  };

  const beginImageUrlInput = () => {
    imageUrlWaiterRef.current?.(null);
    imageUrlWaiterRef.current = null;
    setShowLinkInput(false);
    setShowTableActions(false);
    setShowAltInput(false);
    showImageUrlInputRef.current = true;
    setShowImageUrlInput(true);
    setImageUrl("");
  };

  const settleImageUrl = (src: string | null) => {
    const waiter = imageUrlWaiterRef.current;
    imageUrlWaiterRef.current = null;
    const wasAsking = showImageUrlInputRef.current;
    showImageUrlInputRef.current = false;
    if (wasAsking && src === null) hideBubbleMenu();
    setShowImageUrlInput(false);
    setImageUrl("");
    waiter?.(src);
  };

  const requestImageUrlRef = useRef<() => Promise<string | null>>(
    async () => null,
  );
  requestImageUrlRef.current = () => {
    beginImageUrlInput();
    return new Promise((resolve) => {
      imageUrlWaiterRef.current = resolve;
    });
  };
  const settleImageUrlRef = useRef(settleImageUrl);
  settleImageUrlRef.current = settleImageUrl;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false, underline: false }),
      Link.configure({
        openOnClick: false,
        enableClickSelection: true,
        HTMLAttributes: { rel: null, target: null },
      }),
      Image,
      Table,
      TableRow,
      TableHeader,
      TableCell,
      RawHtmlInline,
      RawHtmlBlock,
      Placeholder.configure({
        placeholder: ({
          node,
          editor: currentEditor,
        }: {
          node: ProseMirrorNode;
          editor: TiptapEditor;
        }): string =>
          node.type.name === "paragraph" &&
          !currentEditor.isActive("tableCell") &&
          !currentEditor.isActive("tableHeader")
            ? COPY.placeholder
            : "",
        showOnlyCurrent: true,
        includeChildren: true,
      }),
      Markdown,
      SlashCommands.configure({
        requestImageUrl: () => requestImageUrlRef.current(),
      }),
    ],
    content: value,
    contentType: "markdown",
    editorProps: {
      attributes: { class: SURFACE_CLASS },
      handleKeyDown: (_view, event) => {
        if (event.key === "/" && showImageUrlInputRef.current) {
          settleImageUrlRef.current(null);
        }
        return false;
      },
    },
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ transaction }) => {
      if (transaction.docChanged) onDocChangeRef.current();
    },
  });

  editorRef.current = editor;
  const onEditorRef = useRef(onEditor);
  onEditorRef.current = onEditor;
  useEffect(() => {
    if (editor !== null) onEditorRef.current(editor);
  }, [editor]);

  const activeState =
    useEditorState({
      editor,
      selector: ({ editor: current }) =>
        current === null
          ? null
          : {
              blockType: activeBlockType(current),
              bold: current.isActive("bold"),
              italic: current.isActive("italic"),
              strike: current.isActive("strike"),
              code: current.isActive("code"),
              link: current.isActive("link"),
              inTable: current.isActive("table"),
              onImage: current.isActive("image"),
            },
    }) ?? INACTIVE_STATE;

  useLayoutEffect(() => {
    if (editor === null) return;
    if (
      appliedRevision.current === revision &&
      appliedValue.current === value
    ) {
      return;
    }
    appliedRevision.current = revision;
    appliedValue.current = value;
    const markdown = editor.markdown;
    if (markdown === undefined) return;
    const next = createDocument(markdown.parse(value), editor.schema);
    const before = editor.state.doc;
    const start = before.content.findDiffStart(next.content);
    if (start === null) return;
    const end = before.content.findDiffEnd(next.content);
    if (end === null) return;
    const overlap = start - Math.min(end.a, end.b);
    if (overlap > 0) {
      end.a += overlap;
      end.b += overlap;
    }
    const scroller = editor.view.dom.closest(".bb-file-markdown");
    const top = scroller?.scrollTop;
    editor.view.dispatch(
      editor.state.tr
        .replace(start, end.a, next.slice(start, end.b))
        .setMeta("preventUpdate", true)
        .setMeta("addToHistory", false),
    );
    if (scroller !== null && top !== undefined) scroller.scrollTop = top;
  }, [editor, value, revision]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  const inTable = activeState.inTable;
  const onImage = activeState.onImage;

  useEffect(() => {
    if (!inTable) setShowTableActions(false);
  }, [inTable]);

  useEffect(() => {
    if (!onImage) setShowAltInput(false);
  }, [onImage]);

  useEffect(() => {
    if (
      (!showLinkInput &&
        !showTableActions &&
        !showAltInput &&
        !showImageUrlInput) ||
      editor === null
    ) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (bubbleMenuRef.current?.contains(target) ?? false) return;
      setShowLinkInput(false);
      setShowTableActions(false);
      setShowAltInput(false);
      settleImageUrlRef.current(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [showLinkInput, showTableActions, showAltInput, showImageUrlInput, editor]);

  useEffect(() => {
    if (!showLinkInput) return;
    const frame = requestAnimationFrame(() => {
      linkInputRef.current?.focus();
      linkInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [showLinkInput]);

  useEffect(() => {
    if (!showImageUrlInput || editor === null) return;
    editor.commands.focus();
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        imageUrlInputRef.current?.focus();
        imageUrlInputRef.current?.select();
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [showImageUrlInput, editor]);

  useEffect(() => {
    if (!showImageUrlInput) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      settleImageUrlRef.current(null);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [showImageUrlInput]);

  useEffect(
    () => () => {
      imageUrlWaiterRef.current?.(null);
      imageUrlWaiterRef.current = null;
    },
    [],
  );

  if (editor === null) return null;

  const setBlockType = (next: BlockType): void => {
    const chain = editor.chain().focus();
    switch (next) {
      case "paragraph":
        chain.setParagraph().run();
        break;
      case "heading1":
        chain.setHeading({ level: 1 }).run();
        break;
      case "heading2":
        chain.setHeading({ level: 2 }).run();
        break;
      case "heading3":
        chain.setHeading({ level: 3 }).run();
        break;
      case "bulletList":
        chain.toggleBulletList().run();
        break;
      case "orderedList":
        chain.toggleOrderedList().run();
        break;
      case "blockquote":
        chain.toggleBlockquote().run();
        break;
      case "codeBlock":
        chain.toggleCodeBlock().run();
        break;
    }
  };

  const markActions: ReadonlyArray<{
    label: string;
    icon: IconName;
    pressed: boolean;
    run: () => void;
  }> = [
    {
      label: COPY.bold,
      icon: "Bold",
      pressed: activeState.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: COPY.italic,
      icon: "Italic",
      pressed: activeState.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: COPY.strike,
      icon: "Strikethrough",
      pressed: activeState.strike,
      run: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      label: COPY.code,
      icon: "Code",
      pressed: activeState.code,
      run: () => editor.chain().focus().toggleCode().run(),
    },
  ];

  const openLinkInput = () => {
    if (showLinkInput) {
      setShowLinkInput(false);
      return;
    }
    const href = editor.getAttributes("link")["href"];
    setLinkUrl(
      editor.isActive("link") && typeof href === "string" ? href : "",
    );
    setShowLinkInput(true);
    setShowTableActions(false);
    setShowAltInput(false);
    settleImageUrl(null);
  };

  const openImageUrlInput = () => {
    if (showImageUrlInput) {
      settleImageUrl(null);
      return;
    }
    beginImageUrlInput();
  };

  const applyImageUrl = () => {
    const src = imageUrl.trim();
    if (!isInsertableImageSrc(src)) return;
    if (imageUrlWaiterRef.current !== null) {
      settleImageUrl(src);
      return;
    }
    editor.chain().focus().setImage({ src }).run();
    showImageUrlInputRef.current = false;
    setShowImageUrlInput(false);
    setImageUrl("");
  };

  const toggleTableActions = () => {
    if (!inTable) return;
    setShowTableActions((current) => !current);
    setShowLinkInput(false);
    setShowAltInput(false);
    settleImageUrl(null);
  };

  const toggleAltInput = () => {
    if (!onImage) return;
    if (showAltInput) {
      setShowAltInput(false);
      return;
    }
    const alt = editor.getAttributes("image")["alt"];
    setImageAltText(typeof alt === "string" ? alt : "");
    setShowAltInput(true);
    setShowLinkInput(false);
    setShowTableActions(false);
    settleImageUrl(null);
  };

  const applyLink = () => {
    const href = linkUrl.trim();
    if (href.length === 0) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
    setShowLinkInput(false);
  };

  const removeLink = () => {
    if (linkUrl.trim().length > 0 || editor.isActive("link")) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
    }
    setShowLinkInput(false);
    setLinkUrl("");
  };

  const applyImageAlt = (alt: string | undefined) => {
    if (!onImage) return;
    editor.chain().focus().updateAttributes("image", { alt }).run();
    setImageAltText(alt ?? "");
    setShowAltInput(false);
  };

  const addToChat = () => {
    if (onAddToChat === undefined) return;
    const { empty, from, to } = editor.state.selection;
    if (empty || from === to) return;
    const markdown =
      editor.markdown?.serialize(editor.state.doc.cut(from, to).toJSON()) ??
      "";
    const trimmed = markdown.trimEnd();
    if (trimmed.trim().length > 0) onAddToChat(trimmed);
  };

  const onEnter =
    (action: () => void) =>
    (event: ReactKeyboardEvent<HTMLInputElement>): void => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };

  const keepSelection = (event: MouseEvent<HTMLButtonElement>) =>
    event.preventDefault();

  return (
    <div className={cn("cn-editor", className)}>
      <BubbleMenu
        pluginKey={BUBBLE_PLUGIN_KEY}
        ref={bubbleMenuRef}
        editor={editor}
        updateDelay={0}
        className="z-50 w-fit max-w-[95vw] text-popover-foreground outline-hidden"
        options={{
          placement: "top",
          offset: 10,
          flip: { padding: 8 },
          shift: { padding: 8 },
        }}
        shouldShow={({ editor: bubbleEditor, from, to, view, element }) => {
          const hasEditorFocus =
            view.hasFocus() || element.contains(document.activeElement);
          if (!hasEditorFocus) return false;
          if (showImageUrlInputRef.current) return true;
          return (
            showLinkInput ||
            showTableActions ||
            showAltInput ||
            (!bubbleEditor.state.selection.empty && from !== to)
          );
        }}
      >
        <div className="flex flex-col gap-1">
          {showImageUrlInput ? (
            <div className={TOOLBAR_ROW_CLASS}>
              <input
                ref={imageUrlInputRef}
                type="text"
                placeholder={COPY.imagePlaceholder}
                value={imageUrl}
                onChange={(event) => setImageUrl(event.target.value)}
                onKeyDown={onEnter(applyImageUrl)}
                disabled={disabled}
                className={TOOLBAR_INPUT_CLASS}
              />
              <IconButton
                label={COPY.insertImage}
                icon="Check"
                onMouseDown={keepSelection}
                onClick={applyImageUrl}
                disabled={disabled || !isInsertableImageSrc(imageUrl)}
              />
              <IconButton
                label={COPY.cancelImage}
                icon="X"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => settleImageUrl(null)}
                disabled={disabled}
              />
            </div>
          ) : (
            <>
              <div className={TOOLBAR_ROW_CLASS}>
                {!inTable ? (
                  <div className="relative w-fit">
                    <select
                      value={activeState.blockType}
                      onChange={(event) => {
                        if (isBlockType(event.target.value)) {
                          setBlockType(event.target.value);
                        }
                      }}
                      disabled={disabled}
                      aria-label={COPY.blockStyle}
                      className={`h-7 w-full appearance-none rounded-sm border border-transparent bg-transparent px-2 pr-5.5 text-sm shadow-none outline-none ${CONTROL_HOVER_TRANSITION} hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-0 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      {BLOCK_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <Icon
                      name="ChevronDown"
                      className="text-muted-foreground pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 opacity-50"
                      aria-hidden
                    />
                  </div>
                ) : null}
                {markActions.map((action) => (
                  <IconButton
                    key={action.label}
                    label={action.label}
                    icon={action.icon}
                    onClick={action.run}
                    disabled={disabled}
                    toggle
                    pressed={action.pressed}
                  />
                ))}
                <IconButton
                  label={COPY.clearFormatting}
                  icon="TextClear"
                  onClick={() =>
                    editor.chain().focus().unsetAllMarks().clearNodes().run()
                  }
                  disabled={disabled}
                />
                <IconButton
                  label={COPY.link}
                  icon="Link"
                  onClick={openLinkInput}
                  disabled={disabled}
                  toggle
                  pressed={showLinkInput || activeState.link}
                />
                <IconButton
                  label={COPY.image}
                  icon="Image"
                  onClick={openImageUrlInput}
                  disabled={disabled}
                  toggle
                  pressed={showImageUrlInput || onImage}
                />
                {onImage ? (
                  <button
                    type="button"
                    aria-label={COPY.altText}
                    title={COPY.altText}
                    aria-pressed={showAltInput}
                    onClick={toggleAltInput}
                    disabled={disabled}
                    className={`${TOOLBAR_TOGGLE_BUTTON_CLASS} text-xs`}
                  >
                    ALT
                  </button>
                ) : null}
                {inTable ? (
                  <IconButton
                    label={COPY.table}
                    icon="Table"
                    onClick={toggleTableActions}
                    disabled={disabled}
                    toggle
                    pressed={showTableActions}
                  />
                ) : null}
                {onAddToChat !== undefined ? (
                  <IconButton
                    label={COPY.addToChat}
                    icon="MessageSquarePlus"
                    onMouseDown={keepSelection}
                    onClick={addToChat}
                    disabled={disabled}
                  />
                ) : null}
              </div>
              {showLinkInput ? (
                <div data-state="open" className={TOOLBAR_PANEL_CLASS}>
                  <input
                    ref={linkInputRef}
                    type="url"
                    placeholder={COPY.linkPlaceholder}
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    onKeyDown={onEnter(applyLink)}
                    disabled={disabled}
                    className={TOOLBAR_INPUT_CLASS}
                  />
                  <IconButton
                    label={COPY.setLink}
                    icon="Check"
                    onClick={applyLink}
                    disabled={disabled || linkUrl.trim().length === 0}
                  />
                  <IconButton
                    label={COPY.removeLink}
                    icon="X"
                    onClick={removeLink}
                    disabled={disabled}
                    className="ml-auto"
                  />
                </div>
              ) : null}
              {showAltInput && onImage ? (
                <div data-state="open" className={TOOLBAR_PANEL_CLASS}>
                  <input
                    type="text"
                    placeholder={COPY.altPlaceholder}
                    value={imageAltText}
                    onChange={(event) => setImageAltText(event.target.value)}
                    onKeyDown={onEnter(() =>
                      applyImageAlt(imageAltText.trim() || undefined),
                    )}
                    disabled={disabled}
                    className={TOOLBAR_INPUT_CLASS}
                  />
                  <IconButton
                    label={COPY.saveAlt}
                    icon="Check"
                    onClick={() =>
                      applyImageAlt(imageAltText.trim() || undefined)
                    }
                    disabled={disabled}
                  />
                  <IconButton
                    label={COPY.removeAlt}
                    icon="X"
                    onClick={() => applyImageAlt(undefined)}
                    disabled={disabled}
                    className="ml-auto"
                  />
                </div>
              ) : null}
              {showTableActions && inTable ? (
                <div
                  data-state="open"
                  className={cn(TOOLBAR_PANEL_CLASS, "w-fit gap-1 self-end")}
                >
                  <span className="ml-1 text-sm text-muted-foreground">
                    {COPY.rows}
                  </span>
                  <IconButton
                    label={COPY.addRow}
                    icon="Plus"
                    onClick={() => editor.chain().focus().addRowAfter().run()}
                    disabled={disabled}
                  />
                  <IconButton
                    label={COPY.removeRow}
                    icon="Minus"
                    onClick={() => editor.chain().focus().deleteRow().run()}
                    disabled={disabled}
                  />
                  <span
                    className="bg-border mx-0.5 h-4 w-px"
                    aria-hidden="true"
                  />
                  <span className="text-sm text-muted-foreground">
                    {COPY.columns}
                  </span>
                  <IconButton
                    label={COPY.addColumn}
                    icon="Plus"
                    onClick={() =>
                      editor.chain().focus().addColumnAfter().run()
                    }
                    disabled={disabled}
                  />
                  <IconButton
                    label={COPY.removeColumn}
                    icon="Minus"
                    onClick={() => editor.chain().focus().deleteColumn().run()}
                    disabled={disabled}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>
      </BubbleMenu>
      <EditorContent editor={editor} />
    </div>
  );
}
