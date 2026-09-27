// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  createBbDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/bb-desktop-test-utils";
import { BrowserTabLifecycleObserver } from "./BrowserTabLifecycleObserver";

const desktopInfo: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function browserTab(id: string): BrowserFixedPanelTab {
  return { environmentId: null, id, kind: "browser", title: null, url: "" };
}

function installDesktopBrowser() {
  const browser = createNoopDesktopBrowserApi();
  const detach = vi.spyOn(browser, "detach");
  window.bbDesktop = createBbDesktopApi(desktopInfo, browser);
  return detach;
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "bbDesktop");
});

describe("BrowserTabLifecycleObserver", () => {
  it("detaches the native view of a browser tab closed in the same thread", () => {
    const detach = installDesktopBrowser();
    const view = render(
      <BrowserTabLifecycleObserver
        browserTabs={[browserTab("a"), browserTab("b")]}
        threadId="thr_1"
      />,
    );
    view.rerender(
      <BrowserTabLifecycleObserver
        browserTabs={[browserTab("a")]}
        threadId="thr_1"
      />,
    );
    expect(detach.mock.calls).toEqual([["b"]]);
  });

  it("keeps native views when the thread changes", () => {
    const detach = installDesktopBrowser();
    const view = render(
      <BrowserTabLifecycleObserver
        browserTabs={[browserTab("a")]}
        threadId="thr_1"
      />,
    );
    view.rerender(
      <BrowserTabLifecycleObserver browserTabs={[]} threadId="thr_2" />,
    );
    expect(detach).not.toHaveBeenCalled();
  });
});
