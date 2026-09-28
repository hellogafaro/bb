// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
});

const message = {
  id: "msg_1",
  threadId: "thr_1",
  turnId: "turn_1",
  projectId: "proj_1",
};

function directive(id: "canvas" | "inline-vis") {
  const found = app.messageDirectives.find((entry) => entry.id === id);
  if (!found) throw new Error(`no messageDirective registered for ${id}`);
  return found;
}

describe("canvas messageDirective registration", () => {
  it("registers the canvas directive and the deprecated inline-vis alias on the same component", () => {
    expect(app.messageDirectives).toHaveLength(2);
    const canvas = directive("canvas");
    const alias = directive("inline-vis");
    expect(canvas.component).toBe(alias.component);
  });
});

describe("CanvasDirective", () => {
  it("requires a file attribute without calling rpc", async () => {
    const slot = renderSlot(
      directive("canvas"),
      {
        attributes: {},
        source: "::canvas{}",
        message,
        openWorkspaceFile: null,
      },
      { rpc: {} },
    );

    await slot.findByRole("alert");
    expect(slot.getByText(/requires a file attribute/i)).toBeTruthy();
    expect(slot.rpcCalls).toEqual([]);
  });

  it("shows the rpc validation error for an unknown source", async () => {
    const slot = renderSlot(
      directive("canvas"),
      {
        attributes: { file: "demo.html", source: "project" },
        source: '::canvas{source="project" file="demo.html"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: (input) => {
            expect(input).toEqual({
              threadId: "thr_1",
              file: "demo.html",
              source: "project",
            });
            throw new Error(
              'Invalid option: expected "workspace"|"thread-storage"',
            );
          },
        },
      },
    );

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(
      /expected "workspace"\|"thread-storage"/i,
    );
    expect(slot.container.querySelector("iframe")).toBeNull();
    expect(slot.rpcCalls).toEqual([
      {
        method: "preparePreview",
        input: {
          threadId: "thr_1",
          file: "demo.html",
          source: "project",
        },
      },
    ]);
  });

  it("shows an error when rpc fails, e.g. a missing file", async () => {
    const slot = renderSlot(
      directive("canvas"),
      {
        attributes: { file: "missing.html" },
        source: '::canvas{file="missing.html"}',
        message,
        openWorkspaceFile: null,
      },
      {
        rpc: {
          preparePreview: () => {
            throw new Error("Preview file not found: missing.html");
          },
        },
      },
    );

    const alert = await slot.findByRole("alert");
    expect(alert.textContent).toMatch(/Preview file not found: missing\.html/);
    expect(slot.container.querySelector("iframe")).toBeNull();
  });

  describe("display defaults per file type", () => {
    it("defaults HTML to card mode: header only, no iframe, Open action present", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "charts/demo file.html" },
          source: '::canvas{file="charts/demo file.html"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "charts/demo file.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "charts/demo file.html",
              },
            }),
          },
        },
      );

      await slot.findByTestId("canvas-header");
      await waitFor(() => {
        expect(slot.getByRole("button", { name: "Open" })).toBeTruthy();
      });
      expect(slot.container.querySelector("iframe")).toBeNull();
      expect(
        slot.queryByRole("button", { name: /collapse canvas/i }),
      ).toBeNull();
    });

    it("opens the sidebar target when the card header is clicked", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "charts/demo file.html" },
          source: '::canvas{file="charts/demo file.html"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "charts/demo file.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "charts/demo file.html",
              },
            }),
          },
        },
      );

      const header = await slot.findByTestId("canvas-header");
      expect(header.getAttribute("role")).toBe("button");
      fireEvent.click(header);
      expect(slot.navigateCalls).toEqual([
        {
          method: "experimental_openFilePreview",
          options: {
            target: {
              kind: "workspace",
              environmentId: "env_1",
              path: "charts/demo file.html",
            },
            location: null,
          },
        },
      ]);
    });

    it("defaults Markdown to inline mode and renders through the host Markdown renderer", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "reports/notes.md" },
          source: '::canvas{file="reports/notes.md"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: (input) => {
              expect(input).toEqual({
                threadId: "thr_1",
                file: "reports/notes.md",
              });
              return {
                kind: "markdown",
                file: "reports/notes.md",
                source: "workspace",
                title: null,
                target: {
                  kind: "workspace",
                  environmentId: "env_1",
                  path: "reports/notes.md",
                },
                rootPath: "/work/repo",
                content: "Ready for review.",
              };
            },
          },
        },
      );

      const markdown = await slot.findByTestId("bb-markdown");
      expect(markdown.textContent).toBe("Ready for review.");
      expect(slot.container.querySelector("iframe")).toBeNull();
      expect(markdown.parentElement?.style.height).toBe("224px");
    });

    it("overrides the HTML default to inline with display=\"inline\"", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "charts/demo file.html", display: "inline" },
          source: '::canvas{file="charts/demo file.html" display="inline"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "charts/demo file.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "charts/demo file.html",
              },
            }),
          },
        },
      );

      const iframe = await waitFor(() => {
        const el = slot.container.querySelector("iframe");
        expect(el).toBeTruthy();
        return el as HTMLIFrameElement;
      });
      expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
      expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
      expect(iframe.getAttribute("src")).toBe(
        "/api/v1/threads/thr_1/worktree/files/charts/demo%20file.html",
      );
      expect(iframe.style.height).toBe("224px");
      expect(
        slot.getByRole("button", { name: /collapse canvas/i }),
      ).toBeTruthy();
    });

    it("overrides the Markdown default to card, hiding content", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "notes.md", display: "card" },
          source: '::canvas{file="notes.md" display="card"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "markdown",
              file: "notes.md",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "notes.md",
              },
              rootPath: "/work/repo",
              content: "# Notes",
            }),
          },
        },
      );

      await slot.findByTestId("canvas-header");
      expect(slot.queryByTestId("bb-markdown")).toBeNull();
    });
  });

  describe("height", () => {
    it("applies an optional bounded height only in inline mode", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: {
            file: "demo.html",
            display: "inline",
            height: "480",
          },
          source: '::canvas{file="demo.html" display="inline" height="480"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "demo.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "demo.html",
              },
            }),
          },
        },
      );

      const iframe = await waitFor(() => {
        const el = slot.container.querySelector("iframe");
        expect(el).toBeTruthy();
        return el as HTMLIFrameElement;
      });
      expect(iframe.style.height).toBe("480px");
    });

    it("rejects an invalid height in inline mode without calling rpc", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: {
            file: "demo.html",
            display: "inline",
            height: "100vh",
          },
          source: '::canvas{file="demo.html" display="inline" height="100vh"}',
          message,
          openWorkspaceFile: null,
        },
        { rpc: {} },
      );

      expect((await slot.findByRole("alert")).textContent).toMatch(
        /whole number from 120 to 1200 pixels/i,
      );
      expect(slot.container.querySelector("iframe")).toBeNull();
      expect(slot.rpcCalls).toEqual([]);
    });

    it("ignores an invalid height in card mode: no error, no rpc skip", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "demo.html", height: "100vh" },
          source: '::canvas{file="demo.html" height="100vh"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "demo.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "demo.html",
              },
            }),
          },
        },
      );

      await slot.findByTestId("canvas-header");
      expect(slot.queryByRole("alert")).toBeNull();
      expect(slot.rpcCalls).toHaveLength(1);
    });
  });

  describe("title fallback chain", () => {
    it("prefers the title attribute over the server title and filename", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "demo.html", title: "Explicit title" },
          source: '::canvas{file="demo.html" title="Explicit title"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "demo.html",
              source: "workspace",
              title: "Server title",
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "demo.html",
              },
            }),
          },
        },
      );

      const header = await slot.findByTestId("canvas-header");
      expect(header.textContent).toContain("Explicit title");
      expect(header.textContent).not.toContain("Server title");
    });

    it("falls back to the server-extracted title when no attribute is set", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "demo.html" },
          source: '::canvas{file="demo.html"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "demo.html",
              source: "workspace",
              title: "Klaviyo flows, week 38",
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "demo.html",
              },
            }),
          },
        },
      );

      const header = await slot.findByTestId("canvas-header");
      expect(header.textContent).toContain("Klaviyo flows, week 38");
    });

    it("falls back to the filename when neither attribute nor server title is set", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "demo.html" },
          source: '::canvas{file="demo.html"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "demo.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "demo.html",
              },
            }),
          },
        },
      );

      const header = await slot.findByTestId("canvas-header");
      expect(header.textContent).toContain("demo.html");
    });
  });

  describe("kind mapping", () => {
    it("maps a known kind to its label and icon", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "demo.html", kind: "report" },
          source: '::canvas{file="demo.html" kind="report"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "demo.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "demo.html",
              },
            }),
          },
        },
      );

      const header = await slot.findByTestId("canvas-header");
      expect(header.textContent).toContain("Report");
      expect(
        slot.container.querySelector('[data-icon="FileText"]'),
      ).toBeTruthy();
    });

    it("shows the neutral Canvas label and icon for an unknown kind", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "demo.html", kind: "spreadsheet" },
          source: '::canvas{file="demo.html" kind="spreadsheet"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "demo.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "demo.html",
              },
            }),
          },
        },
      );

      const header = await slot.findByTestId("canvas-header");
      expect(header.textContent).toContain("Canvas");
      expect(
        slot.container.querySelector('[data-icon="AppWindow"]'),
      ).toBeTruthy();
    });

    it("shows the neutral Canvas label and icon when kind is omitted", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: { file: "demo.html" },
          source: '::canvas{file="demo.html"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "demo.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "demo.html",
              },
            }),
          },
        },
      );

      const header = await slot.findByTestId("canvas-header");
      expect(header.textContent).toContain("Canvas");
    });
  });

  describe("collapse", () => {
    it("collapses and expands per item without persisting across a fresh render", async () => {
      const options = {
        rpc: {
          preparePreview: () => ({
            kind: "html" as const,
            file: "demo.html",
            source: "workspace" as const,
            title: null,
            target: {
              kind: "workspace" as const,
              environmentId: "env_1",
              path: "demo.html",
            },
          }),
        },
      };
      const props = {
        attributes: { file: "demo.html", display: "inline" },
        source: '::canvas{file="demo.html" display="inline"}',
        message,
        openWorkspaceFile: null,
      };
      const first = renderSlot(directive("canvas"), props, options);

      await waitFor(() => {
        expect(first.container.querySelector("iframe")).toBeTruthy();
      });
      const collapse = first.getByRole("button", { name: /collapse canvas/i });
      fireEvent.click(collapse);
      expect(first.container.querySelector("iframe")).toBeNull();
      expect(window.localStorage.getItem("bb.inline-vis.collapsed")).toBeNull();
      first.unmount();

      const second = renderSlot(directive("canvas"), props, options);
      await waitFor(() => {
        expect(second.container.querySelector("iframe")).toBeTruthy();
      });
    });
  });

  describe("thread-storage source", () => {
    it("opens a thread-storage preview through its thread-storage target", async () => {
      const slot = renderSlot(
        directive("canvas"),
        {
          attributes: {
            source: "thread-storage",
            file: "reports/result file.html",
          },
          source:
            '::canvas{source="thread-storage" file="reports/result file.html"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: (input) => {
              expect(input).toEqual({
                threadId: "thr_1",
                file: "reports/result file.html",
                source: "thread-storage",
              });
              return {
                kind: "html",
                file: "reports/result file.html",
                source: "thread-storage",
                title: null,
                target: {
                  kind: "thread-storage",
                  threadId: "thr_1",
                  path: "reports/result file.html",
                },
              };
            },
          },
        },
      );

      const header = await slot.findByTestId("canvas-header");
      fireEvent.click(header);
      expect(slot.navigateCalls).toEqual([
        {
          method: "experimental_openFilePreview",
          options: {
            target: {
              kind: "thread-storage",
              threadId: "thr_1",
              path: "reports/result file.html",
            },
            location: null,
          },
        },
      ]);
    });
  });

  describe("deprecated inline-vis alias", () => {
    it("renders an old ::inline-vis message the same way as ::canvas", async () => {
      const slot = renderSlot(
        directive("inline-vis"),
        {
          attributes: { file: "demo.html" },
          source: '::inline-vis{file="demo.html"}',
          message,
          openWorkspaceFile: null,
        },
        {
          rpc: {
            preparePreview: () => ({
              kind: "html",
              file: "demo.html",
              source: "workspace",
              title: null,
              target: {
                kind: "workspace",
                environmentId: "env_1",
                path: "demo.html",
              },
            }),
          },
        },
      );

      const header = await slot.findByTestId("canvas-header");
      expect(header.textContent).toContain("demo.html");
      fireEvent.click(header);
      expect(slot.navigateCalls).toEqual([
        {
          method: "experimental_openFilePreview",
          options: {
            target: {
              kind: "workspace",
              environmentId: "env_1",
              path: "demo.html",
            },
            location: null,
          },
        },
      ]);
    });
  });
});
