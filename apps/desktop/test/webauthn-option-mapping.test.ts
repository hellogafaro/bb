import { describe, expect, it } from "vitest";
import { mapPublicKeyOptionsToNativeRequest } from "../src/webauthn-native/webauthn-option-mapping.js";
import { clientDataHashBase64Url } from "../src/webauthn-native/webauthn-client-data.js";
import type { SerializedPublicKeyOptions } from "../src/webauthn-native/webauthn-native-protocol.js";

describe("mapPublicKeyOptionsToNativeRequest", () => {
  it("maps a get() request and hashes the exact clientDataJSON bytes", () => {
    const options: SerializedPublicKeyOptions = {
      mode: "get",
      challenge: "AQID",
      rpId: "example.com",
      timeout: 60000,
      userVerification: "required",
      allowCredentials: [{ id: "CQkJ", type: "public-key", transports: ["internal"] }],
    };
    const { nativeRequest, clientDataJson } = mapPublicKeyOptionsToNativeRequest(
      options,
      "https://example.com",
      false,
    );
    expect(JSON.parse(clientDataJson)).toEqual({
      type: "webauthn.get",
      challenge: "AQID",
      origin: "https://example.com",
      crossOrigin: false,
    });
    expect(nativeRequest).toEqual({
      mode: "get",
      origin: "https://example.com",
      rpId: "example.com",
      clientDataHash: clientDataHashBase64Url(clientDataJson),
      allowCredentials: [{ id: "CQkJ", type: "public-key", transports: ["internal"] }],
      userVerification: "required",
    });
  });

  it("derives rpId from the origin when the page does not set one", () => {
    const options: SerializedPublicKeyOptions = {
      mode: "get",
      challenge: "AQID",
      rpId: null,
      timeout: null,
      userVerification: null,
      allowCredentials: null,
    };
    const { nativeRequest } = mapPublicKeyOptionsToNativeRequest(
      options,
      "https://accounts.example.com",
      false,
    );
    expect(nativeRequest).toMatchObject({
      rpId: "accounts.example.com",
      allowCredentials: [],
      userVerification: "preferred",
    });
  });

  it("maps a create() request with defaults for omitted optional fields", () => {
    const options: SerializedPublicKeyOptions = {
      mode: "create",
      rp: { id: null, name: "Example" },
      user: { id: "AQEBAQ", name: "user@example.com", displayName: "User" },
      challenge: "ChQe",
      pubKeyCredParams: null,
      timeout: null,
      excludeCredentials: null,
      authenticatorSelection: null,
      attestation: null,
    };
    const { nativeRequest, clientDataJson } = mapPublicKeyOptionsToNativeRequest(
      options,
      "https://example.com",
      false,
    );
    expect(JSON.parse(clientDataJson)).toMatchObject({ type: "webauthn.create" });
    expect(nativeRequest).toEqual({
      mode: "create",
      origin: "https://example.com",
      rpId: "example.com",
      rpName: "Example",
      userId: "AQEBAQ",
      userName: "user@example.com",
      userDisplayName: "User",
      clientDataHash: clientDataHashBase64Url(clientDataJson),
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      excludeCredentials: [],
      userVerification: "preferred",
      attestation: "none",
    });
  });

  it("honors an explicit authenticatorSelection.userVerification", () => {
    const options: SerializedPublicKeyOptions = {
      mode: "create",
      rp: { id: "example.com", name: "Example" },
      user: { id: "AQEBAQ", name: "user@example.com", displayName: "User" },
      challenge: "ChQe",
      pubKeyCredParams: [{ type: "public-key", alg: -257 }],
      timeout: null,
      excludeCredentials: null,
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        residentKey: "required",
        requireResidentKey: true,
        userVerification: "discouraged",
      },
      attestation: "direct",
    };
    const { nativeRequest } = mapPublicKeyOptionsToNativeRequest(
      options,
      "https://example.com",
      false,
    );
    expect(nativeRequest).toMatchObject({
      userVerification: "discouraged",
      attestation: "direct",
      pubKeyCredParams: [{ type: "public-key", alg: -257 }],
    });
  });
});
