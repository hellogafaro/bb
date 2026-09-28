export type ComputerPermissionState = "granted" | "denied" | "unknown";

export interface ComputerPermissionStatus {
  readonly accessibility: ComputerPermissionState;
  readonly screenRecording: ComputerPermissionState;
}

const UNKNOWN: ComputerPermissionStatus = { accessibility: "unknown", screenRecording: "unknown" };

function normalize(value: unknown): ComputerPermissionState {
  if (typeof value === "boolean") return value ? "granted" : "denied";
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (/^(granted|authorized|allowed|ok|true|yes|enabled)$/.test(text)) return "granted";
    if (/^(denied|not[ _-]?granted|missing|false|no|disabled|restricted)$/.test(text)) return "denied";
    return "unknown";
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["granted", "status", "state", "value", "authorized"]) {
      if (key in record) return normalize(record[key]);
    }
  }
  return "unknown";
}

function findKey(record: Record<string, unknown>, pattern: RegExp): unknown {
  for (const [key, value] of Object.entries(record)) {
    if (pattern.test(key)) return value;
  }
  for (const value of Object.values(record)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      const nested = findKey(value as Record<string, unknown>, pattern);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
}

export function parseComputerPermissionStatus(stdout: string): ComputerPermissionStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return UNKNOWN;
  }
  if (parsed === null || typeof parsed !== "object") return UNKNOWN;
  const record = parsed as Record<string, unknown>;
  const accessibility = findKey(record, /accessibility/i);
  const screenRecording = findKey(record, /screen[ _-]?(recording|capture)/i);
  return {
    accessibility: accessibility === undefined ? "unknown" : normalize(accessibility),
    screenRecording: screenRecording === undefined ? "unknown" : normalize(screenRecording),
  };
}

export const MACOS_PRIVACY_PANES = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screenRecording: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
} as const;
