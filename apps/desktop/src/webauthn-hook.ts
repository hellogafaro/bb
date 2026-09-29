export const BB_WEBAUTHN_REQUEST_CHANNEL = "webauthn-request";
export const BB_WEBAUTHN_REJECT_GLOBAL_KEY = "__bbWebauthnReject";
export const BB_WEBAUTHN_RESOLVE_GLOBAL_KEY = "__bbWebauthnResolve";

export type BbWebauthnRequestMode = "get" | "create";

export interface BbWebauthnRequestMessage {
  requestId: number;
  mode: BbWebauthnRequestMode;
  options: unknown;
}

export interface WebauthnHookCredentialsContainer {
  get?(options?: unknown): Promise<unknown>;
  create?(options?: unknown): Promise<unknown>;
}

export interface InstallWebauthnHookArgs {
  credentials: WebauthnHookCredentialsContainer;
  globalTarget: Record<string, unknown>;
  postMessage: (channel: string, data: BbWebauthnRequestMessage) => void;
}

export function hasPublicKeyOption(options: unknown): boolean {
  return (
    typeof options === "object" &&
    options !== null &&
    "publicKey" in options &&
    (options as { publicKey?: unknown }).publicKey !== undefined
  );
}

export function isConditionalMediation(options: unknown): boolean {
  return (
    typeof options === "object" &&
    options !== null &&
    "mediation" in options &&
    (options as { mediation?: unknown }).mediation === "conditional"
  );
}

function webauthnCancelledError(): unknown {
  try {
    return new DOMException(
      "The passkey request was cancelled.",
      "NotAllowedError",
    );
  } catch {
    const error = new Error("The passkey request was cancelled.");
    Object.assign(error, { name: "NotAllowedError" });
    return error;
  }
}

function bufferSourceToBase64Url(value: unknown): string | null {
  let bytes: Uint8Array;
  if (value instanceof ArrayBuffer) {
    bytes = new Uint8Array(value);
  } else if (ArrayBuffer.isView(value)) {
    bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  } else {
    return null;
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function serializePublicKeyCredentialDescriptor(
  descriptor: unknown,
): { id: string; type: "public-key"; transports?: string[] } | null {
  if (typeof descriptor !== "object" || descriptor === null) {
    return null;
  }
  const id = bufferSourceToBase64Url((descriptor as { id?: unknown }).id);
  if (id === null) {
    return null;
  }
  const transports = (descriptor as { transports?: unknown }).transports;
  return {
    id,
    type: "public-key",
    ...(Array.isArray(transports) ? { transports } : {}),
  };
}

function serializePublicKeyCredentialDescriptorList(
  list: unknown,
): ReturnType<typeof serializePublicKeyCredentialDescriptor>[] | null {
  if (!Array.isArray(list)) {
    return null;
  }
  const result: ReturnType<typeof serializePublicKeyCredentialDescriptor>[] = [];
  for (const item of list) {
    const serialized = serializePublicKeyCredentialDescriptor(item);
    if (serialized !== null) {
      result.push(serialized);
    }
  }
  return result;
}

export function serializePublicKeyOptions(
  mode: BbWebauthnRequestMode,
  options: unknown,
): unknown {
  const publicKey = (options as { publicKey?: unknown } | null)?.publicKey as
    | Record<string, unknown>
    | undefined;
  if (publicKey === undefined || publicKey.challenge === undefined) {
    return null;
  }
  const challenge = bufferSourceToBase64Url(publicKey.challenge);
  if (challenge === null) {
    return null;
  }

  if (mode === "get") {
    return {
      mode: "get",
      challenge,
      rpId: typeof publicKey.rpId === "string" ? publicKey.rpId : null,
      timeout: typeof publicKey.timeout === "number" ? publicKey.timeout : null,
      userVerification:
        typeof publicKey.userVerification === "string"
          ? publicKey.userVerification
          : null,
      allowCredentials: serializePublicKeyCredentialDescriptorList(
        publicKey.allowCredentials,
      ),
    };
  }

  const rp = publicKey.rp as Record<string, unknown> | undefined;
  const user = publicKey.user as Record<string, unknown> | undefined;
  if (rp === undefined || user === undefined || user.id === undefined) {
    return null;
  }
  const userId = bufferSourceToBase64Url(user.id);
  if (userId === null) {
    return null;
  }
  const pubKeyCredParams = Array.isArray(publicKey.pubKeyCredParams)
    ? publicKey.pubKeyCredParams.map((param: { alg: number }) => ({
        type: "public-key",
        alg: param.alg,
      }))
    : null;
  const rawSelection = publicKey.authenticatorSelection as
    | Record<string, unknown>
    | undefined;
  const authenticatorSelection =
    rawSelection === undefined
      ? null
      : {
          authenticatorAttachment:
            typeof rawSelection.authenticatorAttachment === "string"
              ? rawSelection.authenticatorAttachment
              : null,
          residentKey:
            typeof rawSelection.residentKey === "string"
              ? rawSelection.residentKey
              : null,
          requireResidentKey:
            typeof rawSelection.requireResidentKey === "boolean"
              ? rawSelection.requireResidentKey
              : null,
          userVerification:
            typeof rawSelection.userVerification === "string"
              ? rawSelection.userVerification
              : null,
        };

  return {
    mode: "create",
    rp: {
      id: typeof rp.id === "string" ? rp.id : null,
      name: typeof rp.name === "string" ? rp.name : "",
    },
    user: {
      id: userId,
      name: typeof user.name === "string" ? user.name : "",
      displayName: typeof user.displayName === "string" ? user.displayName : "",
    },
    challenge,
    pubKeyCredParams,
    timeout: typeof publicKey.timeout === "number" ? publicKey.timeout : null,
    excludeCredentials: serializePublicKeyCredentialDescriptorList(
      publicKey.excludeCredentials,
    ),
    authenticatorSelection,
    attestation:
      typeof publicKey.attestation === "string" ? publicKey.attestation : null,
  };
}

export function installWebauthnHook({
  credentials,
  globalTarget,
  postMessage,
}: InstallWebauthnHookArgs): void {
  let nextRequestId = 1;
  const pending = new Map<
    number,
    { resolve: (credential: unknown) => void; reject: (error: unknown) => void }
  >();

  globalTarget[BB_WEBAUTHN_REJECT_GLOBAL_KEY] = (requestId: number): void => {
    const entry = pending.get(requestId);
    if (entry === undefined) {
      return;
    }
    pending.delete(requestId);
    entry.reject(webauthnCancelledError());
  };

  globalTarget[BB_WEBAUTHN_RESOLVE_GLOBAL_KEY] = (
    requestId: number,
    credential: unknown,
  ): void => {
    const entry = pending.get(requestId);
    if (entry === undefined) {
      return;
    }
    pending.delete(requestId);
    entry.resolve(credential);
  };

  function wrap(
    mode: BbWebauthnRequestMode,
    original: ((options?: unknown) => Promise<unknown>) | undefined,
  ): ((options?: unknown) => Promise<unknown>) | undefined {
    if (original === undefined) {
      return undefined;
    }
    return function hooked(options?: unknown): Promise<unknown> {
      if (!hasPublicKeyOption(options) || isConditionalMediation(options)) {
        return original(options);
      }
      const requestId = nextRequestId++;
      const serializedOptions = serializePublicKeyOptions(mode, options);
      return new Promise((resolve, reject) => {
        pending.set(requestId, { resolve, reject });
        postMessage(BB_WEBAUTHN_REQUEST_CHANNEL, {
          requestId,
          mode,
          options: serializedOptions,
        });
      });
    };
  }

  const boundGet = credentials.get?.bind(credentials);
  const boundCreate = credentials.create?.bind(credentials);
  const wrappedGet = wrap("get", boundGet);
  const wrappedCreate = wrap("create", boundCreate);
  if (wrappedGet !== undefined) {
    credentials.get = wrappedGet;
  }
  if (wrappedCreate !== undefined) {
    credentials.create = wrappedCreate;
  }
}

const BB_WEBAUTHN_HOOK_INSTALLED_FLAG = "__bbWebauthnHookInstalled";

export function buildWebauthnMainWorldHookSource(): string {
  return `(() => {
    if (window[${JSON.stringify(BB_WEBAUTHN_HOOK_INSTALLED_FLAG)}]) return;
    window[${JSON.stringify(BB_WEBAUTHN_HOOK_INSTALLED_FLAG)}] = true;
    const BB_WEBAUTHN_REQUEST_CHANNEL = ${JSON.stringify(BB_WEBAUTHN_REQUEST_CHANNEL)};
    const BB_WEBAUTHN_REJECT_GLOBAL_KEY = ${JSON.stringify(BB_WEBAUTHN_REJECT_GLOBAL_KEY)};
    const BB_WEBAUTHN_RESOLVE_GLOBAL_KEY = ${JSON.stringify(BB_WEBAUTHN_RESOLVE_GLOBAL_KEY)};
    ${hasPublicKeyOption.toString()}
    ${isConditionalMediation.toString()}
    ${webauthnCancelledError.toString()}
    ${bufferSourceToBase64Url.toString()}
    ${serializePublicKeyCredentialDescriptor.toString()}
    ${serializePublicKeyCredentialDescriptorList.toString()}
    ${serializePublicKeyOptions.toString()}
    ${installWebauthnHook.toString()}
    if (navigator.credentials) {
      installWebauthnHook({
        credentials: navigator.credentials,
        globalTarget: window,
        postMessage: function (channel, data) {
          document.dispatchEvent(
            new CustomEvent(channel, { detail: JSON.stringify(data) }),
          );
        },
      });
    }
  })();`;
}
