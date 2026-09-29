import { ipcRenderer } from "electron";
import {
  BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL,
  BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL,
  webauthnPromptStateSchema,
  type WebauthnPromptState,
} from "./webauthn-prompt-ipc.js";

window.addEventListener("DOMContentLoaded", () => {
  const message = document.querySelector<HTMLElement>("#bb-webauthn-message");
  const dismissButton = document.querySelector<HTMLButtonElement>(
    "#bb-webauthn-dismiss",
  );
  if (message === null || dismissButton === null) {
    return;
  }

  function render(state: WebauthnPromptState): void {
    if (message === null) {
      return;
    }
    message.textContent = state.message;
  }

  dismissButton.addEventListener("click", () => {
    ipcRenderer.send(BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL, {
      action: "dismiss",
    });
  });

  ipcRenderer.on(
    BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL,
    (_event, payload) => {
      const parsed = webauthnPromptStateSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      render(parsed.data);
    },
  );
});
