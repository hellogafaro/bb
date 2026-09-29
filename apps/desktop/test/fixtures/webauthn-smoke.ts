import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { promisify } from "node:util";
import { app, BrowserWindow } from "electron";
import { z } from "zod";
import {
  createDesktopBrowserViewManager,
  type DesktopBrowserWebauthnRequestArgs,
} from "../../src/desktop-browser-view.js";
import { createDesktopWebauthnViewManager } from "../../src/desktop-webauthn-view.js";
import { BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL } from "../../src/webauthn-prompt-ipc.js";
import { WEBAUTHN_PROMPT_VIEW_HEIGHT } from "../../src/webauthn-prompt-view.js";

const keepAlive = setInterval(() => {}, 1000);
app.once("quit", () => clearInterval(keepAlive));
const configSchema = z.object({
  artifacts: z.string().min(1),
  pagePreloadPath: z.string().min(1),
  webauthnPromptPreloadPath: z.string().min(1),
});

function findViewByUrlPrefix(window: BrowserWindow, prefix: string) {
  return window.contentView.children.find((candidate) => {
    const webContents = (
      candidate as unknown as { webContents?: Electron.WebContents }
    ).webContents;
    return webContents !== undefined && webContents.getURL().startsWith(prefix);
  }) as unknown as { webContents: Electron.WebContents } | undefined;
}

async function main() {
  const configPath = z.string().parse(process.argv.at(-1));
  const config = configSchema.parse(
    JSON.parse(readFileSync(configPath, "utf8")),
  );
  app.setPath("userData", join(config.artifacts, "electron-profile"));
  app.disableHardwareAcceleration();
  app.on("window-all-closed", () => {});
  await app.whenReady();

  const fixtureServer = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Passkey fixture</title>
      <style>body{font:20px sans-serif;padding:80px 24px}</style>
      <button id="passkey">Sign in with a passkey</button>
      <input autocomplete="username webauthn" />
      <p id="status">idle</p>
      <p id="conditional-status">idle</p>
      <script>
        document.querySelector('#passkey').addEventListener('click', () => {
          document.querySelector('#status').textContent = 'pending';
          navigator.credentials.get({ publicKey: { challenge: new Uint8Array(1), rpId: location.hostname } })
            .then(() => { document.querySelector('#status').textContent = 'resolved'; })
            .catch((error) => { document.querySelector('#status').textContent = 'rejected:' + error.name; });
        });
        document.querySelector('#conditional-status').textContent = 'pending';
        navigator.credentials.get({
          publicKey: { challenge: new Uint8Array(1), rpId: location.hostname },
          mediation: 'conditional',
        })
          .then(() => { document.querySelector('#conditional-status').textContent = 'resolved'; })
          .catch((error) => { document.querySelector('#conditional-status').textContent = 'rejected:' + error.name; });
      </script>`);
  });
  await new Promise<void>((resolve) =>
    fixtureServer.listen(0, "127.0.0.1", resolve),
  );
  const address = fixtureServer.address();
  assert(address !== null && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}`;

  const window = new BrowserWindow({ width: 900, height: 700, show: true });
  await window.loadURL("data:text/html,<title>Trusted app sentinel</title>");

  const NOTICE_MESSAGE =
    "Passkeys aren't available in BB's browser yet — use another sign-in option";
  let capturedRequest: DesktopBrowserWebauthnRequestArgs | null = null;
  const promptManager = createDesktopWebauthnViewManager({
    preloadPath: config.webauthnPromptPreloadPath,
    onAction({ hostWindow, tabId, action }) {
      if (action !== "dismiss") return;
      promptManager.close(hostWindow, tabId);
    },
  });
  const manager = createDesktopBrowserViewManager({
    dispatchAppCommand: () => {},
    focusHostWebContents: () => {},
    pagePreloadPath: config.pagePreloadPath,
    resolveAppCommand: () => null,
    onWebauthnRequest(request) {
      capturedRequest = request;
      manager.rejectWebauthnRequest({
        hostWindow: request.hostWindow as unknown as BrowserWindow,
        tabId: request.tabId,
        requestId: request.requestId,
      });
      promptManager.open({
        hostWindow: request.hostWindow,
        tabId: request.tabId,
        tabBounds: request.bounds,
        state: { stage: "notice", message: NOTICE_MESSAGE },
      });
    },
  });

  const tabId = "webauthn-smoke-tab";
  manager.attach({
    hostWindow: window,
    request: {
      tabId,
      threadId: "webauthn-smoke-thread",
      url,
      bounds: { x: 0, y: 0, width: 860, height: 640 },
      visible: true,
    },
  });

  const checks: string[] = [];
  function passed(name: string) {
    checks.push(name);
    console.log(`PASS ${name}`);
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Tab did not finish loading")),
      15000,
    );
    function poll() {
      const tab = manager.listTabs({
        hostWebContentsId: window.webContents.id,
        threadId: null,
      })[0];
      if (tab && !tab.isLoading && tab.url.startsWith(url)) {
        clearTimeout(timer);
        resolve();
        return;
      }
      setTimeout(poll, 50);
    }
    poll();
  });

  const tabView = findViewByUrlPrefix(window, url);
  assert(tabView !== undefined, "Missing attached browser tab view");

  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  const conditionalStatus = await tabView.webContents.executeJavaScript(
    "document.querySelector('#conditional-status').textContent",
  );
  assert.notEqual(
    conditionalStatus,
    "rejected:NotAllowedError",
    "a conditional-mediation get() on page load must call through to the real implementation, never our Cancel rejection",
  );
  assert.equal(
    capturedRequest,
    null,
    "a conditional-mediation get() on page load must never trigger onWebauthnRequest",
  );
  assert.equal(
    findViewByUrlPrefix(window, "data:text/html;charset=utf-8"),
    undefined,
    "a conditional-mediation get() on page load must never open the passkey banner",
  );
  passed(
    "a page's conditional-mediation get() on load (passkey autofill, e.g. GitHub/Google/Notion) calls through with no banner and no rejection",
  );

  await tabView.webContents.executeJavaScript(
    "document.querySelector('#passkey').click(); undefined",
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  assert(
    capturedRequest !== null,
    "navigator.credentials.get did not trigger onWebauthnRequest",
  );
  assert.equal(
    (capturedRequest as DesktopBrowserWebauthnRequestArgs).mode,
    "get",
  );
  const statusAfterClick = await tabView.webContents.executeJavaScript(
    "document.querySelector('#status').textContent",
  );
  assert.equal(statusAfterClick, "rejected:NotAllowedError");
  passed(
    "clicking the passkey button rejects immediately with NotAllowedError so the site falls back to its own sign-in options, instead of hanging on Electron's missing WebAuthn UI",
  );

  const promptView = findViewByUrlPrefix(
    window,
    "data:text/html;charset=utf-8",
  );
  assert(promptView !== undefined, "Notice banner was not opened");
  const promptMessage = await promptView.webContents.executeJavaScript(
    "document.querySelector('#bb-webauthn-message').textContent",
  );
  assert.equal(promptMessage, NOTICE_MESSAGE);
  passed(
    "the in-tab notice banner renders explaining passkeys aren't available yet",
  );

  await new Promise<void>((resolve) => setTimeout(resolve, 500));
  const tabScreenshot = await tabView.webContents.capturePage();
  assert(!tabScreenshot.isEmpty(), "Tab screenshot must not be empty");
  await writeFile(
    join(config.artifacts, "webauthn-tab.png"),
    tabScreenshot.toPNG(),
  );

  const bannerWindow = new BrowserWindow({
    width: 860,
    height: WEBAUTHN_PROMPT_VIEW_HEIGHT + 40,
    show: true,
    webPreferences: { preload: config.webauthnPromptPreloadPath },
  });
  await bannerWindow.loadURL(promptView.webContents.getURL());
  bannerWindow.webContents.send(BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL, {
    stage: "notice",
    message: NOTICE_MESSAGE,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  const bannerScreenshot = await bannerWindow.webContents.capturePage();
  assert(!bannerScreenshot.isEmpty(), "Banner screenshot must not be empty");
  await writeFile(
    join(config.artifacts, "webauthn-banner.png"),
    bannerScreenshot.toPNG(),
  );
  bannerWindow.destroy();
  passed(
    "captured the tab and the passkey notice banner via webContents.capturePage()",
  );

  await promptView.webContents.executeJavaScript(
    "document.querySelector('#bb-webauthn-dismiss').click(); undefined",
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  assert.equal(
    findViewByUrlPrefix(window, "data:text/html;charset=utf-8"),
    undefined,
    "Dismiss must close the notice banner",
  );
  passed("clicking Dismiss closes the notice banner");

  promptManager.destroyAll();
  manager.destroyAll();
  window.destroy();
  fixtureServer.closeAllConnections();
  await promisify(fixtureServer.close.bind(fixtureServer))();

  await writeFile(
    join(config.artifacts, "result.json"),
    JSON.stringify({ checks, cleanupCompleted: true }, null, 2),
  );
  console.log("BB_WEBAUTHN_SMOKE_COMPLETE");
  app.quit();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  console.log("BB_WEBAUTHN_SMOKE_FAILED");
  app.exit(1);
});
