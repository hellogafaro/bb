import { useSyncExternalStore } from "react";

const CLOCK_TICK_MS = 30_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function tick(): void {
  now = Date.now();
  for (const listener of listeners) listener();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") tick();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(tick, CLOCK_TICK_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || timer === null) return;
    clearInterval(timer);
    timer = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

function getNow(): number {
  return now;
}

export function useRelativeTimeNow(): number {
  return useSyncExternalStore(subscribe, getNow, getNow);
}

export function formatRelativeAge(at: number, currentTime: number): string {
  const seconds = Math.max(0, Math.floor((currentTime - at) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function getThreadLastActivityAt(thread: {
  updatedAt: number;
  latestAttentionAt: number;
}): number {
  return Math.max(thread.updatedAt, thread.latestAttentionAt);
}
