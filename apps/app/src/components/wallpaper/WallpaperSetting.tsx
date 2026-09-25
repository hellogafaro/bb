import { useRef } from "react";
import { Button } from "@bb/shared-ui/button";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { appToast } from "@/components/ui/app-toast";
import { WALLPAPER_SOURCE_TYPES } from "./prepare-wallpaper";
import { useWallpaper, useWallpaperMutations } from "./use-wallpaper";

export function WallpaperSetting() {
  const { wallpaper, imageUrl } = useWallpaper();
  const { isPending, setWallpaperFile, clearWallpaper } =
    useWallpaperMutations();
  const input = useRef<HTMLInputElement | null>(null);
  const report = (promise: Promise<unknown>, fallback: string) => {
    promise.catch((error: unknown) => {
      appToast.error(error instanceof Error ? error.message : fallback);
    });
  };
  return (
    <SettingsWithControl
      settingId="wallpaper"
      label="Wallpaper"
      description="Shown behind the welcome and New thread screens. Without an image, a quiet animated pattern in the palette's accent is shown."
    >
      <div className="flex items-center gap-2">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-8 w-12 shrink-0 rounded-sm border border-border object-cover"
          />
        ) : null}
        <input
          ref={input}
          type="file"
          className="hidden"
          aria-label="Choose wallpaper image"
          accept={WALLPAPER_SOURCE_TYPES.join(",")}
          disabled={isPending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              report(setWallpaperFile(file), "Could not set the wallpaper.");
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => input.current?.click()}
        >
          {wallpaper ? "Change image" : "Choose image"}
        </Button>
        {wallpaper ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() =>
              report(clearWallpaper(), "Could not remove the wallpaper.")
            }
          >
            Remove
          </Button>
        ) : null}
      </div>
    </SettingsWithControl>
  );
}
