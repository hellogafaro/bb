import { useEffect, useId, useRef, useState } from "react";
import {
  definePluginApp,
  useRpc,
  type PluginMessageDirectiveProps,
  type PluginThreadPanelActionContext,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./contracts.js";
import { PREVIEW_DIRECTIVE_ID } from "./preview-directive.js";

const PANEL_ACTION_ID = "computer";

function useLiveFrame(hostId: string | null, active: boolean) {
  const rpc = useRpc<typeof rpcContract>();
  const viewerId = useId();
  const [frame, setFrame] = useState<{ src: string; state: string } | null>(null);
  const sequence = useRef<number | null>(null);
  useEffect(() => {
    if (hostId === null || !active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = () => {
      rpc
        .call("preview", { hostId, viewerId, afterSequence: sequence.current })
        .then((result) => {
          if (stopped) return;
          if (result.dataBase64 !== null && result.mimeType !== null) {
            sequence.current = result.sequence;
            setFrame({ src: `data:${result.mimeType};base64,${result.dataBase64}`, state: result.state });
          } else if (result.state !== "none") {
            setFrame((prev) => (prev === null ? null : { ...prev, state: result.state }));
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!stopped) timer = setTimeout(poll, 500);
        });
    };
    poll();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [hostId, active, rpc, viewerId]);
  return frame;
}

function ControlBanner({ hostId }: { hostId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const clientId = useId();
  const [owner, setOwner] = useState<"agent" | "human">("agent");
  const takeControl = () => {
    rpc
      .call("takeControl", { hostId, clientId })
      .then((result) => setOwner(result.owner === "human" ? "human" : "agent"))
      .catch(() => {});
  };
  const release = () => {
    rpc.call("releaseControl", { hostId, clientId }).then(() => setOwner("agent")).catch(() => {});
  };
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        {owner === "human" ? "Controlled by you" : "Controlled by the agent when a run is active"}
      </span>
      <div className="flex gap-2">
        {owner === "human" ? (
          <button
            type="button"
            onClick={release}
            className="rounded border border-border px-2 py-1 hover:bg-background"
          >
            Release
          </button>
        ) : (
          <button
            type="button"
            onClick={takeControl}
            className="rounded border border-border px-2 py-1 hover:bg-background"
          >
            Take control
          </button>
        )}
      </div>
    </div>
  );
}

function LiveView({ hostId, active }: { hostId: string; active: boolean }) {
  const frame = useLiveFrame(hostId, active);
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-black/90">
      {frame === null ? (
        <p className="text-xs text-muted-foreground">Waiting for a frame…</p>
      ) : (
        <img src={frame.src} alt="Live machine view" className="max-h-full max-w-full object-contain" />
      )}
    </div>
  );
}

function ComputerPanel({ params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const parsedHostId = typeof params === "object" && params !== null && "hostId" in params && typeof (params as Record<string, unknown>).hostId === "string"
    ? ((params as Record<string, unknown>).hostId as string)
    : null;
  const [hostId, setHostId] = useState<string | null>(parsedHostId);
  const [machines, setMachines] = useState<{ hostId: string; name: string }[]>([]);
  useEffect(() => {
    rpc.call("machines", {}).then((result) => setMachines(result.machines)).catch(() => {});
  }, [rpc]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <label htmlFor="computer-machine">Machine</label>
        <select
          id="computer-machine"
          value={hostId ?? ""}
          onChange={(event) => setHostId(event.target.value === "" ? null : event.target.value)}
          className="rounded border border-border bg-background px-2 py-1"
        >
          <option value="">Select a machine…</option>
          {machines.map((machine) => (
            <option key={machine.hostId} value={machine.hostId}>
              {machine.name}
            </option>
          ))}
        </select>
      </div>
      {hostId === null ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Select a machine to observe or control it.
        </div>
      ) : (
        <>
          <ControlBanner hostId={hostId} />
          <LiveView hostId={hostId} active={true} />
        </>
      )}
    </div>
  );
}

function ComputerPreviewDirective({ attributes }: PluginMessageDirectiveProps) {
  const hostId = attributes.host ?? null;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="my-1 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between px-3 py-2 text-xs">
        <span>Computer — {hostId ?? "unknown machine"}</span>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="rounded border border-border px-2 py-1 hover:bg-muted"
        >
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>
      {expanded && hostId !== null ? (
        <div className="h-64">
          <LiveView hostId={hostId} active={expanded} />
        </div>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.messageDirective({
    id: PREVIEW_DIRECTIVE_ID,
    component: ComputerPreviewDirective,
  });
  app.slots.threadPanelAction({
    id: PANEL_ACTION_ID,
    title: "Computer",
    icon: "Monitor",
    component: ComputerPanel,
    layout: "flush",
    run: ({ openPanel }) => {
      openPanel({ title: "Computer", params: null });
    },
  });
});
