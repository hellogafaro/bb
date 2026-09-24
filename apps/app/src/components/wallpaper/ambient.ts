import { drawFade } from "./fade";

const DITHER_MATRIX = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const FIELD_WIDTH = 80;
const FIELD_HEIGHT = 60;
const FRAME_INTERVAL_MS = 50;

let ambientTime = 0;

export function animateAmbient(
  canvas: HTMLCanvasElement,
  base: readonly number[],
  dark: boolean,
  from: HTMLCanvasElement | null = null,
): () => void {
  const context = canvas.getContext("2d")!;
  const width = canvas.width;
  const height = canvas.height;
  const styles = getComputedStyle(canvas);
  context.fillStyle =
    styles.getPropertyValue("--primary").trim() || styles.color;
  context.fillRect(0, 0, 1, 1);
  const primary = Array.from(context.getImageData(0, 0, 1, 1).data);
  const ground = base.map((value, index) => (index < 3 && dark ? 0 : value));
  const pixels = context.createImageData(width, height);
  const field = new Float32Array((FIELD_WIDTH + 1) * (FIELD_HEIGHT + 1));
  const colors = new Uint8ClampedArray(1025 * 4);
  for (let step = 0; step <= 1024; step++) {
    for (let channel = 0; channel < 3; channel++) {
      colors[step * 4 + channel] =
        ground[channel]! +
        (primary[channel]! - ground[channel]!) *
          (step === 1024 ? 0.29 : (step / 1023) * 0.035);
    }
    colors[step * 4 + 3] = 255;
  }
  const palette = new Uint32Array(colors.buffer);
  const output = new Uint32Array(pixels.data.buffer);
  const columns = new Uint16Array(width);
  const weights = new Float32Array(width);
  for (let x = 0; x < width; x++) {
    const fieldX = (x / width) * FIELD_WIDTH;
    columns[x] = Math.floor(fieldX);
    weights[x] = fieldX - columns[x]!;
  }
  const row = new Float32Array(FIELD_WIDTH + 1);
  let frame = 0;
  let last = 0;
  let time = ambientTime;
  let visible = true;
  let disposed = false;
  let fading = from !== null;
  const fadeStart = performance.now();
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  function paint() {
    for (let y = 0; y <= FIELD_HEIGHT; y++) {
      for (let x = 0; x <= FIELD_WIDTH; x++) {
        const nx = x / FIELD_WIDTH;
        const ny = y / FIELD_HEIGHT;
        const wave =
          0.48 +
          0.28 *
            Math.sin(nx * 8 + Math.sin(ny * 6 + time * 0.18) + time * 0.13) +
          0.18 * Math.cos(nx * 12 - ny * 7 - time * 0.16);
        const quietCenter = Math.exp(
          -((nx - 0.5) ** 2 * 14 + (ny - 0.47) ** 2 * 18),
        );
        const fade = Math.max(0, 1 - ny * 1.42) ** 1.2;
        field[y * (FIELD_WIDTH + 1) + x] = Math.max(
          0,
          Math.min(0.9, wave * fade * (1 - quietCenter * 0.87)),
        );
      }
    }
    for (let y = 0; y < height; y++) {
      const fieldY = (y / height) * FIELD_HEIGHT;
      const top = Math.floor(fieldY);
      const blend = fieldY - top;
      const above = top * (FIELD_WIDTH + 1);
      const below = above + FIELD_WIDTH + 1;
      for (let x = 0; x <= FIELD_WIDTH; x++) {
        row[x] = field[above + x]! * (1 - blend) + field[below + x]! * blend;
      }
      const matrixRow = (y & 3) * 4;
      const offset = y * width;
      for (let x = 0; x < width; x++) {
        const column = columns[x]!;
        const weight = weights[x]!;
        const density = row[column]! * (1 - weight) + row[column + 1]! * weight;
        output[offset + x] =
          palette[
            density > (DITHER_MATRIX[matrixRow + (x & 3)]! + 0.5) / 16
              ? 1024
              : Math.round(density * 1023)
          ]!;
      }
    }
    context.putImageData(pixels, 0, 0);
    if (fading) fading = drawFade(context, from!, fadeStart);
  }

  function tick(now: number) {
    frame = 0;
    if (disposed || document.hidden || !visible || reducedMotion.matches) {
      return;
    }
    if (!last || now - last >= FRAME_INTERVAL_MS || fading) {
      time += last ? Math.min(100, now - last) / 1000 : 0;
      ambientTime = time;
      last = now;
      paint();
    }
    frame = requestAnimationFrame(tick);
  }

  function reconcile() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
    if (disposed) return;
    if (reducedMotion.matches && fading) {
      fading = false;
      paint();
    }
    if (!document.hidden && visible && !reducedMotion.matches) {
      frame = requestAnimationFrame(tick);
    }
  }

  const intersection = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    reconcile();
  });
  intersection.observe(canvas);
  document.addEventListener("visibilitychange", reconcile);
  reducedMotion.addEventListener("change", reconcile);
  paint();
  reconcile();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    intersection.disconnect();
    document.removeEventListener("visibilitychange", reconcile);
    reducedMotion.removeEventListener("change", reconcile);
  };
}
