import { describe, expect, it } from "vitest";
import { CuaError } from "./computer-transport.js";
import { PersistentCuaTransport, type DriverSession, type DriverSessionFactory } from "./computer-driver-session.js";

const LAUNCH = { command: "cua-driver", args: ["mcp"], env: {} };

function fakeSession(overrides: Partial<DriverSession> = {}): DriverSession & { closed: boolean } {
  const session = {
    closed: false,
    call: overrides.call ?? (async () => ({ structuredContent: { ok: true } })),
    close: overrides.close ?? (() => {
      session.closed = true;
    }),
    onClose: overrides.onClose ?? (() => {}),
  };
  return session;
}

describe("PersistentCuaTransport", () => {
  it("opens a single session and reuses it across calls", async () => {
    let opens = 0;
    const factory: DriverSessionFactory = async () => {
      opens += 1;
      return fakeSession();
    };
    const transport = new PersistentCuaTransport({ launch: async () => LAUNCH, sessionFactory: factory });
    await transport.call("health_report", {}, new AbortController().signal);
    await transport.call("health_report", {}, new AbortController().signal);
    expect(opens).toBe(1);
  });

  it("discards a session and retries once when the driver reports it has ended", async () => {
    let opens = 0;
    const sessions: Array<DriverSession & { closed: boolean }> = [];
    const factory: DriverSessionFactory = async () => {
      opens += 1;
      const opened = opens;
      const session = fakeSession({
        call: async () => {
          if (opened === 1) {
            throw new Error(
              "session 'mcp-1-2' has ended; tool call 'get_desktop_state' was rejected. Call start_session with this id to revive it",
            );
          }
          return { structuredContent: { ok: true } };
        },
      });
      sessions.push(session);
      return session;
    };
    const transport = new PersistentCuaTransport({ launch: async () => LAUNCH, sessionFactory: factory });
    const result = await transport.call("get_desktop_state", {}, new AbortController().signal);
    expect(result.structuredContent).toEqual({ ok: true });
    expect(opens).toBe(2);
    expect(sessions[0]?.closed).toBe(true);
  });

  it("does not retry a second time when the driver keeps rejecting after reconnecting", async () => {
    let attempts = 0;
    const factory: DriverSessionFactory = async () =>
      fakeSession({
        call: async () => {
          attempts += 1;
          throw new Error("session 'mcp-1-2' has ended; call start_session with this id to revive it");
        },
      });
    const transport = new PersistentCuaTransport({ launch: async () => LAUNCH, sessionFactory: factory });
    await expect(transport.call("get_desktop_state", {}, new AbortController().signal)).rejects.toThrow(CuaError);
    expect(attempts).toBe(2);
  });

  it("does not reconnect for unrelated tool errors", async () => {
    let opens = 0;
    let attempts = 0;
    const factory: DriverSessionFactory = async () => {
      opens += 1;
      return fakeSession({
        call: async () => {
          attempts += 1;
          return { isError: true, content: [{ type: "text", text: "stale observation: window no longer visible" }] };
        },
      });
    };
    const transport = new PersistentCuaTransport({ launch: async () => LAUNCH, sessionFactory: factory });
    await expect(transport.call("click", {}, new AbortController().signal)).rejects.toThrow(/stale observation/);
    expect(opens).toBe(1);
    expect(attempts).toBe(1);
  });

  it("close() discards the current session so the next call opens a fresh one", async () => {
    let opens = 0;
    const closed: boolean[] = [];
    const factory: DriverSessionFactory = async () => {
      opens += 1;
      const session = fakeSession();
      const originalClose = session.close;
      session.close = () => {
        originalClose();
        closed.push(true);
      };
      return session;
    };
    const transport = new PersistentCuaTransport({ launch: async () => LAUNCH, sessionFactory: factory });
    await transport.call("health_report", {}, new AbortController().signal);
    transport.close();
    await transport.call("health_report", {}, new AbortController().signal);
    expect(opens).toBe(2);
    expect(closed).toEqual([true]);
  });

  it("reconnects once when the underlying session reports itself closed mid-call", async () => {
    let opens = 0;
    const factory: DriverSessionFactory = async () => {
      opens += 1;
      const opened = opens;
      return fakeSession({
        call: async () => {
          if (opened === 1) throw new Error("Connection closed");
          return { structuredContent: { ok: true } };
        },
      });
    };
    const transport = new PersistentCuaTransport({ launch: async () => LAUNCH, sessionFactory: factory });
    const result = await transport.call("get_desktop_state", {}, new AbortController().signal);
    expect(result.structuredContent).toEqual({ ok: true });
    expect(opens).toBe(2);
  });
});
