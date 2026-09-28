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

function ComputerPreviewDirective({ attributes }: PluginMessageDirectiveProps) {
  const hostId = attributes.host ?? null;
  return (
    <div className="my-1 overflow-hidden rounded-lg border border-border">
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
          <ComputerLiveView hostId={hostId} active={true} />
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
            <ComputerLiveView hostId={hostId} active={hostId !== null} size="full" />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
