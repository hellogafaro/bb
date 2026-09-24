import type { Extension } from "@codemirror/state";
import type { StreamParser } from "@codemirror/language";
import { languageIdForPath } from "./file-paths";

type LanguageLoader = () => Promise<Extension>;

async function stream<T>(parser: Promise<StreamParser<T>>): Promise<Extension> {
  const [{ StreamLanguage }, resolved] = await Promise.all([
    import("@codemirror/language"),
    parser,
  ]);
  return StreamLanguage.define(resolved);
}

const javascript = (options?: { jsx?: boolean; typescript?: boolean }) =>
  import("@codemirror/lang-javascript").then((module) =>
    module.javascript(options),
  );
const json = () =>
  import("@codemirror/lang-json").then((module) => module.json());
const markdown = () =>
  import("@codemirror/lang-markdown").then((module) => module.markdown());
const clike = () => import("@codemirror/legacy-modes/mode/clike");
const css = () => import("@codemirror/legacy-modes/mode/css");
const shell = () =>
  stream(import("@codemirror/legacy-modes/mode/shell").then((m) => m.shell));
const html = () =>
  stream(import("@codemirror/legacy-modes/mode/xml").then((m) => m.html));
const xml = () =>
  stream(import("@codemirror/legacy-modes/mode/xml").then((m) => m.xml));
const properties = () =>
  stream(
    import("@codemirror/legacy-modes/mode/properties").then(
      (m) => m.properties,
    ),
  );
const clojure = () =>
  stream(
    import("@codemirror/legacy-modes/mode/clojure").then((m) => m.clojure),
  );
const erlang = () =>
  stream(import("@codemirror/legacy-modes/mode/erlang").then((m) => m.erlang));
const perl = () =>
  stream(import("@codemirror/legacy-modes/mode/perl").then((m) => m.perl));
const python = () =>
  stream(import("@codemirror/legacy-modes/mode/python").then((m) => m.python));
const stex = () =>
  stream(import("@codemirror/legacy-modes/mode/stex").then((m) => m.stex));
const yaml = () =>
  stream(import("@codemirror/legacy-modes/mode/yaml").then((m) => m.yaml));
const oCaml = () =>
  stream(import("@codemirror/legacy-modes/mode/mllike").then((m) => m.oCaml));

const LOADERS: Readonly<Record<string, LanguageLoader>> = {
  astro: html,
  bash: shell,
  bib: stex,
  c: () => stream(clike().then((m) => m.c)),
  cc: () => stream(clike().then((m) => m.cpp)),
  cfg: properties,
  cjs: () => javascript(),
  clj: clojure,
  cljs: clojure,
  cmake: () =>
    stream(import("@codemirror/legacy-modes/mode/cmake").then((m) => m.cmake)),
  conf: properties,
  cpp: () => stream(clike().then((m) => m.cpp)),
  cs: () => stream(clike().then((m) => m.csharp)),
  css: () => stream(css().then((m) => m.css)),
  cts: () => javascript({ typescript: true }),
  cxx: () => stream(clike().then((m) => m.cpp)),
  dart: () => stream(clike().then((m) => m.dart)),
  diff: () =>
    stream(import("@codemirror/legacy-modes/mode/diff").then((m) => m.diff)),
  dockerfile: () =>
    stream(
      import("@codemirror/legacy-modes/mode/dockerfile").then(
        (m) => m.dockerFile,
      ),
    ),
  edn: clojure,
  erl: erlang,
  go: () =>
    stream(import("@codemirror/legacy-modes/mode/go").then((m) => m.go)),
  h: () => stream(clike().then((m) => m.c)),
  hpp: () => stream(clike().then((m) => m.cpp)),
  hrl: erlang,
  hs: () =>
    stream(
      import("@codemirror/legacy-modes/mode/haskell").then((m) => m.haskell),
    ),
  htm: html,
  html,
  ini: properties,
  java: () => stream(clike().then((m) => m.java)),
  js: () => javascript(),
  json,
  jsonc: json,
  jsx: () => javascript({ jsx: true }),
  kt: () => stream(clike().then((m) => m.kotlin)),
  kts: () => stream(clike().then((m) => m.kotlin)),
  less: () => stream(css().then((m) => m.less)),
  lua: () =>
    stream(import("@codemirror/legacy-modes/mode/lua").then((m) => m.lua)),
  m: () => stream(clike().then((m) => m.objectiveC)),
  makefile: shell,
  markdown,
  md: markdown,
  mdx: markdown,
  mjs: () => javascript(),
  mk: shell,
  ml: oCaml,
  mli: oCaml,
  mm: () => stream(clike().then((m) => m.objectiveCpp)),
  mts: () => javascript({ typescript: true }),
  php: html,
  pl: perl,
  pm: perl,
  properties,
  proto: () =>
    stream(
      import("@codemirror/legacy-modes/mode/protobuf").then((m) => m.protobuf),
    ),
  py: python,
  pyi: python,
  rb: () =>
    stream(import("@codemirror/legacy-modes/mode/ruby").then((m) => m.ruby)),
  rs: () =>
    stream(import("@codemirror/legacy-modes/mode/rust").then((m) => m.rust)),
  scss: () => stream(css().then((m) => m.sCSS)),
  sh: shell,
  sql: () =>
    stream(
      import("@codemirror/legacy-modes/mode/sql").then((m) => m.standardSQL),
    ),
  svelte: html,
  svg: xml,
  swift: () =>
    stream(import("@codemirror/legacy-modes/mode/swift").then((m) => m.swift)),
  tex: stex,
  toml: () =>
    stream(import("@codemirror/legacy-modes/mode/toml").then((m) => m.toml)),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  vue: html,
  xml,
  yaml,
  yml: yaml,
  zsh: shell,
};

const cache = new Map<string, Promise<Extension[]>>();

export function loadLanguageForPath(path: string): Promise<Extension[]> {
  const id = languageIdForPath(path);
  if (id === null) return Promise.resolve([]);
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const loader = LOADERS[id];
  const loaded =
    loader === undefined
      ? Promise.resolve([])
      : loader().then(
          (extension) => [extension],
          () => {
            cache.delete(id);
            return [];
          },
        );
  cache.set(id, loaded);
  return loaded;
}
