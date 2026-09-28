const RELOADED_FOR_KEY = "bb.staleBuild.reloadedFor";

function failedModuleUrl(event: Event): string {
  const payload = (event as Event & { payload?: unknown }).payload;
  if (payload instanceof Error) {
    const match = /https?:\/\/\S+/.exec(payload.message);
    return match?.[0] ?? payload.message;
  }
  return String(payload ?? "unknown");
}

export function installStaleBuildRecovery(
  target: Pick<Window, "addEventListener" | "sessionStorage"> & {
    location: Pick<Location, "reload">;
  } = window,
): void {
  target.addEventListener("vite:preloadError", (event) => {
    const url = failedModuleUrl(event);
    let alreadyReloaded = false;
    try {
      alreadyReloaded = target.sessionStorage.getItem(RELOADED_FOR_KEY) === url;
      target.sessionStorage.setItem(RELOADED_FOR_KEY, url);
    } catch {
      alreadyReloaded = false;
    }
    if (alreadyReloaded) return;
    event.preventDefault();
    target.location.reload();
  });
}
