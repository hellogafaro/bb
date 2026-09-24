import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  sniffWallpaperContentType,
  WALLPAPER_MAX_BYTES,
  type WallpaperContentType,
  type WallpaperInfo,
} from "@bb/server-contract";

const APPEARANCE_DIR_NAME = "appearance";
const WALLPAPER_FILE_BASENAME = "wallpaper";

const WALLPAPER_EXTENSIONS: Record<WallpaperContentType, string> = {
  "image/webp": "webp",
  "image/png": "png",
  "image/jpeg": "jpg",
};

export class WallpaperValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WallpaperValidationError";
  }
}

function appearanceDir(dataDir: string): string {
  return join(dataDir, APPEARANCE_DIR_NAME);
}

function wallpaperPath(dataDir: string, contentType: WallpaperContentType) {
  return join(
    appearanceDir(dataDir),
    `${WALLPAPER_FILE_BASENAME}.${WALLPAPER_EXTENSIONS[contentType]}`,
  );
}

function contentTypeForExtension(
  extension: string,
): WallpaperContentType | null {
  const match = Object.entries(WALLPAPER_EXTENSIONS).find(
    ([, candidate]) => candidate === extension,
  );
  return match ? (match[0] as WallpaperContentType) : null;
}

function findStoredWallpaper(
  dataDir: string,
): { path: string; contentType: WallpaperContentType } | null {
  let entries: string[];
  try {
    entries = readdirSync(appearanceDir(dataDir));
  } catch {
    return null;
  }
  for (const entry of entries) {
    const match = /^([a-z]+)\.([a-z]+)$/.exec(entry);
    if (!match || match[1] !== WALLPAPER_FILE_BASENAME) continue;
    const contentType = contentTypeForExtension(match[2]!);
    if (contentType) {
      return { path: join(appearanceDir(dataDir), entry), contentType };
    }
  }
  return null;
}

export function readWallpaperInfo(dataDir: string): WallpaperInfo | null {
  const stored = findStoredWallpaper(dataDir);
  if (!stored) return null;
  try {
    const stats = statSync(stored.path);
    return {
      contentType: stored.contentType,
      bytes: stats.size,
      updatedAt: Math.floor(stats.mtimeMs),
    };
  } catch {
    return null;
  }
}

export function readWallpaper(
  dataDir: string,
): { bytes: Uint8Array; info: WallpaperInfo } | null {
  const stored = findStoredWallpaper(dataDir);
  const info = readWallpaperInfo(dataDir);
  if (!stored || !info) return null;
  try {
    return { bytes: readFileSync(stored.path), info };
  } catch {
    return null;
  }
}

export function decodeWallpaperDataUrl(dataUrl: string): Uint8Array {
  const [header, base64] = dataUrl.split(",", 2);
  const declared = header?.slice("data:".length, header.indexOf(";"));
  const bytes = Buffer.from(base64 ?? "", "base64");
  if (bytes.length === 0) {
    throw new WallpaperValidationError("The wallpaper image is empty.");
  }
  if (bytes.length > WALLPAPER_MAX_BYTES) {
    throw new WallpaperValidationError(
      "Choose a wallpaper image smaller than 4 MB.",
    );
  }
  const sniffed = sniffWallpaperContentType(bytes);
  if (sniffed === null || sniffed !== declared) {
    throw new WallpaperValidationError(
      "Choose a PNG, JPEG, or WebP wallpaper image.",
    );
  }
  return new Uint8Array(bytes);
}

export function writeWallpaper(
  dataDir: string,
  bytes: Uint8Array,
): WallpaperInfo {
  const contentType = sniffWallpaperContentType(bytes);
  if (contentType === null) {
    throw new WallpaperValidationError(
      "Choose a PNG, JPEG, or WebP wallpaper image.",
    );
  }
  mkdirSync(appearanceDir(dataDir), { recursive: true });
  const previous = findStoredWallpaper(dataDir);
  const target = wallpaperPath(dataDir, contentType);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, target);
  if (previous && previous.path !== target) {
    rmSync(previous.path, { force: true });
  }
  return readWallpaperInfo(dataDir)!;
}

export function clearWallpaper(dataDir: string): void {
  const stored = findStoredWallpaper(dataDir);
  if (stored) rmSync(stored.path, { force: true });
}
