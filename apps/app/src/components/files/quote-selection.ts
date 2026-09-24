export function formatLineRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}-${end}`;
}

export function quotePathLines(
  path: string,
  start: number,
  end: number,
  body: string,
): string | null {
  const text = body.trimEnd();
  if (text.trim().length === 0) return null;
  return `${path}:${formatLineRange(start, end)}\n${text}`;
}

export function quoteSelectedText(
  path: string,
  contents: string,
  snippet: string,
): string | null {
  const body = snippet.trimEnd();
  if (body.trim().length === 0) return null;
  const exact = contents.indexOf(body);
  const needle = exact === -1 ? body.trim() : body;
  const from = exact === -1 ? contents.indexOf(needle) : exact;
  if (from === -1) return `${path}\n${body}`;
  const lines = lineRangeForOffsets(contents, from, from + needle.length);
  if (lines === null) return `${path}\n${body}`;
  return buildLineSelectionText({
    contents,
    path,
    start: lines.start,
    end: lines.end,
  });
}

export function buildLineSelectionText({
  contents,
  path,
  start,
  end,
}: {
  contents: string;
  path: string;
  start: number;
  end: number;
}): string | null {
  const startLine = Math.max(1, Math.min(start, end));
  const endLine = Math.max(startLine, Math.max(start, end));
  const selected = contents.split(/\r\n|\n|\r/).slice(startLine - 1, endLine);
  if (selected.length === 0) return null;
  return quotePathLines(path, startLine, endLine, selected.join("\n"));
}

export function lineRangeForOffsets(
  contents: string,
  from: number,
  to: number,
): { start: number; end: number } | null {
  const startPos = Math.min(from, to);
  const endPos = Math.max(from, to);
  if (endPos <= startPos) return null;
  const start = lineNumberAt(contents, startPos);
  const end = lineNumberAt(contents, endPos);
  if (endPos === lineStartAt(contents, end)) {
    return { start, end: Math.max(start, end - 1) };
  }
  return { start, end };
}

export function lineRangeForDoc(
  doc: { lineAt(pos: number): { number: number; from: number } },
  from: number,
  to: number,
): { start: number; end: number } | null {
  const startPos = Math.min(from, to);
  const endPos = Math.max(from, to);
  if (endPos <= startPos) return null;
  const start = doc.lineAt(startPos).number;
  const endLine = doc.lineAt(endPos);
  if (endPos === endLine.from) {
    return { start, end: Math.max(start, endLine.number - 1) };
  }
  return { start, end: endLine.number };
}

function lineNumberAt(contents: string, offset: number): number {
  let line = 1;
  const end = Math.min(Math.max(offset, 0), contents.length);
  for (let index = 0; index < end; index += 1) {
    const code = contents.charCodeAt(index);
    if (code === 10) {
      line += 1;
    } else if (code === 13) {
      line += 1;
      if (contents.charCodeAt(index + 1) === 10) index += 1;
    }
  }
  return line;
}

function lineStartAt(contents: string, line: number): number {
  if (line <= 1) return 0;
  let current = 1;
  for (let index = 0; index < contents.length; index += 1) {
    const code = contents.charCodeAt(index);
    if (code === 10) {
      current += 1;
      if (current === line) return index + 1;
    } else if (code === 13) {
      const next = contents.charCodeAt(index + 1) === 10 ? index + 1 : index;
      current += 1;
      if (current === line) return next + 1;
      index = next;
    }
  }
  return contents.length;
}
