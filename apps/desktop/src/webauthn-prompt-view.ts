export const WEBAUTHN_PROMPT_VIEW_HEIGHT = 44;

function renderWebauthnPromptView(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"
  />
  <title>Passkey handoff</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    * {
      box-sizing: border-box;
    }

    body {
      background: transparent;
      color: CanvasText;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu,
        sans-serif;
      font-size: 13px;
      margin: 0;
      overflow: hidden;
      user-select: none;
    }

    .bar {
      align-items: center;
      background: color-mix(in srgb, Canvas 96%, CanvasText 4%);
      border-bottom: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
      display: flex;
      gap: 10px;
      height: ${WEBAUTHN_PROMPT_VIEW_HEIGHT}px;
      padding: 0 12px;
    }

    .message {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .message[data-tone="error"] {
      color: color-mix(in srgb, #f04438 82%, CanvasText);
    }

    .actions {
      align-items: center;
      display: flex;
      flex: 0 0 auto;
      gap: 6px;
    }

    button {
      background: transparent;
      border: 1px solid color-mix(in srgb, CanvasText 18%, transparent);
      border-radius: 6px;
      color: CanvasText;
      cursor: default;
      font: inherit;
      height: 26px;
      padding: 0 10px;
    }

    button[data-action="cancel"] {
      background: transparent;
      border-color: transparent;
      color: color-mix(in srgb, CanvasText 65%, transparent);
    }

    button[data-primary="true"] {
      background: color-mix(in srgb, CanvasText 92%, Canvas);
      border-color: transparent;
      color: Canvas;
    }

    button:hover {
      opacity: 0.85;
    }
  </style>
</head>
<body>
  <div class="bar" role="status" aria-live="polite">
    <span id="bb-webauthn-message" class="message"></span>
    <div class="actions">
      <button
        id="bb-webauthn-primary"
        type="button"
        data-primary="true"
      ></button>
      <button id="bb-webauthn-cancel" type="button" data-action="cancel">
        Cancel
      </button>
    </div>
  </div>
</body>
</html>`;
}

export function createWebauthnPromptViewUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(
    renderWebauthnPromptView(),
  )}`;
}
