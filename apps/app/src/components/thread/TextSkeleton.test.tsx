// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TextSkeleton } from "@bb/shared-ui/skeleton";

afterEach(cleanup);

it("retains text geometry and DOM across pending and resolved titles", () => {
  const { rerender } = render(
    <TextSkeleton loading={false} label="Generating title">
      Original title
    </TextSkeleton>,
  );
  const text = screen.getByText("Original title");
  const container = text.parentElement;
  rerender(
    <TextSkeleton loading label="Generating title">
      Original title
    </TextSkeleton>,
  );
  expect(screen.getByText("Original title")).toBe(text);
  expect(text.classList.contains("invisible")).toBe(true);
  expect(text.getAttribute("aria-hidden")).toBe("true");
  expect(screen.getByRole("status", { name: "Generating title" })).toBe(
    container,
  );
  expect(container?.lastElementChild?.classList.contains("absolute")).toBe(
    true,
  );
  rerender(
    <TextSkeleton loading={false} label="Generating title">
      New title
    </TextSkeleton>,
  );
  expect(screen.getByText("New title")).toBe(text);
  expect(text.classList.contains("invisible")).toBe(false);
  expect(text.getAttribute("aria-hidden")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
