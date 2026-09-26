import { useRouteStateHistoryNavigation } from "@/lib/app-route-history";

export function RouteHistoryControls() {
  const { canGoBack, canGoForward, goBack, goForward } =
    useRouteStateHistoryNavigation();
  return (
    <div>
      <button
        type="button"
        aria-label="Go back"
        disabled={!canGoBack}
        onClick={goBack}
      >
        Go back
      </button>
      <button
        type="button"
        aria-label="Go forward"
        disabled={!canGoForward}
        onClick={goForward}
      >
        Go forward
      </button>
    </div>
  );
}
