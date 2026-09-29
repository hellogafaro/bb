import { base64UrlEncode } from "./webauthn-base64url.js";
import type {
  NativeWebauthnCreateSuccess,
  NativeWebauthnGetSuccess,
} from "./webauthn-native-protocol.js";

export interface WebauthnGetCredentialPayload {
  mode: "get";
  id: string;
  rawId: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  userHandle: string | null;
  authenticatorAttachment: "platform" | "cross-platform" | null;
}

export interface WebauthnCreateCredentialPayload {
  mode: "create";
  id: string;
  rawId: string;
  clientDataJSON: string;
  attestationObject: string;
  transports: string[];
  authenticatorAttachment: "platform" | "cross-platform" | null;
}

export type WebauthnCredentialPayload =
  | WebauthnGetCredentialPayload
  | WebauthnCreateCredentialPayload;

export function buildGetCredentialPayload(
  response: NativeWebauthnGetSuccess,
  clientDataJson: string,
): WebauthnGetCredentialPayload {
  return {
    mode: "get",
    id: response.id,
    rawId: response.rawId,
    clientDataJSON: base64UrlEncode(Buffer.from(clientDataJson, "utf8")),
    authenticatorData: response.authenticatorData,
    signature: response.signature,
    userHandle: response.userHandle,
    authenticatorAttachment: response.authenticatorAttachment,
  };
}

export function buildCreateCredentialPayload(
  response: NativeWebauthnCreateSuccess,
  clientDataJson: string,
): WebauthnCreateCredentialPayload {
  return {
    mode: "create",
    id: response.id,
    rawId: response.rawId,
    clientDataJSON: base64UrlEncode(Buffer.from(clientDataJson, "utf8")),
    attestationObject: response.attestationObject,
    transports: response.transports,
    authenticatorAttachment: response.authenticatorAttachment,
  };
}

export function buildWebauthnResolveScript(
  resolveGlobalKey: string,
  requestId: number,
  payload: WebauthnCredentialPayload,
): string {
  return `(() => {
    const resolve = globalThis[${JSON.stringify(resolveGlobalKey)}];
    if (typeof resolve !== "function") return;
    const payload = ${JSON.stringify(payload)};
    function fromBase64Url(value) {
      const padded = value.replace(/-/g, "+").replace(/_/g, "/");
      const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
      const binary = atob(withPadding);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return bytes.buffer;
    }
    const response =
      payload.mode === "get"
        ? {
            clientDataJSON: fromBase64Url(payload.clientDataJSON),
            authenticatorData: fromBase64Url(payload.authenticatorData),
            signature: fromBase64Url(payload.signature),
            userHandle: payload.userHandle === null ? null : fromBase64Url(payload.userHandle),
          }
        : {
            clientDataJSON: fromBase64Url(payload.clientDataJSON),
            attestationObject: fromBase64Url(payload.attestationObject),
            getTransports: () => payload.transports,
          };
    const credential = {
      id: payload.id,
      rawId: fromBase64Url(payload.rawId),
      type: "public-key",
      authenticatorAttachment: payload.authenticatorAttachment,
      response,
      getClientExtensionResults: () => ({}),
    };
    resolve(${JSON.stringify(requestId)}, credential);
  })();`;
}
