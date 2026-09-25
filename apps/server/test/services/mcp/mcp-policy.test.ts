import { describe, expect, it } from "vitest";
import { effectivePolicy } from "../../../src/services/mcp/policy.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import {
  callAgentTool,
  mcpHostFixture,
  responseJson,
  responseText,
  waitFor,
} from "./harness.js";

interface ToolRow {
  id: string;
  name: string;
  risk?: string;
  policy?: string;
}

async function addNotes(harness: TestAppHarness): Promise<string> {
  const added = await harness.mcpService.admin.add({
    kind: "stdio",
    name: "notes",
    command: "node",
    args: ["server.js"],
  });
  return added.id;
}

async function search(
  harness: TestAppHarness,
  query: string,
): Promise<ToolRow[]> {
  const result = await harness.mcpService.admin.searchTools(query, 12, null);
  return result.tools;
}

async function idOf(harness: TestAppHarness, name: string): Promise<string> {
  const row = (await search(harness, name)).find((item) => item.name === name);
  if (!row) throw new Error(`tool ${name} not found`);
  return row.id;
}

async function pendingInteraction(harness: TestAppHarness, threadId: string) {
  let found:
    | ReturnType<
        typeof harness.deps.pendingInteractions.listPendingThreadInteractions
      >[number]
    | undefined;
  await waitFor(() => {
    found =
      harness.deps.pendingInteractions.listPendingThreadInteractions(
        threadId,
      )[0];
    return found !== undefined;
  });
  if (!found) throw new Error("no pending interaction");
  return found;
}

async function resolve(
  harness: TestAppHarness,
  threadId: string,
  interactionId: string,
  resolution: unknown,
) {
  return harness.app.request(
    `/api/v1/threads/${threadId}/interactions/${interactionId}/resolve`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resolution),
    },
  );
}

describe("MCP tool policies", () => {
  it("resolves inherit from risk and keeps explicit modes", () => {
    expect(effectivePolicy("inherit", "read")).toBe("allow");
    expect(effectivePolicy("inherit", "write")).toBe("confirm");
    expect(effectivePolicy("inherit", "destructive")).toBe("confirm");
    expect(effectivePolicy("deny", "read")).toBe("deny");
    expect(effectivePolicy("allow", "destructive")).toBe("allow");
    expect(effectivePolicy("confirm", "read")).toBe("confirm");
  });

  it("seeds risk from annotations on catalog load", async () => {
    await withTestHarness(async (harness) => {
      mcpHostFixture(harness);
      const id = await addNotes(harness);
      await harness.mcpService.gateway.inspectServer(id);
      expect(harness.mcpService.store.listToolPolicies(id)).toEqual([
        { toolName: "drop_notes", risk: "destructive", mode: "inherit" },
        { toolName: "read_notes", risk: "read", mode: "inherit" },
        { toolName: "write_note", risk: "write", mode: "inherit" },
      ]);
    });
  });

  it("runs allowed tools, blocks denied tools, and waits for a core approval on confirm", async () => {
    await withTestHarness(async (harness) => {
      const host = mcpHostFixture(harness);
      await addNotes(harness);
      const rows = await search(harness, "notes");
      expect(rows.find((row) => row.name === "read_notes")).not.toHaveProperty(
        "policy",
      );
      expect(rows.find((row) => row.name === "drop_notes")).toMatchObject({
        risk: "destructive",
        policy: "confirm",
      });

      const call = (id: string) =>
        callAgentTool(
          harness,
          "mcp_call",
          { id, args: { text: "hi" } },
          host.threadId,
        );
      expect(responseText(await call(await idOf(harness, "read_notes")))).toBe(
        "ran read_notes",
      );

      const writeId = await idOf(harness, "write_note");
      const pending = call(writeId);
      const interaction = await pendingInteraction(harness, host.threadId);
      expect(interaction).toMatchObject({
        threadId: host.threadId,
        origin: { kind: "core" },
        payload: {
          kind: "mcp_approval",
          server: "notes",
          tool: "write_note",
          risk: "write",
          truncated: false,
        },
      });
      expect(host.ran).toEqual(["read_notes"]);
      const approved = await resolve(harness, host.threadId, interaction.id, {
        kind: "mcp_approval",
        allowed: true,
      });
      expect(approved.status).toBe(200);
      await expect(approved.json()).resolves.toMatchObject({
        status: "resolved",
        resolution: { kind: "mcp_approval", allowed: true },
      });
      expect(responseText(await pending)).toBe("ran write_note");

      const denied = call(writeId);
      const second = await pendingInteraction(harness, host.threadId);
      const respond = await harness.app.request(
        `/api/v1/threads/${host.threadId}/interactions/${second.id}/respond`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: { allowed: false } }),
        },
      );
      expect(respond.status).toBe(200);
      const refused = await denied;
      expect(refused.success).toBe(false);
      expect(responseText(refused)).toContain("denied");

      await harness.mcpService.admin.setPolicy("notes", "drop_notes", "deny");
      const blocked = await call(await idOf(harness, "drop_notes"));
      expect(blocked.success).toBe(false);
      expect(responseText(blocked)).toContain(
        "blocked by the user's MCP policy",
      );
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          host.threadId,
        ),
      ).toEqual([]);
      expect(host.ran).toEqual(["read_notes", "write_note"]);

      const outsideThread = await harness.mcpService.invokeTool(
        writeId,
        {},
        { threadId: null },
      );
      expect(outsideThread).toMatchObject({ isError: true });
      expect(JSON.stringify(outsideThread)).toContain(
        "can only run from a BB thread",
      );
      expect(host.ran).toEqual(["read_notes", "write_note"]);
    });
  });

  it("rejects a resolution of the wrong kind and cancels the call when the user cancels", async () => {
    await withTestHarness(async (harness) => {
      const host = mcpHostFixture(harness);
      await addNotes(harness);
      const pending = callAgentTool(
        harness,
        "mcp_call",
        { id: await idOf(harness, "write_note"), args: {} },
        host.threadId,
      );
      const interaction = await pendingInteraction(harness, host.threadId);
      const wrong = await resolve(harness, host.threadId, interaction.id, {
        decision: "deny",
      });
      expect(wrong.status).toBe(400);
      const cancel = await harness.app.request(
        `/api/v1/threads/${host.threadId}/interactions/${interaction.id}/cancel`,
        { method: "POST" },
      );
      expect(cancel.status).toBe(200);
      const result = await pending;
      expect(result.success).toBe(false);
      expect(responseText(result)).toContain("was cancelled (user)");
      expect(host.ran).toEqual([]);
    });
  });

  it("round-trips policies through the service and lists effective modes", async () => {
    await withTestHarness(async (harness) => {
      mcpHostFixture(harness);
      await addNotes(harness);
      expect(
        await harness.mcpService.admin.setPolicy(
          "notes",
          "write_note",
          "allow",
        ),
      ).toEqual({
        tool: "write_note",
        risk: "write",
        mode: "allow",
        policy: "allow",
      });
      expect(
        (await search(harness, "write")).find(
          (row) => row.name === "write_note",
        ),
      ).not.toHaveProperty("policy");
      await harness.mcpService.admin.setPolicy("notes", "read_notes", "deny");
      const rows = await harness.mcpService.admin.listPolicies("notes");
      expect(rows.map((row) => [row.tool, row.policy])).toEqual([
        ["drop_notes", "confirm"],
        ["read_notes", "deny"],
        ["write_note", "allow"],
      ]);
      await expect(
        harness.mcpService.admin.setPolicy("notes", "missing_tool", "allow"),
      ).rejects.toThrow("Tool not found on notes: missing_tool");
    });
  });

  it("warms catalogs only for enabled servers and skips ones already cached", async () => {
    await withTestHarness(async (harness) => {
      const host = mcpHostFixture(harness);
      const on = await harness.mcpService.admin.add({
        kind: "stdio",
        name: "on",
        command: "node",
        args: [],
      });
      const off = await harness.mcpService.admin.add({
        kind: "stdio",
        name: "off",
        command: "node",
        args: [],
      });
      await harness.mcpService.admin.setEnabled(off.id, false);
      await harness.mcpService.gateway.warm();
      expect(host.started).toEqual([on.id]);
      expect(harness.mcpService.gateway.catalogCounts(on.id)?.tools).toBe(3);
      await harness.mcpService.gateway.warm();
      expect(host.started).toEqual([on.id]);
    });
  });

  it("warms a newly added server in the background", async () => {
    await withTestHarness(async (harness) => {
      const host = mcpHostFixture(harness);
      await addNotes(harness);
      await waitFor(() => host.started.length === 1);
      const listed = responseJson(
        await callAgentTool(harness, "mcp_servers", {}, host.threadId),
      );
      expect(listed).toMatchObject({
        servers: [{ handle: "notes", tools: 3 }],
      });
    });
  });
});
