import {
  buildClientDataJson,
  clientDataHashBase64Url,
} from "./webauthn-client-data.js";
import type {
  NativeWebauthnRequest,
  SerializedPublicKeyOptions,
} from "./webauthn-native-protocol.js";

export interface MappedWebauthnNativeRequest {
  nativeRequest: NativeWebauthnRequest;
  clientDataJson: string;
}

function hostFromOrigin(origin: string): string {
  return new URL(origin).hostname;
}

export function mapPublicKeyOptionsToNativeRequest(
  options: SerializedPublicKeyOptions,
  origin: string,
  crossOrigin: boolean,
): MappedWebauthnNativeRequest {
  const clientDataJson = buildClientDataJson({
    type: options.mode === "get" ? "webauthn.get" : "webauthn.create",
    challengeBase64Url: options.challenge,
    origin,
    crossOrigin,
  });
  const clientDataHash = clientDataHashBase64Url(clientDataJson);

  if (options.mode === "get") {
    return {
      clientDataJson,
      nativeRequest: {
        mode: "get",
        origin,
        rpId: options.rpId ?? hostFromOrigin(origin),
        clientDataHash,
        allowCredentials: options.allowCredentials ?? [],
        userVerification: options.userVerification ?? "preferred",
      },
    };
  }

  return {
    clientDataJson,
    nativeRequest: {
      mode: "create",
      origin,
      rpId: options.rp.id ?? hostFromOrigin(origin),
      rpName: options.rp.name,
      userId: options.user.id,
      userName: options.user.name,
      userDisplayName: options.user.displayName,
      clientDataHash,
      pubKeyCredParams:
        options.pubKeyCredParams === null || options.pubKeyCredParams.length === 0
          ? [{ type: "public-key", alg: -7 }]
          : options.pubKeyCredParams,
      excludeCredentials: options.excludeCredentials ?? [],
      userVerification: options.authenticatorSelection?.userVerification === "required"
        ? "required"
        : options.authenticatorSelection?.userVerification === "discouraged"
          ? "discouraged"
          : "preferred",
      attestation: options.attestation ?? "none",
    },
  };
}
