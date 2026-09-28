import { useEffect, useId, useRef, useState } from "react";
import type { PluginMessageDirectiveProps } from "@get-bb/plugin-sdk";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import type { PluginMessageDirectiveSlot } from "@/lib/plugin-slots";
import { ComputerLiveView } from "./ComputerLiveView";
import {
  closeComputerLightbox,
  openComputerLightbox,
  useComputerLightboxTarget,
} from "./computer-lightbox-store";

export const COMPUTER_PREVIEW_DIRECTIVE_ID = "computer-preview";

function useInViewport<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inViewport, setInViewport] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (node === null || typeof IntersectionObserver === "undefined") {
      setInViewport(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setInViewport(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.2 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, inViewport];
}

function ComputerPreviewDirective({ attributes }: PluginMessageDirectiveProps) {
  const hostId = attributes.host ?? null;
  const clientId = useId();
  const [ref, inViewport] = useInViewport<HTMLDivElement>();
  return (
    <div ref={ref} className="my-1 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <span>Computer — {hostId ?? "unknown machine"}</span>
        <button
          type="button"
          onClick={() => hostId !== null && openComputerLightbox(hostId)}
          disabled={hostId === null}
          className="rounded border border-border px-2 py-1 hover:bg-muted disabled:opacity-50"
        >
          Expand
        </button>
      </div>
      {hostId !== null ? (
        <div className="h-64">
          <ComputerLiveView hostId={hostId} active={inViewport} profile="thumbnail" clientId={clientId} />
        </div>
      ) : null}
    </div>
  );
}

export const CORE_COMPUTER_PREVIEW_DIRECTIVE_SLOT: PluginMessageDirectiveSlot = {
  id: COMPUTER_PREVIEW_DIRECTIVE_ID,
  pluginId: "core",
  generation: 0,
  component: ComputerPreviewDirective,
};

export function ComputerPreviewLightbox() {
  const hostId = useComputerLightboxTarget();
  const clientId = useId();
  return (
    <Dialog
      open={hostId !== null}
      onOpenChange={(open) => {
        if (!open) closeComputerLightbox();
      }}
    >
      <DialogContent className="max-w-6xl gap-3 p-4">
        <DialogHeader>
          <DialogTitle className="truncate pr-8 text-sm">Computer — {hostId ?? ""}</DialogTitle>
        </DialogHeader>
        {hostId !== null ? (
          <div className="h-[70dvh]">
            <ComputerLiveView hostId={hostId} active={hostId !== null} profile="full" clientId={clientId} />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
