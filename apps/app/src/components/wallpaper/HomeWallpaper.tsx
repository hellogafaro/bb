import { useEffect, useRef, useState } from "react";
import { useWallpaper } from "./use-wallpaper";
import { renderWallpaper } from "./render-wallpaper";

const REPAINT_DEBOUNCE_MS = 100;

function useThemeRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setRevision((current) => current + 1);
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-palette"],
    });
    return () => observer.disconnect();
  }, []);
  return revision;
}

export function HomeWallpaper() {
  const { imageUrl, isLoading } = useWallpaper();
  const themeRevision = useThemeRevision();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderedUrl = useRef<string | null | undefined>(undefined);
  const [sizeRevision, setSizeRevision] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || imageUrl !== null) return;
    let timer = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(
        () => setSizeRevision((current) => current + 1),
        REPAINT_DEBOUNCE_MS,
      );
    });
    observer.observe(canvas);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [imageUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || isLoading) return;
    const crossfade =
      renderedUrl.current !== undefined && renderedUrl.current !== imageUrl;
    renderedUrl.current = imageUrl;
    let dispose = () => {};
    const frame = requestAnimationFrame(() => {
      dispose = renderWallpaper(canvas, imageUrl, crossfade);
    });
    return () => {
      cancelAnimationFrame(frame);
      dispose();
    };
  }, [imageUrl, isLoading, themeRevision, sizeRevision]);

  return (
    <>
      <canvas
        ref={canvasRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 size-full object-cover opacity-0 transition-opacity duration-240 ease-out [image-rendering:pixelated] data-[ready]:opacity-100 motion-reduce:transition-none"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--background)_10%,transparent)_0%,color-mix(in_srgb,var(--background)_65%,transparent)_36%,color-mix(in_srgb,var(--background)_88%,transparent)_66%,var(--background)_100%)] dark:bg-[linear-gradient(to_bottom,rgb(0_0_0/0.2)_0%,rgb(0_0_0/0.72)_36%,rgb(0_0_0/0.91)_66%,#000_100%)]"
      />
    </>
  );
}
