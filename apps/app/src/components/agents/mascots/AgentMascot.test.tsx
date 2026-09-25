// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentMascot } from "./AgentMascot";
import { mascotSprite } from "./mascot-sprites";

afterEach(cleanup);

function svgOf(container: HTMLElement): SVGSVGElement {
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("no mascot svg");
  return svg;
}

describe("AgentMascot", () => {
  it("renders the rest frame in the agent's palette color", () => {
    const { container } = render(<AgentMascot mascot="frog" color={4} />);
    const svg = svgOf(container);
    const paths = svg.querySelectorAll("path");
    expect(paths).toHaveLength(1);
    expect(paths[0]?.getAttribute("d")).toBe(mascotSprite("frog").restPath);
    expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.style.color).toBe("var(--agent-color-4)");
    expect(svg.classList.contains("mascot-active")).toBe(false);
  });

  it("stacks rest and talk frames and hops while active", () => {
    const { container } = render(
      <AgentMascot mascot="ghost" color={0} active className="size-4" />,
    );
    const svg = svgOf(container);
    expect(svg.classList.contains("mascot-active")).toBe(true);
    expect(svg.classList.contains("size-4")).toBe(true);
    expect(svg.style.color).toBe("var(--agent-color-0)");
    const rest = svg.querySelector("path.mascot-rest");
    const talk = svg.querySelector("path.mascot-talk");
    expect(rest?.getAttribute("d")).toBe(mascotSprite("ghost").restPath);
    expect(talk?.getAttribute("d")).toBe(mascotSprite("ghost").talkPath);
  });
});
