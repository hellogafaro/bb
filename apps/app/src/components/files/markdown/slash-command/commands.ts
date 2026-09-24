import { Extension } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";
import { createSlashSuggestion } from "./suggestion";

interface SlashCommandsOptions {
  requestImageUrl: () => Promise<string | null>;
}

const SlashCommands = Extension.create<SlashCommandsOptions>({
  name: "slash-commands",

  addOptions() {
    return { requestImageUrl: async () => null };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        ...createSlashSuggestion(this.options.requestImageUrl),
      }),
    ];
  },
});

export default SlashCommands;
