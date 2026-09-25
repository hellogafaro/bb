import { describe, expect, it } from "vitest";
import {
  AGENT_MASCOTS,
  agentColorForName,
  agentMascotForName,
  labelColorForKey,
} from "../src/index.js";

describe("agent appearance hashes", () => {
  it("picks the same mascot and color for a name every time", () => {
    expect(agentMascotForName("Reviewer")).toBe(agentMascotForName("Reviewer"));
    expect(agentColorForName("Reviewer")).toBe(agentColorForName("Reviewer"));
    expect(agentMascotForName("")).toBe("invader");
    expect(agentMascotForName("a")).toBe(AGENT_MASCOTS[97 % 10]);
    expect(agentColorForName("a")).toBe((97 % 8) + 1);
  });

  it("hashes mascot and color independently and never picks the neutral color", () => {
    const names = Array.from({ length: 200 }, (_, index) => `agent-${index}`);
    const mascots = new Set(names.map(agentMascotForName));
    const colors = new Set(names.map(agentColorForName));
    expect(mascots.size).toBe(AGENT_MASCOTS.length);
    expect([...colors].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (const mascot of AGENT_MASCOTS) {
      const colorsForMascot = new Set(
        names
          .filter((name) => agentMascotForName(name) === mascot)
          .map(agentColorForName),
      );
      expect(colorsForMascot.size, mascot).toBeGreaterThan(1);
    }
  });
});

describe("labelColorForKey", () => {
  it("maps keys stably across all 24 label colors", () => {
    expect(labelColorForKey("proj_alpha")).toBe(labelColorForKey("proj_alpha"));
    expect(labelColorForKey("a")).toBe((97 % 24) + 1);
    const colors = new Set(
      Array.from({ length: 500 }, (_, index) =>
        labelColorForKey(`proj_${index}`),
      ),
    );
    expect([...colors].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
  });
});
