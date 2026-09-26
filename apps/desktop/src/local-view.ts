import { stripVTControlCharacters } from "node:util";
import { escapeHtmlText } from "@bb/text-utils";
import { z } from "zod";

export const STARTUP_ACTION_CHANNEL = "bb-desktop:startup-action";

export const startupActionIdSchema = z.enum([
  "choose-server",
  "open-moved-server",
  "reconnect-connect",
  "retry",
]);

export type StartupActionId = z.infer<typeof startupActionIdSchema>;

export interface StartupAction {
  id: StartupActionId;
  label: string;
}

export type LocalViewModel = LoadingViewModel | StartupErrorViewModel;

interface LoadingViewModel {
  kind: "loading";
  message: string;
  title: string;
}

interface StartupErrorViewModel {
  actions: StartupAction[];
  details: string;
  kind: "error";
  logText: string;
  title: string;
}

interface CreateLocalViewUrlArgs {
  viewModel: LocalViewModel;
}

function formatPlainLogText(value: string): string {
  return stripVTControlCharacters(value).replace(/\r\n?/gu, "\n");
}

function renderLoadingView(viewModel: LoadingViewModel): string {
  return `
    <main class="shell">
      <svg class="spinner" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11.9995 2C12.5518 2 12.9995 2.44772 12.9995 3V6C12.9995 6.55228 12.5518 7 11.9995 7C11.4472 7 10.9995 6.55228 10.9995 6V3C10.9995 2.44772 11.4472 2 11.9995 2ZM11.9995 17C12.5518 17 12.9995 17.4477 12.9995 18V21C12.9995 21.5523 12.5518 22 11.9995 22C11.4472 22 10.9995 21.5523 10.9995 21V18C10.9995 17.4477 11.4472 17 11.9995 17ZM20.6597 7C20.9359 7.47829 20.772 8.08988 20.2937 8.36602L17.6956 9.86602C17.2173 10.1422 16.6057 9.97829 16.3296 9.5C16.0535 9.02171 16.2173 8.41012 16.6956 8.13398L19.2937 6.63397C19.772 6.35783 20.3836 6.52171 20.6597 7ZM7.66935 14.5C7.94549 14.9783 7.78161 15.5899 7.30332 15.866L4.70525 17.366C4.22695 17.6422 3.61536 17.4783 3.33922 17C3.06308 16.5217 3.22695 15.9101 3.70525 15.634L6.30332 14.134C6.78161 13.8578 7.3932 14.0217 7.66935 14.5ZM20.6597 17C20.3836 17.4783 19.772 17.6422 19.2937 17.366L16.6956 15.866C16.2173 15.5899 16.0535 14.9783 16.3296 14.5C16.6057 14.0217 17.2173 13.8578 17.6956 14.134L20.2937 15.634C20.772 15.9101 20.9359 16.5217 20.6597 17ZM7.66935 9.5C7.3932 9.97829 6.78161 10.1422 6.30332 9.86602L3.70525 8.36602C3.22695 8.08988 3.06308 7.47829 3.33922 7C3.61536 6.52171 4.22695 6.35783 4.70525 6.63397L7.30332 8.13398C7.78161 8.41012 7.94549 9.02171 7.66935 9.5Z"></path></svg>
      <h1>${escapeHtmlText(viewModel.title)}</h1>
      <p>${escapeHtmlText(viewModel.message)}</p>
    </main>
  `;
}

function renderErrorView(viewModel: StartupErrorViewModel): string {
  const logText = formatPlainLogText(viewModel.logText);
  const logs =
    logText.trim().length > 0 ? `<pre>${escapeHtmlText(logText)}</pre>` : "";
  const buttons = viewModel.actions
    .map(
      (action) =>
        `<button type="button" data-startup-action="${action.id}">${escapeHtmlText(action.label)}</button>`,
    )
    .join("");
  const actions =
    buttons.length > 0 ? `<div class="actions">${buttons}</div>` : "";
  return `
    <main class="shell shell-error">
      <h1>${escapeHtmlText(viewModel.title)}</h1>
      <p>${escapeHtmlText(viewModel.details)}</p>
      ${actions}
      ${logs}
    </main>
  `;
}

function renderLocalView(viewModel: LocalViewModel): string {
  const body =
    viewModel.kind === "loading"
      ? renderLoadingView(viewModel)
      : renderErrorView(viewModel);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>bb</title>
  <style>
    :root {
      color-scheme: light dark;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    body {
      align-items: center;
      background: Canvas;
      color: CanvasText;
      display: flex;
      height: 100vh;
      justify-content: center;
      margin: 0;
    }

    .titlebar-drag-region {
      app-region: drag;
      -webkit-app-region: drag;
      background: transparent;
      border: 0;
      height: 28px;
      left: 0;
      position: fixed;
      right: 0;
      top: 0;
      user-select: none;
      z-index: 10;
    }

    button,
    a,
    input,
    textarea,
    select,
    summary,
    pre {
      app-region: no-drag;
      -webkit-app-region: no-drag;
    }

    .shell {
      max-width: 680px;
      padding: 32px;
      text-align: center;
    }

    .shell-error {
      text-align: left;
    }

    h1 {
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 0;
      line-height: 1.25;
      margin: 16px 0 8px;
    }

    p {
      color: color-mix(in srgb, CanvasText 74%, transparent);
      font-size: 14px;
      line-height: 1.5;
      margin: 0;
    }

    button {
      background: CanvasText;
      border: 0;
      border-radius: 6px;
      color: Canvas;
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      font-weight: 600;
      padding: 8px 14px;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 18px 0 0;
    }

    .actions button + button {
      background: color-mix(in srgb, CanvasText 10%, transparent);
      color: CanvasText;
    }

    pre {
      background: color-mix(in srgb, CanvasText 8%, transparent);
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      line-height: 1.45;
      margin: 18px 0 0;
      max-height: 260px;
      overflow: auto;
      padding: 12px;
      white-space: pre-wrap;
    }

    .spinner {
      animation: spin 0.9s linear infinite;
      color: CanvasText;
      display: block;
      height: 24px;
      margin: 0 auto;
      width: 24px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  </style>
</head>
<body>
<div class="titlebar-drag-region" data-testid="bb-local-view-window-drag-region" aria-hidden="true"></div>
${body}
</body>
</html>`;
}

export function createLocalViewUrl(args: CreateLocalViewUrlArgs): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    renderLocalView(args.viewModel),
  )}`;
}
