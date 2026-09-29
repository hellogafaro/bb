import type {
  DesktopBrowserImportSource,
  DesktopBrowserImportSourceProfile,
  DesktopBrowserImportUnavailableReason,
} from "@bb/host-daemon-contract";

export type WebauthnImportPick =
  | {
      ok: true;
      source: DesktopBrowserImportSource;
      profile: DesktopBrowserImportSourceProfile;
    }
  | { ok: false; reason: DesktopBrowserImportUnavailableReason | null };

const PREFERRED_SOURCE_ID = "chrome";

function bestProfile(
  source: DesktopBrowserImportSource,
): DesktopBrowserImportSourceProfile | null {
  if (source.profiles.length === 0) {
    return null;
  }
  return source.profiles.reduce((best, candidate) =>
    (candidate.cookieCount ?? 0) > (best.cookieCount ?? 0) ? candidate : best,
  );
}

export function pickWebauthnImportSource(
  sources: readonly DesktopBrowserImportSource[],
): WebauthnImportPick {
  const ready = sources.filter(
    (source) => source.unavailable === undefined && source.profiles.length > 0,
  );
  const preferred =
    ready.find((source) => source.id === PREFERRED_SOURCE_ID) ?? ready[0];
  if (preferred !== undefined) {
    const profile = bestProfile(preferred);
    if (profile !== null) {
      return { ok: true, source: preferred, profile };
    }
  }
  const fallbackReasonSource =
    sources.find((source) => source.id === PREFERRED_SOURCE_ID) ?? sources[0];
  return {
    ok: false,
    reason: fallbackReasonSource?.unavailable ?? null,
  };
}
