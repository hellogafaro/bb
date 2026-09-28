import { useSyncExternalStore } from "react";

let target: string | null = null;
const listeners = new Set<() => void>();

function publish(next: string | null) {
  target = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openComputerLightbox(hostId: string): void {
  publish(hostId);
}

export function closeComputerLightbox(): void {
  if (target !== null) publish(null);
}

export function useComputerLightboxTarget(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => target,
    () => null,
  );
}
