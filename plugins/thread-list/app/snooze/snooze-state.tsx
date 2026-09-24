import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import {
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { ThreadListEntry } from "@bb/domain";
import type { threadListRpcContract } from "../../server.js";
import { SNOOZES_CHANGED_CHANNEL, type Snooze } from "../../shared/snoozes.js";
import { canSnoozeThreads } from "../model/status-sections.js";

export interface ThreadSnoozeState {
  snoozesByThreadId: ReadonlyMap<string, Snooze>;
  now: number;
  activeSnooze(threadId: string): Snooze | null;
  isSnoozeRoot(threadId: string): boolean;
  canSnooze(threadId: string): boolean;
  snooze(threadId: string, until: number): void;
  unsnooze(threadId: string): void;
  openCustom(threadId: string): void;
}

export const ThreadSnoozeContext = createContext<ThreadSnoozeState | null>(
  null,
);

export function useThreadSnoozeState(): ThreadSnoozeState | null {
  return useContext(ThreadSnoozeContext);
}

const CUSTOM_SNOOZE_EVENT = "bb:thread-list:snooze-custom";
let mountedSnoozeProviders = 0;

export function isSnoozeAvailable(): boolean {
  return mountedSnoozeProviders > 0;
}

export function requestCustomSnooze(threadId: string): void {
  window.dispatchEvent(
    new CustomEvent<string>(CUSTOM_SNOOZE_EVENT, { detail: threadId }),
  );
}

export function useCustomSnoozeRequests(onRequest: (threadId: string) => void) {
  const latest = useRef(onRequest);
  latest.current = onRequest;
  useEffect(() => {
    mountedSnoozeProviders += 1;
    const listener = (event: Event) => {
      if (event instanceof CustomEvent && typeof event.detail === "string") {
        latest.current(event.detail);
      }
    };
    window.addEventListener(CUSTOM_SNOOZE_EVENT, listener);
    return () => {
      mountedSnoozeProviders -= 1;
      window.removeEventListener(CUSTOM_SNOOZE_EVENT, listener);
    };
  }, []);
}

export function useSnoozeList() {
  const rpc = useRpc<typeof threadListRpcContract>();
  const [snoozes, setSnoozes] = useState<Snooze[]>([]);
  const generation = useRef(0);
  const refresh = useCallback(() => {
    const request = ++generation.current;
    rpc.call("listSnoozes", null).then(
      (result) => {
        if (request === generation.current) setSnoozes(result.snoozes);
      },
      () => undefined,
    );
  }, [rpc]);
  useEffect(() => {
    refresh();
    return () => {
      generation.current += 1;
    };
  }, [refresh]);
  useRealtime(SNOOZES_CHANGED_CHANNEL, refresh);
  const connection = useRealtimeConnectionState();
  useEffect(() => {
    if (connection === "connected") refresh();
  }, [connection, refresh]);
  const apply = useCallback((next: Snooze[]) => {
    generation.current += 1;
    setSnoozes(next);
  }, []);
  const snooze = useCallback(
    (threadId: string, until: number) => {
      rpc.call("snooze", { threadId, until }).then(
        (result) => apply(result.snoozes),
        (error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not snooze the thread.",
          );
        },
      );
    },
    [apply, rpc],
  );
  const unsnooze = useCallback(
    (threadId: string, { quiet = false }: { quiet?: boolean } = {}) => {
      rpc.call("unsnooze", { threadId }).then(
        (result) => apply(result.snoozes),
        () => {
          if (!quiet) toast.error("Could not unsnooze the thread.");
        },
      );
    },
    [apply, rpc],
  );
  return { snoozes, snooze, unsnooze };
}

export function useSnoozeClock(snoozes: readonly Snooze[]): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 30_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  useEffect(() => {
    const next = Math.min(
      ...snoozes.map((snooze) => snooze.until).filter((until) => until > now),
    );
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(next - now + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [snoozes, now]);
  return now;
}

export function useThreadSnoozeValue({
  snoozes,
  sleepingThreadIds,
  familiesByRootId,
  now,
  snooze,
  unsnooze,
  openCustom,
}: {
  snoozes: readonly Snooze[];
  sleepingThreadIds: ReadonlySet<string>;
  familiesByRootId: ReadonlyMap<string, readonly ThreadListEntry[]>;
  now: number;
  snooze: (threadId: string, until: number) => void;
  unsnooze: (threadId: string) => void;
  openCustom: (threadId: string) => void;
}): ThreadSnoozeState {
  return useMemo(() => {
    const snoozesByThreadId = new Map(
      snoozes.map((entry) => [entry.threadId, entry]),
    );
    return {
      snoozesByThreadId,
      now,
      activeSnooze: (threadId) =>
        sleepingThreadIds.has(threadId)
          ? (snoozesByThreadId.get(threadId) ?? null)
          : null,
      isSnoozeRoot: (threadId) => familiesByRootId.has(threadId),
      canSnooze: (threadId) => {
        const family = familiesByRootId.get(threadId);
        return family !== undefined && canSnoozeThreads(family);
      },
      snooze,
      unsnooze,
      openCustom,
    };
  }, [
    familiesByRootId,
    now,
    openCustom,
    sleepingThreadIds,
    snooze,
    snoozes,
    unsnooze,
  ]);
}
