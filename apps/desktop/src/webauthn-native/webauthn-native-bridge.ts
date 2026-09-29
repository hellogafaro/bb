import { execFile } from "node:child_process";
import { join } from "node:path";
import {
  nativeWebauthnResponseSchema,
  type NativeWebauthnRequest,
  type NativeWebauthnResponse,
} from "./webauthn-native-protocol.js";

export const WEBAUTHN_HELPER_EXECUTABLE = "bb-webauthn-helper";
export const WEBAUTHN_HELPER_TIMEOUT_MS = 120_000;

export function webauthnHelperExecutablePath(resourcesPath: string): string {
  return join(resourcesPath, "webauthn-helper", WEBAUTHN_HELPER_EXECUTABLE);
}

export type WebauthnHelperExec = (
  executablePath: string,
  input: string,
) => Promise<{ stdout: string }>;

export const execWebauthnHelper: WebauthnHelperExec = (executablePath, input) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      executablePath,
      ["request"],
      { timeout: WEBAUTHN_HELPER_TIMEOUT_MS, maxBuffer: 1_000_000 },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout });
      },
    );
    child.stdin?.end(input);
  });

export async function runNativeWebauthnRequest(
  executablePath: string,
  request: NativeWebauthnRequest,
  exec: WebauthnHelperExec = execWebauthnHelper,
): Promise<NativeWebauthnResponse> {
  const { stdout } = await exec(executablePath, JSON.stringify(request));
  let rawResponse: unknown;
  try {
    rawResponse = JSON.parse(stdout);
  } catch {
    return {
      ok: false,
      errorName: "UnknownError",
      message: "The native passkey helper returned an unrecognized response",
    };
  }
  const parsed = nativeWebauthnResponseSchema.safeParse(rawResponse);
  if (!parsed.success) {
    return {
      ok: false,
      errorName: "UnknownError",
      message: "The native passkey helper returned an unrecognized response",
    };
  }
  return parsed.data;
}
