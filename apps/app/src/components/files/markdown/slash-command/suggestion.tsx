import { ReactRenderer } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import type { SuggestionOptions } from "@tiptap/suggestion";
import { FILES_COPY } from "../../files-copy";
import CommandsList, {
  type CommandsListHandle,
  type SlashItem,
} from "./commands-list";

const COPY = FILES_COPY.markdown;
const POPUP_MARGIN = 4;

type SlashSuggestion = Pick<
  SuggestionOptions<SlashItem>,
  "items" | "render" | "command"
>;
type SuggestionRenderLifecycle = NonNullable<
  ReturnType<NonNullable<SlashSuggestion["render"]>>
>;

function slashItems(
  requestImageUrl: () => Promise<string | null>,
): SlashItem[] {
  return [
    {
      title: COPY.text,
      icon: "Pilcrow",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).setParagraph().run(),
    },
    {
      title: COPY.heading1,
      icon: "Heading1",
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setHeading({ level: 1 })
          .run(),
    },
    {
      title: COPY.heading2,
      icon: "Heading2",
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setHeading({ level: 2 })
          .run(),
    },
    {
      title: COPY.heading3,
      icon: "Heading3",
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .setHeading({ level: 3 })
          .run(),
    },
    {
      title: COPY.bulletList,
      icon: "List",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBulletList().run(),
    },
    {
      title: COPY.orderedList,
      icon: "ListOrdered",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
    },
    {
      title: COPY.image,
      icon: "Image",
      tableSafe: true,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        void requestImageUrl().then((src) => {
          if (src === null || editor.isDestroyed) return;
          editor.chain().focus().setImage({ src }).run();
        });
      },
    },
    {
      title: COPY.table,
      icon: "Table",
      command: ({ editor, range }) =>
        editor
          .chain()
          .focus()
          .deleteRange(range)
          .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
          .run(),
    },
    {
      title: COPY.quote,
      icon: "Quote",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleBlockquote().run(),
    },
    {
      title: COPY.codeBlock,
      icon: "Code",
      command: ({ editor, range }) =>
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
    },
  ];
}

function placePopup(popup: HTMLElement, rect: DOMRect | null): void {
  if (rect === null) return;
  const height = popup.offsetHeight;
  const below = rect.bottom + POPUP_MARGIN;
  const above = rect.top - POPUP_MARGIN - height;
  const top = below + height > window.innerHeight && above >= 0 ? above : below;
  const left = Math.max(
    POPUP_MARGIN,
    Math.min(rect.left, window.innerWidth - popup.offsetWidth - POPUP_MARGIN),
  );
  popup.style.transform = `translate(${left}px, ${top}px)`;
}

export function createSlashSuggestion(
  requestImageUrl: () => Promise<string | null>,
): SlashSuggestion {
  const items = slashItems(requestImageUrl);
  return {
    items: ({ query, editor }: { query: string; editor: Editor }) => {
      const inTable = editor.isActive("table");
      const needle = query.toLowerCase();
      return items.filter(
        (item) =>
          (!inTable || item.tableSafe === true) &&
          item.title.toLowerCase().includes(needle),
      );
    },

    command: ({ editor, range, props }) => props.command({ editor, range }),

    render: (): SuggestionRenderLifecycle => {
      let component: ReactRenderer<CommandsListHandle> | null = null;
      let popup: HTMLElement | null = null;
      let rect: (() => DOMRect | null) | null = null;
      let frame = 0;
      const place = () => {
        frame = 0;
        if (popup !== null) placePopup(popup, rect?.() ?? null);
      };
      const schedulePlace = () => {
        if (frame === 0) frame = requestAnimationFrame(place);
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(CommandsList, {
            props,
            editor: props.editor,
          });
          const element = component.element;
          if (!(element instanceof HTMLElement)) return;
          popup = element;
          rect = props.clientRect ?? null;
          popup.style.position = "fixed";
          popup.style.top = "0";
          popup.style.left = "0";
          popup.style.zIndex = "50";
          document.body.appendChild(popup);
          schedulePlace();
        },

        onUpdate: (props) => {
          component?.updateProps(props);
          rect = props.clientRect ?? null;
          schedulePlace();
        },

        onKeyDown: ({ event }) => {
          if (popup === null || popup.hidden) return false;
          if (event.key === "Escape") {
            popup.hidden = true;
            return true;
          }
          return component?.ref?.onKeyDown(event) ?? false;
        },

        onExit: () => {
          if (frame !== 0) cancelAnimationFrame(frame);
          frame = 0;
          popup?.remove();
          popup = null;
          component?.destroy();
          component = null;
        },
      };
    },
  };
}
