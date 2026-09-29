import { describe, expect, it, vi } from "vitest";
import {
  BB_WEBAUTHN_REJECT_GLOBAL_KEY,
  BB_WEBAUTHN_REQUEST_CHANNEL,
  BB_WEBAUTHN_RESOLVE_GLOBAL_KEY,
  hasPublicKeyOption,
  installWebauthnHook,
  isConditionalMediation,
  serializePublicKeyOptions,
  type WebauthnHookCredentialsContainer,
} from "../src/webauthn-hook.js";

function setup() {
  const originalGet = vi.fn().mockResolvedValue("plain-credential");
  const originalCreate = vi.fn().mockResolvedValue("plain-created-credential");
  const credentials: WebauthnHookCredentialsContainer = {
    get: originalGet,
    create: originalCreate,
  };
  const globalTarget: Record<string, unknown> = {};
  const postMessage = vi.fn();
  installWebauthnHook({ credentials, globalTarget, postMessage });
  return {
    credentials,
    globalTarget,
    postMessage,
    originalGet,
    originalCreate,
  };
}

describe("hasPublicKeyOption", () => {
  it("detects a publicKey option", () => {
    expect(hasPublicKeyOption({ publicKey: {} })).toBe(true);
  });

  it("rejects missing, undefined, or non-object options", () => {
    expect(hasPublicKeyOption(undefined)).toBe(false);
    expect(hasPublicKeyOption({})).toBe(false);
    expect(hasPublicKeyOption({ publicKey: undefined })).toBe(false);
    expect(hasPublicKeyOption("publicKey")).toBe(false);
    expect(hasPublicKeyOption(null)).toBe(false);
  });
});

describe("isConditionalMediation", () => {
  it('detects mediation: "conditional"', () => {
    expect(isConditionalMediation({ mediation: "conditional" })).toBe(true);
  });

  it("rejects other mediation values and missing, undefined, or non-object options", () => {
    expect(isConditionalMediation({ mediation: "required" })).toBe(false);
    expect(isConditionalMediation({ mediation: "optional" })).toBe(false);
    expect(isConditionalMediation({})).toBe(false);
    expect(isConditionalMediation({ mediation: undefined })).toBe(false);
    expect(isConditionalMediation(undefined)).toBe(false);
    expect(isConditionalMediation(null)).toBe(false);
  });
});

describe("installWebauthnHook", () => {
  it("passes a conditional-mediation publicKey get() straight through without ever prompting or rejecting, for passkey autofill on page load", async () => {
    const { credentials, postMessage, originalGet } = setup();
    await expect(
      credentials.get?.({
        publicKey: { rpId: "example.com" },
        mediation: "conditional",
      }),
    ).resolves.toBe("plain-credential");
    expect(postMessage).not.toHaveBeenCalled();
    expect(originalGet).toHaveBeenCalledWith({
      publicKey: { rpId: "example.com" },
      mediation: "conditional",
    });
  });

  it("still intercepts an explicit (non-conditional) publicKey get() even when other mediation values are set", async () => {
    const { credentials, postMessage, originalGet } = setup();
    void credentials.get?.({
      publicKey: { rpId: "example.com" },
      mediation: "required",
    });
    await Promise.resolve();
    expect(originalGet).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(BB_WEBAUTHN_REQUEST_CHANNEL, {
      requestId: 1,
      mode: "get",
      options: null,
    });
  });

  it("passes calls without a publicKey option straight through, preserving feature detection", async () => {
    const { credentials, postMessage, originalGet } = setup();
    await expect(credentials.get?.({ password: true })).resolves.toBe(
      "plain-credential",
    );
    expect(postMessage).not.toHaveBeenCalled();
    expect(originalGet).toHaveBeenCalledWith({ password: true });
    expect(typeof credentials.get).toBe("function");
  });

  it("intercepts a publicKey get() call and posts a webauthn-request message instead of hanging or resolving", async () => {
    const { credentials, postMessage, originalGet } = setup();
    let settled = false;
    const promise = credentials.get?.({ publicKey: { rpId: "example.com" } });
    void promise?.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(originalGet).not.toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(postMessage).toHaveBeenCalledWith(BB_WEBAUTHN_REQUEST_CHANNEL, {
      requestId: 1,
      mode: "get",
      options: null,
    });
  });

  it("intercepts a publicKey create() call with its own request id", async () => {
    const { credentials, postMessage, originalCreate } = setup();
    void credentials.create?.({ publicKey: { rp: { id: "example.com" } } });
    await Promise.resolve();
    expect(originalCreate).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledWith(BB_WEBAUTHN_REQUEST_CHANNEL, {
      requestId: 1,
      mode: "create",
      options: null,
    });
  });

  it("rejects the pending promise with NotAllowedError when the exposed reject function is called", async () => {
    const { credentials, globalTarget } = setup();
    const promise = credentials.get?.({ publicKey: {} });
    await Promise.resolve();
    const reject = globalTarget[BB_WEBAUTHN_REJECT_GLOBAL_KEY] as (
      requestId: number,
    ) => void;
    expect(typeof reject).toBe("function");
    reject(1);
    await expect(promise).rejects.toMatchObject({ name: "NotAllowedError" });
  });

  it("ignores reject calls for unknown or already-settled request ids", async () => {
    const { credentials, globalTarget } = setup();
    const promise = credentials.get?.({ publicKey: {} });
    await Promise.resolve();
    const reject = globalTarget[BB_WEBAUTHN_REJECT_GLOBAL_KEY] as (
      requestId: number,
    ) => void;
    reject(1);
    await expect(promise).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(() => reject(1)).not.toThrow();
    expect(() => reject(999)).not.toThrow();
  });

  it("assigns independent, increasing request ids across multiple pending requests", async () => {
    const { credentials, postMessage } = setup();
    void credentials.get?.({ publicKey: {} });
    void credentials.create?.({ publicKey: {} });
    await Promise.resolve();
    expect(postMessage).toHaveBeenNthCalledWith(
      1,
      BB_WEBAUTHN_REQUEST_CHANNEL,
      {
        requestId: 1,
        mode: "get",
        options: null,
      },
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      BB_WEBAUTHN_REQUEST_CHANNEL,
      {
        requestId: 2,
        mode: "create",
        options: null,
      },
    );
  });

  it("resolves the pending promise with a credential when the exposed resolve function is called", async () => {
    const { credentials, globalTarget } = setup();
    const promise = credentials.get?.({ publicKey: {} });
    await Promise.resolve();
    const resolve = globalTarget[BB_WEBAUTHN_RESOLVE_GLOBAL_KEY] as (
      requestId: number,
      credential: unknown,
    ) => void;
    expect(typeof resolve).toBe("function");
    resolve(1, { id: "credential-1" });
    await expect(promise).resolves.toEqual({ id: "credential-1" });
  });

  it("ignores resolve calls for unknown or already-settled request ids", async () => {
    const { credentials, globalTarget } = setup();
    const promise = credentials.get?.({ publicKey: {} });
    await Promise.resolve();
    const resolve = globalTarget[BB_WEBAUTHN_RESOLVE_GLOBAL_KEY] as (
      requestId: number,
      credential: unknown,
    ) => void;
    resolve(1, { id: "credential-1" });
    await expect(promise).resolves.toEqual({ id: "credential-1" });
    expect(() => resolve(1, { id: "ignored" })).not.toThrow();
    expect(() => resolve(999, { id: "ignored" })).not.toThrow();
  });

  it("does nothing when the container has no get/create methods", () => {
    const globalTarget: Record<string, unknown> = {};
    expect(() =>
      installWebauthnHook({
        credentials: {},
        globalTarget,
        postMessage: vi.fn(),
      }),
    ).not.toThrow();
    expect(typeof globalTarget[BB_WEBAUTHN_REJECT_GLOBAL_KEY]).toBe("function");
  });
});

describe("serializePublicKeyOptions", () => {
  it("returns null when the publicKey option or its challenge is missing", () => {
    expect(serializePublicKeyOptions("get", { publicKey: {} })).toBeNull();
    expect(serializePublicKeyOptions("get", {})).toBeNull();
  });

  it("serializes a get() request's BufferSource fields to base64url", () => {
    const challenge = new Uint8Array([1, 2, 3, 253, 254, 255]).buffer;
    const credentialId = new Uint8Array([9, 9, 9]).buffer;
    const serialized = serializePublicKeyOptions("get", {
      publicKey: {
        challenge,
        rpId: "example.com",
        timeout: 60000,
        userVerification: "required",
        allowCredentials: [{ id: credentialId, type: "public-key", transports: ["internal"] }],
      },
    });
    expect(serialized).toEqual({
      mode: "get",
      challenge: "AQID_f7_",
      rpId: "example.com",
      timeout: 60000,
      userVerification: "required",
      allowCredentials: [{ id: "CQkJ", type: "public-key", transports: ["internal"] }],
    });
  });

  it("serializes a create() request's rp/user/challenge fields to base64url", () => {
    const challenge = new Uint8Array([10, 20, 30]).buffer;
    const userId = new Uint8Array([1, 1, 1, 1]).buffer;
    const serialized = serializePublicKeyOptions("create", {
      publicKey: {
        rp: { id: "example.com", name: "Example" },
        user: { id: userId, name: "user@example.com", displayName: "User" },
        challenge,
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { userVerification: "preferred", residentKey: "required" },
        attestation: "none",
      },
    });
    expect(serialized).toEqual({
      mode: "create",
      rp: { id: "example.com", name: "Example" },
      user: { id: "AQEBAQ", name: "user@example.com", displayName: "User" },
      challenge: "ChQe",
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: null,
      excludeCredentials: null,
      authenticatorSelection: {
        authenticatorAttachment: null,
        residentKey: "required",
        requireResidentKey: null,
        userVerification: "preferred",
      },
      attestation: "none",
    });
  });

  it("returns null for a create() request missing rp or user", () => {
    expect(
      serializePublicKeyOptions("create", {
        publicKey: { challenge: new Uint8Array([1]).buffer },
      }),
    ).toBeNull();
  });
});
