import { describe, expect, it } from "vitest";
import {
  runNativeWebauthnRequest,
  webauthnHelperExecutablePath,
  type WebauthnHelperExec,
} from "../src/webauthn-native/webauthn-native-bridge.js";
import type { NativeWebauthnRequest } from "../src/webauthn-native/webauthn-native-protocol.js";

const GET_REQUEST: NativeWebauthnRequest = {
  mode: "get",
  origin: "https://example.com",
  rpId: "example.com",
  clientDataHash: "AQID",
  allowCredentials: [],
  userVerification: "preferred",
};

describe("webauthnHelperExecutablePath", () => {
  it("resolves the helper binary inside a webauthn-helper resources subdirectory", () => {
    expect(webauthnHelperExecutablePath("/Applications/bb.app/Contents/Resources")).toBe(
      "/Applications/bb.app/Contents/Resources/webauthn-helper/bb-webauthn-helper",
    );
  });
});

describe("runNativeWebauthnRequest", () => {
  it("sends the JSON request on stdin and parses a successful JSON response", async () => {
    let sentInput = "";
    const exec: WebauthnHelperExec = async (executablePath, input) => {
      sentInput = input;
      expect(executablePath).toBe("/path/to/helper");
      return {
        stdout: JSON.stringify({
          ok: true,
          mode: "get",
          id: "cred-id",
          rawId: "cred-raw-id",
          authenticatorData: "auth-data",
          signature: "sig",
          userHandle: null,
          authenticatorAttachment: "platform",
        }),
      };
    };

    const response = await runNativeWebauthnRequest(
      "/path/to/helper",
      GET_REQUEST,
      exec,
    );

    expect(JSON.parse(sentInput)).toEqual(GET_REQUEST);
    expect(response).toEqual({
      ok: true,
      mode: "get",
      id: "cred-id",
      rawId: "cred-raw-id",
      authenticatorData: "auth-data",
      signature: "sig",
      userHandle: null,
      authenticatorAttachment: "platform",
    });
  });

  it("parses a failure response from the helper", async () => {
    const exec: WebauthnHelperExec = async () => ({
      stdout: JSON.stringify({
        ok: false,
        errorName: "NotAllowedError",
        message: "The user cancelled the request",
      }),
    });

    const response = await runNativeWebauthnRequest(
      "/path/to/helper",
      GET_REQUEST,
      exec,
    );

    expect(response).toEqual({
      ok: false,
      errorName: "NotAllowedError",
      message: "The user cancelled the request",
    });
  });

  it("treats an unparsable response as an UnknownError failure instead of throwing", async () => {
    const exec: WebauthnHelperExec = async () => ({ stdout: "not json" });

    const response = await runNativeWebauthnRequest(
      "/path/to/helper",
      GET_REQUEST,
      exec,
    );

    expect(response.ok).toBe(false);
    expect(response).toMatchObject({ errorName: "UnknownError" });
  });

  it("propagates a spawn error (e.g. missing helper binary) to the caller", async () => {
    const exec: WebauthnHelperExec = async () => {
      throw new Error("spawn ENOENT");
    };

    await expect(
      runNativeWebauthnRequest("/path/to/helper", GET_REQUEST, exec),
    ).rejects.toThrow("spawn ENOENT");
  });
});
