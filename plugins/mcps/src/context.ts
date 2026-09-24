import type { ConnectedSource } from "./store.js";

export const INSTRUCTIONS_MAX_CHARS = 4096;
export const GUIDE_MAX_CHARS = 600;
const DESCRIPTION_MAX_CHARS = 160;
const TRAILER = "Use mcp_search to find tools on connected MCPs, then mcp_call.";

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

function entry(source: ConnectedSource): string {
  const description = source.description?.replace(/\s+/g, " ").trim();
  const attributes = `handle="${escapeAttribute(source.handle)}"${description ? ` description="${escapeAttribute(clip(description, DESCRIPTION_MAX_CHARS))}"` : ""}`;
  const guide = source.guide?.trim();
  const lines = guide ? clip(guide, GUIDE_MAX_CHARS).split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean) : [];
  if (lines.length === 0) return `  <mcp ${attributes} />`;
  return [`  <mcp ${attributes}>`, ...lines.map((line) => `    ${escapeText(line)}`), "  </mcp>"].join("\n");
}

export function threadServerSelection(metadata: { readonly [key: string]: unknown }): string[] | null {
  const servers = metadata.servers;
  if (!Array.isArray(servers)) return null;
  return servers.filter((item): item is string => typeof item === "string");
}

export function connectedInstructions(sources: readonly ConnectedSource[], selection: readonly string[] | null): string | undefined {
  const wanted = selection === null ? null : new Set(selection);
  const listed = wanted === null ? sources : sources.filter((source) => wanted.has(source.id) || wanted.has(source.handle));
  if (listed.length === 0) return undefined;
  const entries = listed.map(entry);
  const render = (count: number) => [
    "<connected_mcps>",
    ...entries.slice(0, count),
    ...(count < listed.length ? [`  <more count="${listed.length - count}" />`] : []),
    "</connected_mcps>",
    TRAILER,
  ].join("\n");
  let text = render(0);
  for (let count = 1; count <= listed.length; count += 1) {
    const next = render(count);
    if (next.length > INSTRUCTIONS_MAX_CHARS) break;
    text = next;
  }
  return text;
}
