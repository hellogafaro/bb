import { fileExt, fileName, HIGHLIGHT_EXT } from "./editor-routing";

export { fileName, isImagePath } from "./editor-routing";

export interface FileEntry {
  name: string;
  kind: "directory" | "file";
  relativePath: string;
}

function normalizeRoot(root: string): string {
  if (root === "/") return root;
  return root.replace(/\/+$/u, "");
}

export function joinRoot(root: string, relative: string): string {
  const base = normalizeRoot(root);
  if (relative === "" || relative === ".") return base;
  if (relative.startsWith("/") || relative.startsWith("~")) {
    throw new Error("Path is outside the workspace root.");
  }
  const segments = relative.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error("Path is outside the workspace root.");
  }
  return base === "/" ? `/${relative}` : `${base}/${relative}`;
}

export function isInsideRoot(root: string, candidate: string): boolean {
  const base = normalizeRoot(root);
  if (base === "/") return candidate.startsWith("/");
  return candidate === base || candidate.startsWith(`${base}/`);
}

export function toRelative(root: string, absolute: string): string {
  const base = normalizeRoot(root);
  if (absolute === base) return "";
  const prefix = base === "/" ? "/" : `${base}/`;
  if (absolute.startsWith(prefix)) return absolute.slice(prefix.length);
  throw new Error("Path is outside the workspace root.");
}

export function defaultFolderToOpen(
  entries: readonly Pick<FileEntry, "kind" | "relativePath">[],
): string | null {
  const [entry] = entries;
  if (
    entries.length !== 1 ||
    entry === undefined ||
    entry.kind !== "directory"
  ) {
    return null;
  }
  return entry.relativePath;
}

export function isMarkdownPath(path: string): boolean {
  const ext = fileExt(path);
  return ext === "md" || ext === "markdown";
}

export function languageIdForPath(path: string): string | null {
  const name = fileName(path).toLowerCase();
  if (name === "dockerfile" || name.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  if (name === "makefile") return "makefile";
  if (name === "cmakelists.txt") return "cmake";
  const ext = fileExt(path);
  return HIGHLIGHT_EXT.has(ext) ? ext : null;
}

const BY_NAME: Readonly<Record<string, string>> = {
  ".babelrc": "javascript",
  ".bash_profile": "bash",
  ".bashrc": "bash",
  ".dockerignore": "docker",
  ".env": "text",
  ".eslintignore": "eslint",
  ".eslintrc": "eslint",
  ".eslintrc.cjs": "eslint",
  ".eslintrc.js": "eslint",
  ".eslintrc.json": "eslint",
  ".eslintrc.yaml": "eslint",
  ".eslintrc.yml": "eslint",
  ".gitattributes": "git",
  ".gitignore": "git",
  ".gitkeep": "git",
  ".gitmodules": "git",
  ".prettierignore": "prettier",
  ".prettierrc": "prettier",
  ".prettierrc.cjs": "prettier",
  ".prettierrc.js": "prettier",
  ".prettierrc.json": "prettier",
  ".prettierrc.mjs": "prettier",
  ".prettierrc.toml": "prettier",
  ".prettierrc.yaml": "prettier",
  ".prettierrc.yml": "prettier",
  ".zprofile": "bash",
  ".zshenv": "bash",
  ".zshrc": "bash",
  "biome.json": "json",
  "bun.lock": "json",
  "claude.md": "markdown",
  "compose.yaml": "docker",
  "compose.yml": "docker",
  "docker-compose.override.yml": "docker",
  "docker-compose.yaml": "docker",
  "docker-compose.yml": "docker",
  dockerfile: "docker",
  "eslint.config.cjs": "eslint",
  "eslint.config.js": "eslint",
  "eslint.config.mjs": "eslint",
  "eslint.config.ts": "eslint",
  gemfile: "ruby",
  "package.json": "json",
  "package-lock.json": "json",
  "pnpm-lock.yaml": "yml",
  "prettier.config.cjs": "prettier",
  "prettier.config.js": "prettier",
  "prettier.config.mjs": "prettier",
  "readme.md": "markdown",
  "tsconfig.json": "json",
};

const BY_EXT: Readonly<Record<string, string>> = {
  astro: "javascript",
  bash: "bash",
  cjs: "javascript",
  css: "css",
  csv: "text",
  cts: "typescript",
  env: "text",
  gif: "image",
  go: "go",
  htm: "html",
  html: "html",
  ico: "image",
  jpeg: "image",
  jpg: "image",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  less: "css",
  markdown: "markdown",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  png: "image",
  py: "python",
  pyi: "python",
  rb: "ruby",
  rs: "rust",
  scss: "css",
  sh: "bash",
  sql: "text",
  svg: "image",
  toml: "text",
  ts: "typescript",
  tsx: "typescript",
  txt: "text",
  webp: "image",
  yaml: "yml",
  yml: "yml",
  zsh: "bash",
};

export function fileIconToken(path: string): string {
  const lower = fileName(path).toLowerCase();
  const named = BY_NAME[lower];
  if (named !== undefined) return named;
  const dot = lower.lastIndexOf(".");
  const ext = dot <= 0 ? lower.replace(/^\./u, "") : lower.slice(dot + 1);
  return BY_EXT[ext] ?? "default";
}
