import { AGENT_MASCOTS } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { mascotPath, mascotSprite } from "./mascot-sprites";

describe("mascotPath", () => {
  it("merges each row's filled runs into one rect", () => {
    expect(mascotPath(["##.#", "....", ".###"])).toBe(
      "M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z",
    );
  });

  it("returns an empty path for a blank sprite", () => {
    expect(mascotPath(["........", "........"])).toBe("");
  });
});

describe("mascotSprite", () => {
  it("builds distinct rest and talk frames for every mascot", () => {
    for (const name of AGENT_MASCOTS) {
      const sprite = mascotSprite(name);
      expect(sprite.name).toBe(name);
      expect(sprite.restPath).toMatch(/^(M\d \dh\dv1h-\dz)+$/);
      expect(sprite.talkPath).toMatch(/^(M\d \dh\dv1h-\dz)+$/);
      expect(sprite.talkPath).not.toBe(sprite.restPath);
    }
  });

  it("keeps the robot's antenna in its top row", () => {
    expect(mascotSprite("robot").restPath.startsWith("M3 0h1v1h-1z")).toBe(
      true,
    );
    expect(mascotSprite("robot").talkPath.startsWith("M4 0h1v1h-1z")).toBe(
      true,
    );
  });
});
