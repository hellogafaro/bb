export const BB_WEBAUTHN_REQUEST_CHANNEL = "webauthn-request";
export const BB_WEBAUTHN_REJECT_GLOBAL_KEY = "__bbWebauthnReject";

export type BbWebauthnRequestMode = "get" | "create";

export interface BbWebauthnRequestMessage {
  requestId: number;
  mode: BbWebauthnRequestMode;
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

export function installWebauthnHook({
  credentials,
  globalTarget,
  postMessage,
}: InstallWebauthnHookArgs): void {
  let nextRequestId = 1;
  const pending = new Map<number, { reject: (error: unknown) => void }>();

  globalTarget[BB_WEBAUTHN_REJECT_GLOBAL_KEY] = (requestId: number): void => {
    const entry = pending.get(requestId);
    if (entry === undefined) {
      return;
    }
    pending.delete(requestId);
    entry.reject(webauthnCancelledError());
  };

  function wrap(
    mode: BbWebauthnRequestMode,
    original: ((options?: unknown) => Promise<unknown>) | undefined,
  ): ((options?: unknown) => Promise<unknown>) | undefined {
    if (original === undefined) {
      return undefined;
    }
    return function hooked(options?: unknown): Promise<unknown> {
      if (!hasPublicKeyOption(options)) {
        return original(options);
      }
      const requestId = nextRequestId++;
      return new Promise((resolve, reject) => {
        pending.set(requestId, { reject });
        postMessage(BB_WEBAUTHN_REQUEST_CHANNEL, { requestId, mode });
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
    ${hasPublicKeyOption.toString()}
    ${webauthnCancelledError.toString()}
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
