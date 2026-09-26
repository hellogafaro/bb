// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import {
  computeSidebarHoverCardPosition,
  createSidebarHoverCardTimingController,
  resolveSidebarThreadRowFromTarget,
} from "./sidebarThreadHoverCard";

describe("computeSidebarHoverCardPosition", () => {
  const viewport = { width: 1200, height: 800 };
  const card = { width: 288, height: 140 };

  it("places the card to the right of the row, aligned to its top", () => {
    const position = computeSidebarHoverCardPosition({
      anchor: { top: 200, left: 8, right: 248, bottom: 236 },
      card,
      viewport,
    });
    expect(position).toEqual({ x: 260, y: 200, side: "right" });
  });

  it("clamps the card inside the viewport vertically", () => {
    const nearBottom = computeSidebarHoverCardPosition({
      anchor: { top: 760, left: 8, right: 248, bottom: 796 },
      card,
      viewport,
    });
    expect(nearBottom.y).toBe(800 - 8 - 140);
    const aboveTop = computeSidebarHoverCardPosition({
      anchor: { top: -20, left: 8, right: 248, bottom: 16 },
      card,
      viewport,
    });
    expect(aboveTop.y).toBe(8);
  });

  it("flips to the left of the row when it does not fit on the right", () => {
    const position = computeSidebarHoverCardPosition({
      anchor: { top: 100, left: 900, right: 1100, bottom: 136 },
      card,
      viewport,
    });
    expect(position).toEqual({ x: 900 - 12 - 288, y: 100, side: "left" });
  });

  it("keeps the right side when neither side fits", () => {
    const position = computeSidebarHoverCardPosition({
      anchor: { top: 100, left: 40, right: 300, bottom: 136 },
      card,
      viewport: { width: 500, height: 800 },
    });
    expect(position.side).toBe("right");
    expect(position.x).toBe(312);
  });
});

describe("resolveSidebarThreadRowFromTarget", () => {
  function buildList() {
    const container = document.createElement("div");
    container.innerHTML = `
      <div data-sidebar-rename-row="" id="section-header"><span id="section-label">Pinned</span></div>
      <div data-sidebar-rename-row="" id="row-a">
        <a data-sidebar-thread-id="thr_a" id="link-a"></a>
        <button id="action-a">pin</button>
      </div>
      <div data-sidebar-rename-row="" id="row-b">
        <a data-sidebar-thread-id="thr_b" id="link-b"></a>
      </div>
      <div id="gap"></div>
    `;
    document.body.appendChild(container);
    return container;
  }

  it("resolves the thread from the link and from row siblings such as actions", () => {
    const container = buildList();
    const link = container.querySelector("#link-a");
    const action = container.querySelector("#action-a");
    const rowA = container.querySelector("#row-a");
    expect(resolveSidebarThreadRowFromTarget(link, container)).toEqual({
      threadId: "thr_a",
      row: rowA,
    });
    expect(resolveSidebarThreadRowFromTarget(action, container)).toEqual({
      threadId: "thr_a",
      row: rowA,
    });
    container.remove();
  });

  it("returns null for section headers, gaps, and targets outside the list", () => {
    const container = buildList();
    const outside = document.createElement("a");
    outside.setAttribute("data-sidebar-thread-id", "thr_outside");
    document.body.appendChild(outside);
    expect(
      resolveSidebarThreadRowFromTarget(
        container.querySelector("#section-label"),
        container,
      ),
    ).toBeNull();
    expect(
      resolveSidebarThreadRowFromTarget(
        container.querySelector("#gap"),
        container,
      ),
    ).toBeNull();
    expect(resolveSidebarThreadRowFromTarget(outside, container)).toBeNull();
    expect(resolveSidebarThreadRowFromTarget(null, container)).toBeNull();
    container.remove();
    outside.remove();
  });
});

describe("createSidebarHoverCardTimingController", () => {
  function setup() {
    vi.useFakeTimers();
    const onShow = vi.fn();
    const onHide = vi.fn();
    const controller = createSidebarHoverCardTimingController({
      onShow,
      onHide,
    });
    return { controller, onShow, onHide };
  }

  it("shows after the open delay and hides after the close delay", () => {
    const { controller, onShow, onHide } = setup();
    controller.enterRow("thr_a");
    vi.advanceTimersByTime(149);
    expect(onShow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onShow).toHaveBeenCalledWith("thr_a");
    controller.leaveRows();
    expect(controller.phase()).toEqual({ kind: "closing", threadId: "thr_a" });
    vi.advanceTimersByTime(99);
    expect(onHide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(controller.phase()).toEqual({ kind: "hidden" });
    vi.useRealTimers();
  });

  it("cancels a pending show when the pointer leaves before the delay", () => {
    const { controller, onShow } = setup();
    controller.enterRow("thr_a");
    controller.leaveRows();
    vi.advanceTimersByTime(500);
    expect(onShow).not.toHaveBeenCalled();
    expect(controller.phase()).toEqual({ kind: "hidden" });
    vi.useRealTimers();
  });

  it("swaps to another row without hiding while shown or closing", () => {
    const { controller, onShow, onHide } = setup();
    controller.enterRow("thr_a");
    vi.advanceTimersByTime(150);
    controller.enterRow("thr_b");
    expect(onShow).toHaveBeenLastCalledWith("thr_b");
    expect(onHide).not.toHaveBeenCalled();
    controller.leaveRows();
    vi.advanceTimersByTime(50);
    controller.enterRow("thr_c");
    expect(onShow).toHaveBeenLastCalledWith("thr_c");
    expect(controller.phase()).toEqual({ kind: "shown", threadId: "thr_c" });
    vi.advanceTimersByTime(500);
    expect(onHide).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("re-entering the same shown row is a no-op", () => {
    const { controller, onShow } = setup();
    controller.enterRow("thr_a");
    vi.advanceTimersByTime(150);
    controller.enterRow("thr_a");
    expect(onShow).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("follows the latest row while still pending", () => {
    const { controller, onShow } = setup();
    controller.enterRow("thr_a");
    vi.advanceTimersByTime(100);
    controller.enterRow("thr_b");
    vi.advanceTimersByTime(50);
    expect(onShow).toHaveBeenCalledTimes(1);
    expect(onShow).toHaveBeenCalledWith("thr_b");
    vi.useRealTimers();
  });

  it("hideNow hides immediately only when something was visible", () => {
    const { controller, onShow, onHide } = setup();
    controller.enterRow("thr_a");
    controller.hideNow();
    expect(onHide).not.toHaveBeenCalled();
    vi.advanceTimersByTime(500);
    expect(onShow).not.toHaveBeenCalled();
    controller.enterRow("thr_a");
    vi.advanceTimersByTime(150);
    controller.hideNow();
    expect(onHide).toHaveBeenCalledTimes(1);
    expect(controller.phase()).toEqual({ kind: "hidden" });
    vi.useRealTimers();
  });
});
