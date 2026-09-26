import { useEffect, useMemo, useState } from "react";
import {
  definePluginApp,
  type PluginFileOpenerProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@bb/shared-ui/icon";
import { loadPdfBlob, resolvePdfReadTarget } from "./pdf-source.js";

type PreviewState =
  | { status: "loading" }
  | { status: "ready"; frameLoaded: boolean; url: string }
  | { status: "error"; message: string };

function PdfFileOpener({ path, source, Original }: PluginFileOpenerProps) {
  const [reloadNonce, setReloadNonce] = useState(0);
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const target = useMemo(
    () => resolvePdfReadTarget(path, source),
    [
      path,
      source.environmentId,
      source.kind,
      source.projectId,
      source.threadId,
    ],
  );

  useEffect(() => {
    if (target === null) return;

    const controller = new AbortController();
    let objectUrl: string | null = null;
    setState({ status: "loading" });

    void loadPdfBlob(target, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setState({ status: "ready", frameLoaded: false, url: objectUrl });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      controller.abort();
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [reloadNonce, target]);

  if (target === null) return <Original />;

  if (state.status === "error") {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6">
        <div className="max-w-md space-y-3 text-center" role="alert">
          <p className="text-sm text-destructive">
            Failed to load PDF: {state.message}
          </p>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onClick={() => setReloadNonce((current) => current + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        className="flex h-full min-h-0 items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
        aria-label={`Loading ${path}`}
      >
        <Icon name="Spinner" className="size-4 animate-spin" aria-hidden="true" />
        Loading PDF…
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0 overflow-hidden bg-background">
      {state.frameLoaded ? null : (
        <div
          className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background text-sm text-muted-foreground"
          role="status"
          aria-label={`Rendering ${path}`}
        >
          <Icon name="Spinner" className="size-4 animate-spin" aria-hidden="true" />
          Rendering PDF…
        </div>
      )}
      <iframe
        src={state.url}
        title={path}
        className="block h-full w-full border-0"
        onLoad={() => {
          setState((current) =>
            current.status === "ready"
              ? { ...current, frameLoaded: true }
              : current,
          );
        }}
        onError={() => {
          setState({
            status: "error",
            message: "The browser could not open the PDF viewer.",
          });
        }}
      />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.fileOpener({
    id: "pdf",
    title: "PDF viewer",
    extensions: ["pdf"],
    component: PdfFileOpener,
  });
});
