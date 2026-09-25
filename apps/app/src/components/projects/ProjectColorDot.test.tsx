// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { StatusRing } from "@bb/shared-ui/status-ring";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectColorDot } from "./ProjectColorDot";

afterEach(cleanup);

function ringGeometry(root: Element | null) {
  const svg = root?.querySelector("svg");
  const circle = svg?.querySelector("circle");
  return {
    svgClass: svg?.getAttribute("class"),
    viewBox: svg?.getAttribute("viewBox"),
    r: circle?.getAttribute("r"),
    strokeWidth: circle?.getAttribute("stroke-width"),
    fill: circle?.getAttribute("fill"),
  };
}

describe("ProjectColorDot", () => {
  it("draws a hollow ring in the project's label color", () => {
    const { container } = render(
      <ProjectColorDot color={17} className="size-4" />,
    );
    const box = container.querySelector("[data-project-color-dot]");
    expect(box?.getAttribute("data-project-color-dot")).toBe("17");
    expect(box?.getAttribute("aria-hidden")).toBe("true");
    expect(box?.classList.contains("size-4")).toBe(true);
    expect(box instanceof HTMLElement ? box.style.color : null).toBe(
      "var(--label-color-17)",
    );
    expect(ringGeometry(box).fill).toBe("none");
  });

  it("matches the sidebar status ring's size and stroke", () => {
    const dot = render(<ProjectColorDot color={3} />).container;
    const ring = render(<StatusRing tone="ready" />).container;
    expect(ringGeometry(dot.querySelector("[data-project-color-dot]"))).toEqual(
      ringGeometry(ring.querySelector("[data-status-ring]")),
    );
  });

  it("uses the neutral gray ring without a project color", () => {
    const { container } = render(<ProjectColorDot color={null} />);
    const box = container.querySelector("[data-project-color-dot]");
    expect(box?.getAttribute("data-project-color-dot")).toBe("neutral");
    expect(box instanceof HTMLElement ? box.style.color : null).toBe(
      "var(--label-color-neutral)",
    );
  });
});
