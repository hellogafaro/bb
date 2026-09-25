// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectColorDot } from "./ProjectColorDot";

afterEach(cleanup);

describe("ProjectColorDot", () => {
  it("fills a rounded dot with the project's label color variable", () => {
    const { container } = render(
      <ProjectColorDot color={17} className="size-4" />,
    );
    const box = container.querySelector("[data-project-color-dot]");
    expect(box?.getAttribute("data-project-color-dot")).toBe("17");
    expect(box?.getAttribute("aria-hidden")).toBe("true");
    expect(box?.classList.contains("size-4")).toBe(true);
    const dot = box?.firstElementChild;
    expect(dot instanceof HTMLElement ? dot.style.backgroundColor : null).toBe(
      "var(--label-color-17)",
    );
    expect(dot?.classList.contains("rounded-full")).toBe(true);
  });
});
