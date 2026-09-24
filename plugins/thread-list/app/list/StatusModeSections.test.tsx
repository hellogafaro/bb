// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import {
  installTestPluginRuntime,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { makePluginProject, makeSidebarThread } from "../model/fixtures.js";
import { preferencesReadyAtom } from "../preferences/preferences-sync.js";
import { sidebarOrganizationModeAtom } from "../preferences/atoms.js";
import type { Snooze } from "../../shared/snoozes.js";

installTestPluginRuntime();
const { ProjectList } = await import("./ProjectList.js");
const { resetSidebarDataCacheForTest } =
  await import("../model/use-sidebar-data.js");

afterEach(() => {
  cleanup();
  resetSidebarDataCacheForTest();
});

function Harness({
  children,
  store,
}: {
  children: ReactNode;
  store: ReturnType<typeof createStore>;
}) {
  return (
    <TooltipProvider>
      <Provider store={store}>{children}</Provider>
    </TooltipProvider>
  );
}

function thread(id: string, overrides: Partial<PluginSidebarThread> = {}) {
  return makeSidebarThread({
    id,
    title: id,
    updatedAt: 100,
    latestAttentionAt: 100,
    lastReadAt: 100,
    ...overrides,
  });
}

function renderStatusList(
  threads: PluginSidebarThread[],
  snoozes: Snooze[] = [],
) {
  const store = createStore();
  store.set(preferencesReadyAtom(), true);
  store.set(sidebarOrganizationModeAtom, "status");
  let current = snoozes;
  const rendered = renderSlot(
    { component: Harness },
    { children: <ProjectList activeThreadId={null} />, store },
    {
      sidebarThreads: { threads, projects: [makePluginProject()] },
      rpc: {
        listSnoozes: () => ({ snoozes: current }),
        snooze: (input: unknown) => {
          const { threadId, until } = input as {
            threadId: string;
            until: number;
          };
          current = [...current, { threadId, until, at: Date.now() }];
          return { snoozes: current };
        },
        unsnooze: (input: unknown) => {
          const { threadId } = input as { threadId: string };
          current = current.filter((entry) => entry.threadId !== threadId);
          return { snoozes: current };
        },
      },
    },
  );
  return { ...rendered, store };
}

function section(label: string) {
  const header = screen.getByRole("button", {
    name: new RegExp(`(Expand|Collapse) ${label} section`),
  });
  return header.closest("[data-sidebar-section-id]") as HTMLElement;
}

describe("status organization", () => {
  it("groups threads by what they need from you", async () => {
    renderStatusList([
      thread("thr_asks", { hasPendingInteraction: true }),
      thread("thr_runs", { status: "active", runtimeStatus: "active" }),
      thread("thr_ready", { lastReadAt: 0 }),
      thread("thr_done"),
    ]);
    await screen.findByRole("link", { name: "Open thr_asks" });
    expect(
      within(section("Waiting")).getByRole("link", { name: "Open thr_asks" }),
    ).not.toBeNull();
    expect(
      within(section("Working")).getByRole("link", { name: "Open thr_runs" }),
    ).not.toBeNull();
    expect(
      within(section("Ready")).getByRole("link", { name: "Open thr_ready" }),
    ).not.toBeNull();
    expect(
      within(section("Done")).getByRole("link", { name: "Open thr_done" }),
    ).not.toBeNull();
    expect(screen.queryByText("Snoozed")).toBeNull();
  });

  it("shows each count beside its label without header actions", async () => {
    renderStatusList([thread("thr_done"), thread("thr_also_done")]);
    await screen.findByRole("link", { name: "Open thr_done" });
    const header = screen.getByRole("button", {
      name: "Collapse Done section",
    }).parentElement!;
    expect(header.textContent).toBe("Done2");
    expect(screen.queryByRole("button", { name: "Done actions" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "New thread in Done" }),
    ).toBeNull();
  });

  it("moves a snoozed thread into the collapsed Snoozed section", async () => {
    renderStatusList(
      [thread("thr_quiet"), thread("thr_done")],
      [{ threadId: "thr_quiet", until: Date.now() + 3_600_000, at: 150 }],
    );
    const header = await screen.findByRole("button", {
      name: "Expand Snoozed section",
    });
    expect(screen.queryByRole("link", { name: "Open thr_quiet" })).toBeNull();
    fireEvent.click(header);
    const link = await screen.findByRole("link", { name: "Open thr_quiet" });
    expect(link.closest("[data-sidebar-section-id]")).toBe(section("Snoozed"));
  });

  it("snoozes a thread from its hover control", async () => {
    const { inspection } = renderStatusList([thread("thr_done")]);
    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "Snooze thread" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /In 1 hour/ }));
    await waitFor(() =>
      expect(inspection.rpcCalls.map((call) => call.method)).toContain(
        "snooze",
      ),
    );
    expect(
      await screen.findByRole("button", { name: "Expand Snoozed section" }),
    ).not.toBeNull();
  });
});
