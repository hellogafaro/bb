import { ipcRenderer } from "electron";
import {
  BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL,
  BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL,
  webauthnPromptStateSchema,
  type WebauthnPromptActionRequest,
  type WebauthnPromptState,
} from "./webauthn-prompt-ipc.js";

window.addEventListener("DOMContentLoaded", () => {
  const message = document.querySelector<HTMLElement>("#bb-webauthn-message");
  const primaryButton = document.querySelector<HTMLButtonElement>(
    "#bb-webauthn-primary",
  );
  const cancelButton = document.querySelector<HTMLButtonElement>(
    "#bb-webauthn-cancel",
  );
  if (message === null || primaryButton === null || cancelButton === null) {
    return;
  }

  function sendAction(action: WebauthnPromptActionRequest["action"]): void {
    ipcRenderer.send(BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL, {
      action,
    } satisfies WebauthnPromptActionRequest);
  }

  function render(state: WebauthnPromptState): void {
    if (message === null || primaryButton === null) {
      return;
    }
    message.dataset.tone = state.stage === "error" ? "error" : "";
    switch (state.stage) {
      case "ask":
        message.textContent = `${state.host} wants a passkey.`;
        primaryButton.textContent = `Continue in ${state.browserLabel}`;
        primaryButton.disabled = false;
        primaryButton.dataset.action = "continue";
        break;
      case "handoff":
        message.textContent = `Sign in to ${state.host} in ${state.browserLabel}, then come back here.`;
        primaryButton.textContent = "I've signed in — bring it to BB";
        primaryButton.disabled = false;
        primaryButton.dataset.action = "bring-to-bb";
        break;
      case "importing":
        message.textContent = "Bringing your sign-in to BB…";
        primaryButton.textContent = "Bringing over…";
        primaryButton.disabled = true;
        primaryButton.dataset.action = "";
        break;
      case "error":
        message.textContent = state.message;
        primaryButton.textContent = "Retry";
        primaryButton.disabled = !state.retryable;
        primaryButton.dataset.action = "retry";
        break;
    }
  }

  primaryButton.addEventListener("click", () => {
    const action = primaryButton.dataset.action;
    if (
      action === "continue" ||
      action === "bring-to-bb" ||
      action === "retry"
    ) {
      sendAction(action);
    }
  });
  cancelButton.addEventListener("click", () => {
    sendAction("cancel");
  });

  ipcRenderer.on(BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL, (_event, payload) => {
    const parsed = webauthnPromptStateSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    render(parsed.data);
  });
});
