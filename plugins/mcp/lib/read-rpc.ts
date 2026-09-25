import type { PluginRpcResult } from '@get-bb/plugin-sdk/app';
import type { z } from 'zod';
import type { rpcContract } from '../server';

type ReadMethod = 'snapshot' | 'inspectServer';
export async function readRpc<M extends ReadMethod>(method: M, input: z.input<(typeof rpcContract)[M]["input"]>, signal: AbortSignal): Promise<PluginRpcResult<(typeof rpcContract)[M]>> {
  const response = await fetch(`/api/v1/plugins/mcp/rpc/${method}`, {
    method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input), signal,
  });
  if (!response.ok) throw new Error(`MCP request failed: HTTP ${response.status}`);
  const payload = await response.json();
  signal.throwIfAborted();
  if (!payload.ok) throw new Error(payload.error?.message ?? 'MCP request failed');
  return payload.result;
}
