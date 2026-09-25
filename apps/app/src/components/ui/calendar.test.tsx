// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { compile } from "tailwindcss";
import { Calendar } from "@bb/shared-ui/calendar";

afterEach(cleanup);

async function stylesFor(element: Element | null): Promise<string> {
  if (!element) throw new Error("Calendar element not found");
  const compiler = await compile("@tailwind utilities;");
  return compiler.build([...element.classList]);
}

describe("shared calendar layout utilities", () => {
  it("compiles usable cell sizing and reserves caption space for navigation", async () => {
    const { container } = render(
      <Calendar
        mode="single"
        month={new Date(2026, 8, 1)}
        captionLayout="dropdown"
      />,
    );

    const day = await stylesFor(container.querySelector(".rdp-day_button"));
    expect(day).toContain("height: var(--cell-size)");
    expect(day).toContain("min-width: var(--cell-size)");
    expect(day).not.toMatch(/:\s*--cell-size/);

    for (const selector of [".rdp-button_previous", ".rdp-button_next"]) {
      const navigation = await stylesFor(container.querySelector(selector));
      expect(navigation).toContain("height: var(--cell-size)");
      expect(navigation).toContain("width: var(--cell-size)");
    }

    const caption = await stylesFor(
      container.querySelector(".rdp-month_caption"),
    );
    expect(caption).toContain("height: var(--cell-size)");
    expect(caption).toContain("padding-inline: var(--cell-size)");

    const weekday = await stylesFor(container.querySelector(".rdp-weekday"));
    expect(weekday).toContain("width: var(--cell-size)");
  });
});
