// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SettingsSection,
  SettingsWithControl,
} from "@/components/ui/settings-section";
import { GeneralSettingsSection, SettingsDeepLinkTarget } from "./SettingsView";

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "scrollIntoView",
);

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (originalScrollIntoView)
    Object.defineProperty(
      Element.prototype,
      "scrollIntoView",
      originalScrollIntoView,
    );
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("settings deep links", () => {
  function DeferredThemeSetting() {
    const [ready, setReady] = useState(false);
    useEffect(() => {
      const timeout = window.setTimeout(() => setReady(true), 50);
      return () => window.clearTimeout(timeout);
    }, []);
    return ready ? (
      <SettingsWithControl settingId="theme" label="Theme">
        <button type="button">Theme choice</button>
      </SettingsWithControl>
    ) : null;
  }

  function generalSettings(desktopBrowserAvailable: boolean) {
    return (
      <GeneralSettingsSection
        desktopBrowserAvailable={desktopBrowserAvailable}
        generalSettingsDisabled={false}
        managedBranchPrefix=""
        navigateToThreadAfterCreate={false}
        onManagedBranchPrefixChange={vi.fn()}
        onNavigateToThreadAfterCreateChange={vi.fn()}
        onOpenLinksInAppBrowserChange={vi.fn()}
        onRewriteLocalhostLinksChange={vi.fn()}
        onRichTextEditingChange={vi.fn()}
        onSteerActiveThreadOnEnterChange={vi.fn()}
        openLinksInAppBrowser={false}
        rewriteLocalhostLinks={false}
        richTextEditing={false}
        steerActiveThreadOnEnter={false}
      />
    );
  }

  it("focuses a real general setting control", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <SettingsDeepLinkTarget settingId="new-branch-prefix">
        {generalSettings(false)}
      </SettingsDeepLinkTarget>,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "New branch prefix" }),
      ),
    );
  });

  it("explains when a conditional real setting is absent", () => {
    vi.useFakeTimers();
    render(
      <SettingsDeepLinkTarget settingId="in-app-links">
        {generalSettings(false)}
      </SettingsDeepLinkTarget>,
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("status").textContent).toContain("unavailable");
  });

  it("focuses the actual control after it is rendered", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <SettingsDeepLinkTarget settingId="theme">
        <SettingsWithControl settingId="theme" label="Theme">
          <button type="button">Theme choice</button>
        </SettingsWithControl>
      </SettingsDeepLinkTarget>,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Theme choice" }),
      ),
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();
  });

  it("waits for a real setting control mounted after the initial frames", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <SettingsDeepLinkTarget settingId="theme">
        <DeferredThemeSetting />
      </SettingsDeepLinkTarget>,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Theme choice" }),
      ),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("focuses a section heading instead of an unrelated first action", async () => {
    Element.prototype.scrollIntoView = vi.fn();
    render(
      <SettingsDeepLinkTarget settingId="community">
        <SettingsSection settingId="community" title="Community">
          <button type="button">Discord</button>
        </SettingsSection>
      </SettingsDeepLinkTarget>,
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Community" }),
      ),
    );
  });

  it("explains when the target control is unavailable", () => {
    vi.useFakeTimers();
    render(
      <SettingsDeepLinkTarget settingId="local-editor-integration">
        <div>File settings</div>
      </SettingsDeepLinkTarget>,
    );
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole("status").textContent).toContain("unavailable");
  });
});
