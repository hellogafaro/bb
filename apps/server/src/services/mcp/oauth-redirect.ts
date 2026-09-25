import type { ServerAccessStatus } from "@bb/server-contract";

function trimBase(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  return trimmed || null;
}

export function oauthRedirectBase(options: {
  appUrl: string | null;
  publicUrl: string | null;
  loopbackBaseUrl: string;
}): string {
  return (
    trimBase(options.appUrl) ??
    trimBase(options.publicUrl) ??
    options.loopbackBaseUrl
  );
}

export function serverAccessPublicUrl(
  access: ServerAccessStatus,
): string | null {
  const effective = trimBase(access.effectiveUrl);
  if (effective) return effective;
  const urls: string[] = [];
  for (const provider of access.providers) {
    if (provider.availability?.status !== "available") continue;
    const url = trimBase(provider.availability.serverUrl);
    if (!url) continue;
    if (provider.id === access.defaultProviderId) return url;
    urls.push(url);
  }
  return urls[0] ?? null;
}

export function oauthCallbackUrl(base: string, serverId: string): URL {
  const redirect = new URL("/api/v1/mcp/oauth/callback", base);
  redirect.search = new URLSearchParams({ id: serverId }).toString();
  return redirect;
}
