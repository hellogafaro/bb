import { describe, expect, it } from "vitest";
import {
  defaultFolderToOpen,
  fileIconToken,
  isImagePath,
  isInsideRoot,
  isMarkdownPath,
  joinRoot,
  languageIdForPath,
  toRelative,
} from "./file-paths";
import { opensInEditor } from "./editor-routing";

describe("file paths", () => {
  it("joins relative paths without leaving the root", () => {
    expect(joinRoot("/repo", "")).toBe("/repo");
    expect(joinRoot("/repo/", "src/app.ts")).toBe("/repo/src/app.ts");
    expect(joinRoot("/", "etc/hosts")).toBe("/etc/hosts");
    expect(() => joinRoot("/repo", "../secret")).toThrow();
    expect(() => joinRoot("/repo", "/etc/passwd")).toThrow();
    expect(() => joinRoot("/repo", "src/../etc")).toThrow();
    expect(() => joinRoot("/repo", "src//a.ts")).toThrow();
  });

  it("agrees on containment and relative paths", () => {
    expect(isInsideRoot("/repo", "/repo")).toBe(true);
    expect(isInsideRoot("/repo", "/repo/src")).toBe(true);
    expect(isInsideRoot("/repo", "/repo-other")).toBe(false);
    expect(toRelative("/repo", "/repo")).toBe("");
    expect(toRelative("/repo", "/repo/src/a.ts")).toBe("src/a.ts");
    expect(toRelative("/", "/etc/hosts")).toBe("etc/hosts");
    expect(() => toRelative("/repo", "/elsewhere")).toThrow();
  });

  it("opens the only root folder by default", () => {
    expect(
      defaultFolderToOpen([{ kind: "directory", relativePath: "app" }]),
    ).toBe("app");
    expect(
      defaultFolderToOpen([
        { kind: "directory", relativePath: "a" },
        { kind: "directory", relativePath: "b" },
      ]),
    ).toBeNull();
    expect(
      defaultFolderToOpen([{ kind: "file", relativePath: "README.md" }]),
    ).toBeNull();
  });

  it("classifies files for the editor", () => {
    expect(isImagePath("shot.png")).toBe(true);
    expect(isImagePath("app.ts")).toBe(false);
    expect(isMarkdownPath("README.md")).toBe(true);
    expect(isMarkdownPath("docs/guide.markdown")).toBe(true);
    expect(isMarkdownPath("page.mdx")).toBe(false);
    expect(opensInEditor("src/app.ts")).toBe(true);
    expect(opensInEditor("Makefile")).toBe(true);
    expect(opensInEditor(".gitignore")).toBe(true);
    expect(opensInEditor("report.pdf")).toBe(false);
    expect(opensInEditor("clip.mp4")).toBe(false);
  });

  it("maps icons and languages from names and extensions", () => {
    expect(fileIconToken("README.md")).toBe("markdown");
    expect(fileIconToken("src/app.ts")).toBe("typescript");
    expect(fileIconToken(".gitignore")).toBe("git");
    expect(fileIconToken("Dockerfile")).toBe("docker");
    expect(fileIconToken("unknown.bin")).toBe("default");
    expect(languageIdForPath("src/app.tsx")).toBe("tsx");
    expect(languageIdForPath("Dockerfile")).toBe("dockerfile");
    expect(languageIdForPath("notes.txt")).toBeNull();
  });
});
