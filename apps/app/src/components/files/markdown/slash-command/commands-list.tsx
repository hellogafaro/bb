import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import type { Editor } from "@tiptap/core";
import { FILES_COPY } from "../../files-copy";
import {
  EditorIcon as Icon,
  type EditorIconName as IconName,
} from "../editor-icons";

export type SlashItem = {
  title: string;
  icon: IconName;
  tableSafe?: boolean;
  command: (params: {
    editor: Editor;
    range: { from: number; to: number };
  }) => void;
};

type CommandsListProps = {
  items: SlashItem[];
  command: (item: SlashItem) => void;
};

export type CommandsListHandle = {
  onKeyDown: (event: KeyboardEvent) => boolean;
};

const CommandsList = forwardRef<CommandsListHandle, CommandsListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) command(item);
    };

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (!items.length) return false;

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSelectedIndex(
            (current) => (current + items.length - 1) % items.length,
          );
          return true;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setSelectedIndex((current) => (current + 1) % items.length);
          return true;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }));

    return (
      <div className="bg-popover text-popover-foreground border-border z-50 min-w-44 overflow-hidden rounded-md border p-1 shadow-md">
        {items.length ? (
          items.map((item, index) => (
            <button
              key={item.title}
              type="button"
              onClick={() => selectItem(index)}
              aria-selected={selectedIndex === index}
              className="relative flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-state-hover hover:text-foreground focus:bg-state-hover focus:text-foreground aria-selected:bg-state-hover aria-selected:text-foreground"
            >
              <Icon name={item.icon} className="mr-2 size-4" aria-hidden />
              {item.title}
            </button>
          ))
        ) : (
          <div className="text-muted-foreground flex items-center px-2 py-1.5 text-sm">
            <Icon name="CircleX" className="mr-2 size-4" aria-hidden />
            {FILES_COPY.markdown.noCommands}
          </div>
        )}
      </div>
    );
  },
);

CommandsList.displayName = "CommandsList";

export default CommandsList;
