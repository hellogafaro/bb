import { describe, expect, it, vi } from "vitest";
import {
  buildCreateCredentialPayload,
  buildGetCredentialPayload,
  buildWebauthnResolveScript,
} from "../src/webauthn-native/webauthn-result-mapping.js";
import { base64UrlEncode } from "../src/webauthn-native/webauthn-base64url.js";
import type {
  NativeWebauthnCreateSuccess,
  NativeWebauthnGetSuccess,
} from "../src/webauthn-native/webauthn-native-protocol.js";

describe("buildGetCredentialPayload", () => {
  it("carries the native response fields and re-encodes the caller's clientDataJSON", () => {
    const response: NativeWebauthnGetSuccess = {
      ok: true,
      mode: "get",
      id: "cred-id",
      rawId: "cred-raw-id",
      authenticatorData: "auth-data",
      signature: "sig",
      userHandle: "user-handle",
      authenticatorAttachment: "platform",
    };
    const clientDataJson = '{"type":"webauthn.get","challenge":"AQID","origin":"https://example.com","crossOrigin":false}';
    const payload = buildGetCredentialPayload(response, clientDataJson);
    expect(payload).toEqual({
      mode: "get",
      id: "cred-id",
      rawId: "cred-raw-id",
      clientDataJSON: base64UrlEncode(Buffer.from(clientDataJson, "utf8")),
      authenticatorData: "auth-data",
      signature: "sig",
      userHandle: "user-handle",
      authenticatorAttachment: "platform",
    });
  });

  it("preserves a null userHandle", () => {
    const response: NativeWebauthnGetSuccess = {
      ok: true,
      mode: "get",
      id: "cred-id",
      rawId: "cred-raw-id",
      authenticatorData: "auth-data",
      signature: "sig",
      userHandle: null,
      authenticatorAttachment: null,
    };
    const payload = buildGetCredentialPayload(response, "{}");
    expect(payload.userHandle).toBeNull();
    expect(payload.authenticatorAttachment).toBeNull();
  });
});

describe("buildCreateCredentialPayload", () => {
  it("carries the native response fields and re-encodes the caller's clientDataJSON", () => {
    const response: NativeWebauthnCreateSuccess = {
      ok: true,
      mode: "create",
      id: "cred-id",
      rawId: "cred-raw-id",
      attestationObject: "attestation",
      transports: ["internal", "hybrid"],
      authenticatorAttachment: "platform",
    };
    const clientDataJson = '{"type":"webauthn.create","challenge":"AQID","origin":"https://example.com","crossOrigin":false}';
    const payload = buildCreateCredentialPayload(response, clientDataJson);
    expect(payload).toEqual({
      mode: "create",
      id: "cred-id",
      rawId: "cred-raw-id",
      clientDataJSON: base64UrlEncode(Buffer.from(clientDataJson, "utf8")),
      attestationObject: "attestation",
      transports: ["internal", "hybrid"],
      authenticatorAttachment: "platform",
    });
  });
});

describe("buildWebauthnResolveScript", () => {
  it("produces a script that calls the named global with a PublicKeyCredential-shaped get() result", async () => {
    const response: NativeWebauthnGetSuccess = {
      ok: true,
      mode: "get",
      id: "cred-id",
      rawId: base64UrlEncode(Buffer.from([1, 2, 3])),
      authenticatorData: base64UrlEncode(Buffer.from([4, 5])),
      signature: base64UrlEncode(Buffer.from([6, 7, 8])),
      userHandle: base64UrlEncode(Buffer.from([9])),
      authenticatorAttachment: "platform",
    };
    const payload = buildGetCredentialPayload(response, '{"type":"webauthn.get"}');
    const script = buildWebauthnResolveScript("__resolve", 42, payload);

    const resolve = vi.fn();
    (globalThis as { __resolve?: unknown }).__resolve = resolve;
    try {
      eval(script);
    } finally {
      delete (globalThis as { __resolve?: unknown }).__resolve;
    }

    expect(resolve).toHaveBeenCalledTimes(1);
    const [requestId, credential] = resolve.mock.calls[0] as [number, {
      id: string;
      rawId: ArrayBuffer;
      type: string;
      response: {
        clientDataJSON: ArrayBuffer;
        authenticatorData: ArrayBuffer;
        signature: ArrayBuffer;
        userHandle: ArrayBuffer | null;
      };
      getClientExtensionResults: () => unknown;
    }];
    expect(requestId).toBe(42);
    expect(credential.id).toBe("cred-id");
    expect(credential.type).toBe("public-key");
    expect(Buffer.from(credential.rawId)).toEqual(Buffer.from([1, 2, 3]));
    expect(Buffer.from(credential.response.authenticatorData)).toEqual(
      Buffer.from([4, 5]),
    );
    expect(Buffer.from(credential.response.signature)).toEqual(
      Buffer.from([6, 7, 8]),
    );
    expect(Buffer.from(credential.response.userHandle as ArrayBuffer)).toEqual(
      Buffer.from([9]),
    );
    expect(credential.getClientExtensionResults()).toEqual({});
  });

  it("does nothing when the resolve global is not installed", () => {
    const payload = buildGetCredentialPayload(
      {
        ok: true,
        mode: "get",
        id: "id",
        rawId: "AQID",
        authenticatorData: "AQID",
        signature: "AQID",
        userHandle: null,
        authenticatorAttachment: null,
      },
      "{}",
    );
    const script = buildWebauthnResolveScript("__missingResolve", 1, payload);
    expect(() => eval(script)).not.toThrow();
  });
});
