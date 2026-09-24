export const WALLPAPER_SOURCE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const WALLPAPER_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
const WALLPAPER_ENCODED_MAX_LENGTH = 220_000;

export async function prepareWallpaperImage(file: File): Promise<string> {
  if (!WALLPAPER_SOURCE_TYPES.includes(file.type)) {
    throw new Error("Choose a PNG, JPG, or WebP image.");
  }
  if (file.size > WALLPAPER_SOURCE_MAX_BYTES) {
    throw new Error("Choose an image smaller than 20 MB.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser could not prepare the image.");
    for (let size = 1600; size >= 500; size = Math.floor(size * 0.8)) {
      const ratio = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/webp", 0.78);
      if (
        data.startsWith("data:image/webp;") &&
        data.length <= WALLPAPER_ENCODED_MAX_LENGTH
      ) {
        return data;
      }
    }
    throw new Error("This image is too detailed to save. Try a smaller image.");
  } finally {
    bitmap.close();
  }
}
