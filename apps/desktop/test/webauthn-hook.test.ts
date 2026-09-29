import { describe, expect, it, vi } from "vitest";
import {
  BB_WEBAUTHN_REJECT_GLOBAL_KEY,
  BB_WEBAUTHN_REQUEST_CHANNEL,
  hasPublicKeyOption,
  installWebauthnHook,
  isConditionalMediation,
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
      },
    );
    expect(postMessage).toHaveBeenNthCalledWith(
      2,
      BB_WEBAUTHN_REQUEST_CHANNEL,
      {
        requestId: 2,
        mode: "create",
      },
    );
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
