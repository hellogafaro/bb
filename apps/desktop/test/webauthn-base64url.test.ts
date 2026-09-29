import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  isBase64Url,
} from "../src/webauthn-native/webauthn-base64url.js";

describe("base64UrlEncode", () => {
  it("encodes bytes without padding and with URL-safe characters", () => {
    expect(base64UrlEncode(Buffer.from([1, 2, 3, 253, 254, 255]))).toBe(
      "AQID_f7_",
    );
    expect(base64UrlEncode(Buffer.from([9, 9, 9]))).toBe("CQkJ");
  });

  it("round-trips arbitrary bytes through decode", () => {
    const original = Buffer.from([0, 1, 2, 3, 4, 5, 250, 251, 252, 253]);
    expect(base64UrlDecode(base64UrlEncode(original))).toEqual(original);
  });
});

describe("base64UrlDecode", () => {
  it("decodes a string missing its base64 padding", () => {
    expect(base64UrlDecode("CQkJ")).toEqual(Buffer.from([9, 9, 9]));
  });
});

describe("isBase64Url", () => {
  it("accepts only base64url characters", () => {
    expect(isBase64Url("AQID_f7_")).toBe(true);
    expect(isBase64Url("")).toBe(true);
    expect(isBase64Url("AQID+f7/")).toBe(false);
    expect(isBase64Url("has spaces")).toBe(false);
  });
});
