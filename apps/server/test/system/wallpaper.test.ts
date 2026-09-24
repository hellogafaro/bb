import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  systemConfigResponseSchema,
  wallpaperStatusResponseSchema,
} from "@bb/server-contract";
import { readJson } from "../helpers/json.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const WEBP_BYTES = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(14, 1),
]);
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16, 2),
]);

function dataUrl(contentType: string, bytes: Buffer): string {
  return `data:${contentType};base64,${bytes.toString("base64")}`;
}

function putWallpaper(harness: TestAppHarness, url: string) {
  return harness.app.request("/api/v1/settings/appearance/wallpaper", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dataUrl: url }),
  });
}

describe("appearance wallpaper", () => {
  it("reports no wallpaper and 404s the image by default", async () => {
    await withTestHarness(async (harness) => {
      const config = systemConfigResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/config")),
      );
      expect(config.wallpaper).toBeNull();
      const image = await harness.app.request(
        "/api/v1/settings/appearance/wallpaper",
      );
      expect(image.status).toBe(404);
    });
  });

  it("stores, serves, replaces, and clears a wallpaper", async () => {
    await withTestHarness(async (harness) => {
      const set = await putWallpaper(
        harness,
        dataUrl("image/webp", WEBP_BYTES),
      );
      expect(set.status).toBe(200);
      const status = wallpaperStatusResponseSchema.parse(await readJson(set));
      expect(status.wallpaper).toMatchObject({
        contentType: "image/webp",
        bytes: WEBP_BYTES.length,
      });

      const image = await harness.app.request(
        "/api/v1/settings/appearance/wallpaper",
      );
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/webp");
      expect(Buffer.from(await image.arrayBuffer())).toEqual(WEBP_BYTES);

      const config = systemConfigResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/config")),
      );
      expect(config.wallpaper).toEqual(status.wallpaper);

      expect(
        (await putWallpaper(harness, dataUrl("image/png", PNG_BYTES))).status,
      ).toBe(200);
      expect(
        (await readdir(join(harness.config.dataDir, "appearance"))).sort(),
      ).toEqual(["wallpaper.png"]);

      const cleared = await harness.app.request(
        "/api/v1/settings/appearance/wallpaper",
        { method: "DELETE" },
      );
      expect(await readJson(cleared)).toEqual({ wallpaper: null });
      expect(
        (await harness.app.request("/api/v1/settings/appearance/wallpaper"))
          .status,
      ).toBe(404);
    });
  });

  it("rejects bytes that do not match the declared image type", async () => {
    await withTestHarness(async (harness) => {
      const response = await putWallpaper(
        harness,
        dataUrl("image/webp", PNG_BYTES),
      );
      expect(response.status).toBe(400);
      const config = systemConfigResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/config")),
      );
      expect(config.wallpaper).toBeNull();
    });
  });
});
