// @vitest-environment jsdom
import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("../app"));
const approval = app.pendingInteractions.find((item) => item.id === "mcp-approval")!;
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function interaction(payload: unknown) {
  const submit = vi.fn(async () => {});
  const cancel = vi.fn(async () => {});
  const slot = renderSlot(approval, { interaction: { id: "i1", threadId: "t1", title: "MCP", payload: payload as never, createdAt: 0, expiresAt: null }, submit, cancel });
  return { slot, submit, cancel };
}

it("approves or denies a confirm-policy tool call", async () => {
  const { slot, submit } = interaction({ kind: "tool", server: "notes", tool: "write_note", risk: "write", args: "{\n  \"text\": \"hi\"\n}", truncated: false });
  expect(slot.getByText("notes / write_note")).not.toBeNull();
  expect(slot.getByText("write")).not.toBeNull();
  await act(async () => { fireEvent.click(slot.getByRole("button", { name: "Approve" })); });
  expect(submit).toHaveBeenLastCalledWith({ allowed: true });
  cleanup();
  const denied = interaction({ kind: "tool", server: "notes", tool: "write_note", risk: "write", args: "{}", truncated: false });
  await act(async () => { fireEvent.click(denied.slot.getByRole("button", { name: "Deny" })); });
  expect(denied.submit).toHaveBeenLastCalledWith({ allowed: false });
});

it("collects typed elicitation answers and requires required fields", async () => {
  const { slot, submit } = interaction({
    kind: "elicitation",
    server: "crm",
    message: "Who is this for?",
    fields: [
      { name: "name", title: "Name", description: null, type: "string", options: null, required: true, defaultValue: null },
      { name: "seats", title: null, description: null, type: "integer", options: null, required: false, defaultValue: 2 },
      { name: "notify", title: "Notify", description: null, type: "boolean", options: null, required: false, defaultValue: null },
    ],
  });
  const send = slot.getByRole("button", { name: "Submit" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  fireEvent.change(slot.getByLabelText("Name *"), { target: { value: "Ada" } });
  fireEvent.change(slot.getByLabelText("seats"), { target: { value: "3" } });
  await act(async () => { fireEvent.click(send); });
  expect(submit).toHaveBeenLastCalledWith({ action: "accept", content: { name: "Ada", seats: 3, notify: false } });
});

it("changes a tool policy from the detail page", async () => {
  const rows = [{ id: "notes", handle: "notes", name: "notes", description: null, type: "stdio", enabled: true, status: "ready", authStatus: "not-applicable", configJson: "{}", sourceKind: "manual", guide: null, lastError: null }];
  const tools = { tools: [{ id: "t1", sourceId: "notes", handle: "notes", name: "write_note", description: "Write", risk: "write" }], error: null };
  const handlers: Record<string, (input: any) => any> = {
    snapshot: () => ({ servers: rows }),
    inspectServer: () => tools,
    providerStatus: () => ({ hostId: "h", status: { claude: { settingsPath: "s", connectorsDisabled: true, mcpServers: [] }, codex: { configPath: "c", mcpServers: [] } }, issues: [] }),
    listToolPolicies: () => ({ tools: [{ tool: "write_note", risk: "write", mode: "inherit", policy: "confirm" }] }),
    setToolPolicy: ({ tool, mode }) => ({ tool, risk: "write", mode, policy: mode === "inherit" ? "confirm" : mode }),
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    const method = String(url).split("/").pop()!;
    return { ok: true, json: async () => ({ ok: true, result: await handlers[method]!(JSON.parse(String(init.body))) }) };
  }));
  const slot = renderSlot(app.navPanels[0]!, { subPath: "installed/notes" }, { rpc: handlers });
  const select = await slot.findByLabelText("Policy for write_note") as HTMLSelectElement;
  expect(select.value).toBe("inherit");
  expect(slot.getByText("Default (Ask first)")).not.toBeNull();
  await act(async () => { fireEvent.change(select, { target: { value: "deny" } }); });
  expect(slot.rpcCalls.find((call) => call.method === "setToolPolicy")?.input).toEqual({ id: "notes", tool: "write_note", mode: "deny" });
  expect((slot.getByLabelText("Policy for write_note") as HTMLSelectElement).value).toBe("deny");
});
