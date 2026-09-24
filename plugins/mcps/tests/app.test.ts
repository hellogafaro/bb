// @vitest-environment jsdom
import { createElement } from 'react';
import { act, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { loadPluginApp, renderSlot } from '@get-bb/plugin-sdk/testing/app';
import { buildMcpEditThreadPrompt, CREATE_MCP_PROMPT } from '../lib/prompts';

const app = await loadPluginApp(() => import('../app'));
const panel = app.navPanels[0]!;
const rows = ['alpha', 'beta'].map(id => ({ id, handle: id, name: id, type: 'stdio', enabled: true, status: 'ready', authStatus: 'not-applicable', configJson: '{}', sourceKind: 'manual' }));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const catalog = (name: string, count = 1) => ({ tools: Array.from({length: count}, (_, i) => ({ id: `${name}-${i}`, name: `${name}-${i}`, risk: 'read', description: '' })), error: null });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount(subPath: string, handlers: Record<string, (input: any) => any>) {
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    const method = String(url).split('/').pop()!;
    return { ok: true, json: async () => ({ ok: true, result: await handlers[method]!(JSON.parse(init.body)) }) };
  }));
  return renderSlot(panel, { subPath }, { rpc: handlers });
}
it('does not replace beta tools with a late alpha inspection', async () => {
  const slow = deferred<ReturnType<typeof catalog>>();
  const slot = mount('installed/alpha', { snapshot: () => ({servers: rows}), inspectServer: ({id}) => id === 'alpha' ? slow.promise : catalog('beta') });
  await slot.findByRole('heading', {name: 'alpha'});
  slot.lifecycle.rerender(createElement(panel.component, {subPath: 'installed/beta'}));
  await slot.findByText('beta-0');
  await act(async () => { slow.resolve(catalog('alpha')); });
  expect(slot.queryByText('alpha-0')).toBeNull();
  expect(slot.queryByText('beta-0')).not.toBeNull();
});
it('bounds the rendered rows of a 500-tool catalog and exposes later pages', async () => {
  const slot = mount('installed/alpha', { snapshot: () => ({servers: rows}), inspectServer: () => catalog('tool', 500) });
  await slot.findByText('tool-0');
  expect(slot.container.querySelectorAll('li').length).toBeLessThanOrEqual(50);
  fireEvent.click(slot.getByRole('button', {name: 'Next tools'}));
  expect(slot.queryByText('tool-50')).not.toBeNull();
});

it('keeps the newest snapshot after out-of-order realtime refreshes and aborts old reads', async () => {
  const old = deferred<{servers: typeof rows}>(); let calls = 0;
  const slot = mount('', { snapshot: () => ++calls === 1 ? old.promise : {servers: [rows[1]]} });
  await slot.behavior.emitRealtime('mcps-changed', {});
  await slot.findByText('beta');
  const firstSignal = vi.mocked(fetch).mock.calls[0]![1]!.signal!;
  expect(firstSignal.aborted).toBe(true);
  await act(async () => old.resolve({servers: [rows[0]!]}));
  expect(slot.queryByText('alpha')).toBeNull();
});
it('paginates 60 installed servers without hiding matches on later pages', async () => {
  const servers = Array.from({length: 60}, (_, i) => ({...rows[0], id: `server-${i}`, name: `server-${i}`}));
  const slot = mount('', {snapshot: () => ({servers})});
  await slot.findByText('server-0');
  expect(slot.queryByText('server-59')).toBeNull();
  fireEvent.click(slot.getByRole('button', {name: 'Next servers'}));
  expect(slot.queryByText('server-59')).not.toBeNull();
  fireEvent.change(slot.getByRole('textbox', {name: 'Search MCPs'}), {target: {value: 'server-59'}});
  expect(slot.queryByText('server-59')).not.toBeNull();
});

it('opens existing handle links after stable IDs are introduced', async () => {
  const server = {...rows[0], id: 'mcp_1234567890', handle: 'alpha'};
  const slot = mount('installed/alpha', {snapshot: () => ({servers: [server]}), inspectServer: () => catalog('echo')});
  await slot.findByText('echo-0');
  expect(slot.container.querySelector('[title="mcp_1234567890"]')?.textContent).toBe('alpha');
  slot.lifecycle.rerender(createElement(panel.component, {subPath: 'installed/mcp_1234567890'}));
  await slot.findByText('echo-0');
  expect(slot.queryByText('That MCP is gone.')).toBeNull();
});

it('replaces the add dialogs and registry browser with New MCP via chat', async () => {
  const slot = mount('', {snapshot: () => ({servers: rows})});
  await slot.findByText('alpha');
  expect(slot.queryByRole('tab', {name: 'Browse'})).toBeNull();
  expect(slot.queryByRole('textbox', {name: 'Search the MCP Registry'})).toBeNull();
  expect(slot.queryByText('From URL')).toBeNull();
  fireEvent.click(slot.getByRole('button', {name: 'New MCP'}));
  expect(slot.inspection.navigateCalls.at(-1)).toEqual({method: 'toCompose', options: {focusPrompt: true, initialPrompt: CREATE_MCP_PROMPT}});
  expect(CREATE_MCP_PROMPT.endsWith('The MCP I want is: ')).toBe(true);
});

it('routes the retired browse path to the installed list', async () => {
  const slot = mount('browse', {snapshot: () => ({servers: rows})});
  await slot.findByText('beta');
  expect(slot.queryByText('That MCP is gone.')).toBeNull();
});

it('prefills an edit prompt and saves the agent guide from the detail page', async () => {
  const server = {...rows[0], id: 'mcp_1234567890', handle: 'alpha', guide: 'Old guide'};
  const setGuide = vi.fn(() => ({id: server.id, handle: server.handle, guide: 'New guide'}));
  const slot = mount('installed/alpha', {snapshot: () => ({servers: [server]}), inspectServer: () => catalog('echo'), setGuide});
  await slot.findByText('echo-0');
  fireEvent.click(slot.getByRole('button', {name: 'Edit in chat'}));
  const prompt = buildMcpEditThreadPrompt({name: 'alpha', id: server.id, handle: 'alpha'});
  expect(slot.inspection.navigateCalls.at(-1)).toEqual({method: 'toCompose', options: {focusPrompt: true, initialPrompt: prompt}});
  expect(prompt).toContain('bb mcp header alpha');
  expect(prompt).toContain('bb mcp disable alpha');
  expect(prompt).toContain('bb mcp remove alpha');
  const guide = slot.getByRole('textbox', {name: 'Agent guide'}) as HTMLTextAreaElement;
  expect(guide.value).toBe('Old guide');
  const save = slot.getByRole('button', {name: 'Save guide'}) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(guide, {target: {value: '  New guide  '}});
  await act(async () => { fireEvent.click(save); });
  expect(setGuide).toHaveBeenCalledWith({id: server.id, guide: 'New guide'});
});
