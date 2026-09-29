import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildClientDataJson,
  clientDataHashBase64Url,
} from "../src/webauthn-native/webauthn-client-data.js";
import { base64UrlEncode } from "../src/webauthn-native/webauthn-base64url.js";

describe("buildClientDataJson", () => {
  it("matches the browser CollectedClientData shape exactly", () => {
    const json = buildClientDataJson({
      type: "webauthn.get",
      challengeBase64Url: "AQID_f7_",
      origin: "https://example.com",
      crossOrigin: false,
    });
    expect(JSON.parse(json)).toEqual({
      type: "webauthn.get",
      challenge: "AQID_f7_",
      origin: "https://example.com",
      crossOrigin: false,
    });
  });

  it("uses webauthn.create for registration and preserves crossOrigin: true", () => {
    const json = buildClientDataJson({
      type: "webauthn.create",
      challengeBase64Url: "CQkJ",
      origin: "https://login.example.com",
      crossOrigin: true,
    });
    expect(JSON.parse(json)).toEqual({
      type: "webauthn.create",
      challenge: "CQkJ",
      origin: "https://login.example.com",
      crossOrigin: true,
    });
  });
});

describe("clientDataHashBase64Url", () => {
  it("returns the base64url SHA-256 digest of the exact JSON bytes", () => {
    const json = buildClientDataJson({
      type: "webauthn.get",
      challengeBase64Url: "AQID",
      origin: "https://example.com",
      crossOrigin: false,
    });
    const expected = base64UrlEncode(
      createHash("sha256").update(json, "utf8").digest(),
    );
    expect(clientDataHashBase64Url(json)).toBe(expected);
  });

  it("produces different hashes for different clientDataJSON bytes", () => {
    const a = clientDataHashBase64Url('{"a":1}');
    const b = clientDataHashBase64Url('{"a":2}');
    expect(a).not.toBe(b);
  });
});
