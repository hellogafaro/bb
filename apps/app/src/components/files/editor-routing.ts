export function fileName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

export function fileExt(path: string): string {
  const name = fileName(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "";
  return name.slice(dot + 1);
}

const IMAGE_EXT: ReadonlySet<string> = new Set([
  "apng",
  "avif",
  "bmp",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "webp",
]);

export function isImagePath(path: string): boolean {
  return IMAGE_EXT.has(fileExt(path));
}

export const HIGHLIGHT_EXT: ReadonlySet<string> = new Set([
  "astro",
  "bash",
  "bib",
  "c",
  "cc",
  "cfg",
  "cjs",
  "clj",
  "cljs",
  "cmake",
  "conf",
  "cpp",
  "cs",
  "css",
  "cts",
  "cxx",
  "dart",
  "diff",
  "edn",
  "erl",
  "go",
  "h",
  "hpp",
  "hrl",
  "hs",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsonc",
  "jsx",
  "kt",
  "kts",
  "less",
  "lua",
  "m",
  "markdown",
  "md",
  "mdx",
  "mjs",
  "mk",
  "ml",
  "mli",
  "mm",
  "mts",
  "php",
  "pl",
  "pm",
  "properties",
  "proto",
  "py",
  "pyi",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "svg",
  "swift",
  "tex",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
]);

const EDITOR_EXTENSIONS: ReadonlySet<string> = new Set([
  ...HIGHLIGHT_EXT,
  ...IMAGE_EXT,
  "csv",
  "env",
  "ex",
  "exs",
  "gitattributes",
  "gitignore",
  "graphql",
  "ipynb",
  "lock",
  "log",
  "nix",
  "prisma",
  "rst",
  "tf",
  "tsv",
  "txt",
  "zig",
]);

export function opensInEditor(path: string): boolean {
  const ext = fileExt(path);
  if (ext === "") return true;
  return EDITOR_EXTENSIONS.has(ext);
}
