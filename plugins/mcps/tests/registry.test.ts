import { expect, it } from 'vitest';
import { fetchRegistryServers } from '../src/registry';

it('aborts offline registry fetches at the deadline and accepts caller cancellation', async () => {
  const fetchImpl = ((_url: unknown, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init.signal!;
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), {once: true});
  })) as typeof fetch;
  await expect(fetchRegistryServers({fetchImpl, timeoutMs: 20})).rejects.toThrow();
  const controller = new AbortController();
  const pending = fetchRegistryServers({fetchImpl, signal: controller.signal});
  controller.abort();
  await expect(pending).rejects.toThrow();
});
it('forwards registry cursor and returns the next cursor', async () => {
  let requested = '';
  const page = await fetchRegistryServers({cursor: 'page 2', fetchImpl: (async url => {
    requested = String(url);
    return new Response(JSON.stringify({servers: [], metadata: {nextCursor: 'page3'}}));
  }) as typeof fetch});
  expect(new URL(requested).searchParams.get('cursor')).toBe('page 2');
  expect(page.nextCursor).toBe('page3');
});
