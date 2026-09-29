import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
      <p id="status">idle</p>
      <script>
        document.querySelector('#passkey').addEventListener('click', () => {
          document.querySelector('#status').textContent = 'pending';
          navigator.credentials.get({ publicKey: { challenge: new Uint8Array(1), rpId: location.hostname } })
            .then(() => { document.querySelector('#status').textContent = 'resolved'; })
            .catch((error) => { document.querySelector('#status').textContent = 'rejected:' + error.name; });
        });
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

  let capturedRequest: DesktopBrowserWebauthnRequestArgs | null = null;
  const promptManager = createDesktopWebauthnViewManager({
    preloadPath: config.webauthnPromptPreloadPath,
    onAction({ hostWindow, tabId, action }) {
      if (action !== "cancel") return;
      manager.rejectWebauthnRequest({
        hostWindow: hostWindow as unknown as BrowserWindow,
        tabId,
        requestId: capturedRequest?.requestId ?? 0,
      });
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
      promptManager.open({
        hostWindow: request.hostWindow,
        tabId: request.tabId,
        tabBounds: request.bounds,
        state: {
          stage: "ask",
          host: new URL(request.url).host,
          browserLabel: "your browser",
        },
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

  await tabView.webContents.executeJavaScript(
    "document.querySelector('#passkey').click(); undefined",
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 300));

  assert(
    capturedRequest !== null,
    "navigator.credentials.get did not trigger onWebauthnRequest",
  );
  assert.equal((capturedRequest as DesktopBrowserWebauthnRequestArgs).mode, "get");
  const statusWhilePending = await tabView.webContents.executeJavaScript(
    "document.querySelector('#status').textContent",
  );
  assert.equal(statusWhilePending, "pending");
  passed(
    "clicking the passkey button never hangs: the page promise stays pending and a webauthn-request reaches the host instead of Electron's missing WebAuthn UI",
  );

  const promptView = findViewByUrlPrefix(window, "data:text/html;charset=utf-8");
  assert(promptView !== undefined, "Prompt banner was not opened");
  const promptMessage = await promptView.webContents.executeJavaScript(
    "document.querySelector('#bb-webauthn-message').textContent",
  );
  assert(promptMessage.includes("wants a passkey"));
  passed("the in-tab prompt banner renders with the site's host and a Continue/Cancel choice");

  await new Promise<void>((resolve) => setTimeout(resolve, 2000));
  const screenshotPath = join(config.artifacts, "webauthn-prompt.png");
  try {
    execFileSync("ffmpeg", [
      "-y",
      "-f",
      "x11grab",
      "-video_size",
      "1280x800",
      "-i",
      `${process.env.DISPLAY}+0,0`,
      "-frames:v",
      "1",
      screenshotPath,
    ]);
  } catch {
    const screenshot = await window.webContents.capturePage();
    await writeFile(screenshotPath, screenshot.toPNG());
  }

  await promptView.webContents.executeJavaScript(
    "document.querySelector('#bb-webauthn-cancel').click(); undefined",
  );
  await new Promise<void>((resolve) => setTimeout(resolve, 300));
  const statusAfterCancel = await tabView.webContents.executeJavaScript(
    "document.querySelector('#status').textContent",
  );
  assert.equal(statusAfterCancel, "rejected:NotAllowedError");
  passed(
    "clicking Cancel in the real prompt banner rejects the page's promise with NotAllowedError so the site falls back to its normal sign-in flow",
  );

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
