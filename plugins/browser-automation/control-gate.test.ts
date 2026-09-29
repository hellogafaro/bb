import { describe, expect, it } from "vitest";
import { ControlGate } from "./control-gate.js";

describe("ControlGate", () => {
  it("lets a human acquire when the agent is idle", async () => {
    const gate = new ControlGate();
    const owner = await gate.acquire("client-1", new AbortController().signal);
    expect(owner).toBe("human");
    expect(gate.owns("client-1")).toBe(true);
  });

  it("reports busy for a second client while the first holds control", async () => {
    const gate = new ControlGate();
    await gate.acquire("client-1", new AbortController().signal);
    const owner = await gate.acquire("client-2", new AbortController().signal);
    expect(owner).toBe("busy");
  });

  it("blocks runAgent while a human holds control, then resumes after release", async () => {
    const gate = new ControlGate();
    await gate.acquire("client-1", new AbortController().signal);
    let ran = false;
    const agentPromise = gate.runAgent(
      new AbortController().signal,
      async () => {
        ran = true;
        return "done";
      },
    );
    await Promise.resolve();
    expect(ran).toBe(false);
    gate.release("client-1");
    await expect(agentPromise).resolves.toBe("done");
    expect(ran).toBe(true);
  });

  it("reports status for the owner and any other caller", async () => {
    const gate = new ControlGate();
    expect(gate.statusFor("client-1")).toBe("agent");
    await gate.acquire("client-1", new AbortController().signal);
    expect(gate.statusFor("client-1")).toBe("you");
    expect(gate.statusFor("client-2")).toBe("other");
  });
});
