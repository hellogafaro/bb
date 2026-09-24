import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  WallpaperInfo,
  WallpaperStatusResponse,
} from "@bb/server-contract";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { applyWallpaperToSystemConfig } from "@/hooks/cache-owners/system-config-cache-owner";
import { sdk } from "@/lib/sdk";
import { prepareWallpaperImage } from "./prepare-wallpaper";

const WALLPAPER_PATH = "/api/v1/settings/appearance/wallpaper";

export function wallpaperImageUrl(
  wallpaper: WallpaperInfo | null,
): string | null {
  if (wallpaper === null) return null;
  return `${WALLPAPER_PATH}?v=${wallpaper.updatedAt}-${wallpaper.bytes}`;
}

export function useWallpaper(): {
  wallpaper: WallpaperInfo | null;
  imageUrl: string | null;
  isLoading: boolean;
} {
  const { data, isLoading } = useSystemConfig();
  const wallpaper = data?.wallpaper ?? null;
  return { wallpaper, imageUrl: wallpaperImageUrl(wallpaper), isLoading };
}

export function useWallpaperMutations() {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const run = useCallback(
    async (change: () => Promise<WallpaperStatusResponse>) => {
      setIsPending(true);
      try {
        const status = await change();
        applyWallpaperToSystemConfig(queryClient, status.wallpaper);
      } finally {
        setIsPending(false);
      }
    },
    [queryClient],
  );
  const setWallpaperFile = useCallback(
    (file: File) =>
      run(async () => {
        const dataUrl = await prepareWallpaperImage(file);
        return sdk.theme.setWallpaper({ dataUrl });
      }),
    [run],
  );
  const clearWallpaper = useCallback(
    () => run(() => sdk.theme.clearWallpaper()),
    [run],
  );
  return { isPending, setWallpaperFile, clearWallpaper };
}
