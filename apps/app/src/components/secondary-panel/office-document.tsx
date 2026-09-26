import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@bb/shared-ui/button";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { SourceLoadingSkeleton } from "@/components/code/code-loading-skeletons";
import { appSurfaceRequestInit } from "@/lib/app-surface";

export const OFFICE_PREVIEW_MAX_BYTES = 20 * 1024 * 1024;

export type OfficeDocumentState<T> =
  | { status: "loading" }
  | { status: "ready"; value: T }
  | { status: "too-large" }
  | { status: "error"; message: string };

class OfficeDocumentTooLargeError extends Error {}

async function fetchOfficeDocumentBytes(
  url: string,
  signal: AbortSignal,
): Promise<ArrayBuffer> {
  const response = await fetch(
    url,
    appSurfaceRequestInit({ method: "GET", signal }),
  );
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get("content-length"));
  if (declaredLength > OFFICE_PREVIEW_MAX_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new OfficeDocumentTooLargeError();
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > OFFICE_PREVIEW_MAX_BYTES) {
    throw new OfficeDocumentTooLargeError();
  }
  return bytes;
}

export function useOfficeDocument<T>(
  url: string,
  parse: (bytes: ArrayBuffer) => Promise<T> | T,
  reloadKey: number,
): OfficeDocumentState<T> {
  const [state, setState] = useState<OfficeDocumentState<T>>({
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void fetchOfficeDocumentBytes(url, controller.signal)
      .then((bytes) => parse(bytes))
      .then((value) => {
        if (!controller.signal.aborted) setState({ status: "ready", value });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState(
          error instanceof OfficeDocumentTooLargeError
            ? { status: "too-large" }
            : {
                status: "error",
                message: error instanceof Error ? error.message : String(error),
              },
        );
      });
    return () => controller.abort();
  }, [parse, reloadKey, url]);

  return state;
}

interface PreviewLoadFailureProps {
  message: string;
  onRetry: () => void;
}

export function PreviewLoadFailure({
  message,
  onRetry,
}: PreviewLoadFailureProps) {
  return (
    <EmptyStatePanel
      role="alert"
      className="mx-4 mt-4 flex flex-col items-center gap-3 rounded-lg"
    >
      <p className="text-destructive">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </EmptyStatePanel>
  );
}

interface OfficeDocumentStatusProps {
  fallback: ReactNode;
  onRetry: () => void;
  state: Exclude<OfficeDocumentState<unknown>, { status: "ready" }>;
}

export function OfficeDocumentStatus({
  fallback,
  onRetry,
  state,
}: OfficeDocumentStatusProps) {
  if (state.status === "loading") {
    return <SourceLoadingSkeleton />;
  }
  if (state.status === "too-large") {
    return fallback;
  }
  return (
    <PreviewLoadFailure
      message={`Failed to load preview: ${state.message}`}
      onRetry={onRetry}
    />
  );
}
