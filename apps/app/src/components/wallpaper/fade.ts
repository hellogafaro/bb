const FADE_MS = 240;
const snapshotSources = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

export function setSnapshotSource(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement | null,
): void {
  if (source) snapshotSources.set(canvas, source);
  else snapshotSources.delete(canvas);
}

export function snapshotWallpaper(
  canvas: HTMLCanvasElement,
): HTMLCanvasElement | null {
  if (
    !canvas.hasAttribute("data-ready") ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return null;
  }
  const source = snapshotSources.get(canvas) ?? canvas;
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d")?.drawImage(source, 0, 0);
  return copy;
}

export function drawFade(
  context: CanvasRenderingContext2D,
  from: HTMLCanvasElement,
  started: number,
  now = performance.now(),
): boolean {
  const remaining = 1 - (now - started) / FADE_MS;
  if (remaining <= 0) return false;
  context.globalAlpha = remaining * remaining * (3 - 2 * remaining);
  const scale = Math.max(
    context.canvas.width / from.width,
    context.canvas.height / from.height,
  );
  const width = from.width * scale;
  const height = from.height * scale;
  context.drawImage(
    from,
    (context.canvas.width - width) / 2,
    (context.canvas.height - height) / 2,
    width,
    height,
  );
  context.globalAlpha = 1;
  return true;
}

export const WALLPAPER_FADE_MS = FADE_MS;
