import { createHash } from "node:crypto";
import { base64UrlEncode } from "./webauthn-base64url.js";

export type WebauthnClientDataType = "webauthn.get" | "webauthn.create";

export interface BuildClientDataJsonArgs {
  type: WebauthnClientDataType;
  challengeBase64Url: string;
  origin: string;
  crossOrigin: boolean;
}

export function buildClientDataJson({
  type,
  challengeBase64Url,
  origin,
  crossOrigin,
}: BuildClientDataJsonArgs): string {
  return JSON.stringify({
    type,
    challenge: challengeBase64Url,
    origin,
    crossOrigin,
  });
}

export function clientDataHashBase64Url(clientDataJson: string): string {
  return base64UrlEncode(createHash("sha256").update(clientDataJson, "utf8").digest());
}
