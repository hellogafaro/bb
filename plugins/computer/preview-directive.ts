export const PREVIEW_DIRECTIVE_ID = "computer-preview";

export function previewDirective(hostId: string): string {
  return `::${PREVIEW_DIRECTIVE_ID}{host="${hostId}"}`;
}
