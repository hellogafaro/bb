import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WEBAUTHN_ENTITLEMENT_MARKER_FILE,
  isWebauthnNativeBridgeAvailable,
} from "../src/webauthn-native/webauthn-native-entitlement.js";

describe("isWebauthnNativeBridgeAvailable", () => {
  let resourcesPath: string;

  beforeEach(async () => {
    resourcesPath = await mkdtemp(join(tmpdir(), "bb-webauthn-entitlement-"));
  });

  afterEach(async () => {
    await rm(resourcesPath, { recursive: true, force: true });
  });

  it("is unavailable on non-darwin platforms even with the marker file present", async () => {
    await writeFile(join(resourcesPath, WEBAUTHN_ENTITLEMENT_MARKER_FILE), "{}");
    expect(
      isWebauthnNativeBridgeAvailable({ platform: "linux", resourcesPath, env: {} }),
    ).toBe(false);
  });

  it("is unavailable on darwin without the marker file or env override", () => {
    expect(
      isWebauthnNativeBridgeAvailable({ platform: "darwin", resourcesPath, env: {} }),
    ).toBe(false);
  });

  it("is available on darwin when the packaged marker file exists", async () => {
    await writeFile(join(resourcesPath, WEBAUTHN_ENTITLEMENT_MARKER_FILE), "{}");
    expect(
      isWebauthnNativeBridgeAvailable({ platform: "darwin", resourcesPath, env: {} }),
    ).toBe(true);
  });

  it("is available on darwin via the explicit dev/test env override", () => {
    expect(
      isWebauthnNativeBridgeAvailable({
        platform: "darwin",
        resourcesPath,
        env: { BB_WEBAUTHN_NATIVE_ENABLED: "1" },
      }),
    ).toBe(true);
  });

  it("ignores an unrecognized env override value", () => {
    expect(
      isWebauthnNativeBridgeAvailable({
        platform: "darwin",
        resourcesPath,
        env: { BB_WEBAUTHN_NATIVE_ENABLED: "true" },
      }),
    ).toBe(false);
  });
});
