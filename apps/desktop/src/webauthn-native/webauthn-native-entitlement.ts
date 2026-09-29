import { existsSync } from "node:fs";
import { join } from "node:path";

export const WEBAUTHN_ENTITLEMENT_MARKER_FILE = "webauthn-entitlement.json";

export interface WebauthnNativeAvailabilityArgs {
  platform: NodeJS.Platform;
  resourcesPath: string;
  env: Record<string, string | undefined>;
}

export function isWebauthnNativeBridgeAvailable({
  platform,
  resourcesPath,
  env,
}: WebauthnNativeAvailabilityArgs): boolean {
  if (platform !== "darwin") {
    return false;
  }
  if (env.BB_WEBAUTHN_NATIVE_ENABLED === "1") {
    return true;
  }
  return existsSync(join(resourcesPath, WEBAUTHN_ENTITLEMENT_MARKER_FILE));
}
