import { animateAmbient } from "./ambient";
import { snapshotWallpaper } from "./fade";
import { animatePhoto } from "./photo";

const WALLPAPER_MAX_WIDTH = 2400;
const WALLPAPER_MAX_HEIGHT = 1800;

let decoded: { src: string; image: Promise<HTMLImageElement> } | null = null;

function decodeImage(src: string): Promise<HTMLImageElement> {
  if (decoded?.src !== src) {
    const image = new Image();
    image.src = src;
    const entry = { src, image: image.decode().then(() => image) };
    decoded = entry;
    entry.image.catch(() => {
      if (decoded === entry) decoded = null;
    });
  }
  return decoded.image;
}

function readBackgroundRgba(
  canvas: HTMLCanvasElement,
  dark: boolean,
): number[] {
  const probe = document.createElement("canvas").getContext("2d")!;
  probe.fillStyle =
    getComputedStyle(canvas).getPropertyValue("--background").trim() ||
    (dark ? "#141414" : "#ffffff");
  probe.fillRect(0, 0, 1, 1);
  return Array.from(probe.getImageData(0, 0, 1, 1).data);
}

export function renderWallpaper(
  canvas: HTMLCanvasElement,
  imageUrl: string | null,
  crossfade: boolean,
): () => void {
  let cancelled = false;
  let cancelPhoto = () => {};
  const from = crossfade ? snapshotWallpaper(canvas) : null;
  const cssWidth = Math.max(1, canvas.clientWidth);
  const cssHeight = Math.max(1, canvas.clientHeight);
  const resolution = Math.min(
    imageUrl ? 1 : 0.5,
    WALLPAPER_MAX_WIDTH / cssWidth,
    WALLPAPER_MAX_HEIGHT / cssHeight,
  );
  const width = Math.max(1, Math.round(cssWidth * resolution));
  const height = Math.max(1, Math.round(cssHeight * resolution));
  const dark = document.documentElement.classList.contains("dark");
  const base = readBackgroundRgba(canvas, dark);
  if (!imageUrl) {
    canvas.width = width;
    canvas.height = height;
    const dispose = animateAmbient(canvas, base, dark, from);
    canvas.dataset.ready = "";
    return dispose;
  }
  decodeImage(imageUrl).then(
    (image) => {
      if (cancelled) return;
      cancelPhoto = animatePhoto(canvas, image, from);
    },
    () => {
      if (cancelled || canvas.hasAttribute("data-ready")) return;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (context) {
        context.fillStyle = `rgb(${base.slice(0, 3).join(",")})`;
        context.fillRect(0, 0, width, height);
      }
    },
  );
  return () => {
    cancelled = true;
    cancelPhoto();
  };
}
