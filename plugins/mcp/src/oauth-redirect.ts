export function oauthRedirectBase(options: {
  setting?: string | null;
  appUrl?: string | null;
  publicUrl?: string | null;
  loopbackBaseUrl: string;
}): string {
  const setting = trimBase(options.setting);
  if (setting) return setting;
  const appUrl = trimBase(options.appUrl);
  if (appUrl) return appUrl;
  const publicUrl = trimBase(options.publicUrl);
  if (publicUrl) return publicUrl;
  return options.loopbackBaseUrl;
}

export function serverAppUrl(server: object): string | null {
  if (!("experimental_appUrl" in server)) return null;
  const value = (server as { experimental_appUrl?: unknown }).experimental_appUrl;
  return typeof value === "string" ? value : null;
}

export function serverAccessPublicUrl(config: unknown): string | null {
  if (!config || typeof config !== "object") return null;
  const access = (config as { serverAccess?: unknown }).serverAccess;
  if (!access || typeof access !== "object") return null;
  const rec = access as {
    effectiveUrl?: unknown;
    defaultProviderId?: unknown;
    providers?: unknown;
  };
  const effective = trimBase(typeof rec.effectiveUrl === "string" ? rec.effectiveUrl : null);
  if (effective) return effective;
  if (!Array.isArray(rec.providers)) return null;
  const preferredId = typeof rec.defaultProviderId === "string" ? rec.defaultProviderId : null;
  const urls: string[] = [];
  for (const provider of rec.providers) {
    if (!provider || typeof provider !== "object") continue;
    const avail = (provider as { availability?: unknown }).availability;
    if (!avail || typeof avail !== "object") continue;
    if ((avail as { status?: unknown }).status !== "available") continue;
    const url = trimBase(
      typeof (avail as { serverUrl?: unknown }).serverUrl === "string"
        ? (avail as { serverUrl: string }).serverUrl
        : null,
    );
    if (!url) continue;
    if (preferredId && (provider as { id?: unknown }).id === preferredId) return url;
    urls.push(url);
  }
  return urls[0] ?? null;
}

function trimBase(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}
