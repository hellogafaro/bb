export function textChange(
  before: string,
  after: string,
): { from: number; to: number; insert: string } {
  let from = 0;
  const limit = Math.min(before.length, after.length);
  while (from < limit && before.charCodeAt(from) === after.charCodeAt(from)) {
    from++;
  }
  if (from > 0 && isHighSurrogate(before.charCodeAt(from - 1))) from--;
  let to = before.length;
  let end = after.length;
  while (
    to > from &&
    end > from &&
    before.charCodeAt(to - 1) === after.charCodeAt(end - 1)
  ) {
    to--;
    end--;
  }
  if (to < before.length && isLowSurrogate(before.charCodeAt(to))) {
    to++;
    end++;
  }
  return { from, to, insert: after.slice(from, end) };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}
