import { useEffect, useMemo, useRef, useState } from "react";
import { isThreadRead } from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";
import { useMarkThreadUnread } from "@/hooks/mutations/thread-state-mutations";

export const READ_HOLD_MS = 5_000;

interface ReadHold {
  lastReadAt: number | null;
  openedAt: number;
}

export function useReadHold(
  threads: readonly ThreadListEntry[],
  activeThreadId: string | null,
): readonly ThreadListEntry[] {
  const { mutate: markUnread } = useMarkThreadUnread();
  const [holds, setHolds] = useState<ReadonlyMap<string, ReadHold>>(
    () => new Map(),
  );
  const snapshot = useRef(new Map<string, ThreadListEntry>());
  const holdsRef = useRef(holds);
  const previous = useRef<string | null>(null);
  useEffect(() => {
    holdsRef.current = holds;
  }, [holds]);
  useEffect(() => {
    const left = previous.current;
    previous.current = activeThreadId;
    if (left === activeThreadId) return;
    const opened =
      activeThreadId === null
        ? undefined
        : snapshot.current.get(activeThreadId);
    const now = Date.now();
    const leftHold = left === null ? undefined : holdsRef.current.get(left);
    if (left !== null && leftHold && now - leftHold.openedAt < READ_HOLD_MS) {
      markUnread({ threadId: left });
    }
    setHolds((current) => {
      const next = new Map(current);
      if (left !== null) next.delete(left);
      if (opened && !isThreadRead(opened)) {
        next.set(opened.id, { lastReadAt: opened.lastReadAt, openedAt: now });
      }
      return next;
    });
  }, [activeThreadId, markUnread]);
  useEffect(() => {
    snapshot.current = new Map(threads.map((thread) => [thread.id, thread]));
  }, [threads]);
  useEffect(() => {
    if (holds.size === 0) return;
    const soonest =
      Math.min(...[...holds.values()].map((hold) => hold.openedAt)) +
      READ_HOLD_MS;
    const timer = window.setTimeout(
      () =>
        setHolds((current) => {
          const next = new Map(
            [...current].filter(
              ([, hold]) => Date.now() - hold.openedAt < READ_HOLD_MS,
            ),
          );
          return next.size === current.size ? current : next;
        }),
      Math.max(0, soonest - Date.now()) + 20,
    );
    return () => window.clearTimeout(timer);
  }, [holds]);
  return useMemo(
    () =>
      holds.size === 0
        ? threads
        : threads.map((thread) => {
            const hold = holds.get(thread.id);
            if (!hold || !isThreadRead(thread)) return thread;
            return { ...thread, lastReadAt: hold.lastReadAt };
          }),
    [holds, threads],
  );
}
