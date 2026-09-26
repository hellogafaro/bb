const REDACTED = "[redacted]";

export function redactSecretValues(
  text: string,
  names: readonly string[],
): string {
  if (names.length === 0 || text.length === 0) return text;
  return text
    .split("\n")
    .map((line) => {
      if (!names.some((name) => line.includes(name))) return line;
      const separator = line.indexOf("=");
      if (separator === -1) return line;
      return `${line.slice(0, separator + 1)}${REDACTED}`;
    })
    .join("\n");
}
