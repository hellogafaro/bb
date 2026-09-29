import { describe, expect, it } from "vitest";
import { COMPUTER_HELPER_PINS } from "./computer-helper-provisioning.js";

describe("COMPUTER_HELPER_PINS", () => {
  it("pins darwin-arm64 to the published 0.1.1 release", () => {
    expect(COMPUTER_HELPER_PINS["darwin-arm64"]).toEqual({
      version: "0.1.1",
      asset: "bb-computer-helper-0.1.1-darwin-arm64.tar.gz",
      sha256: "ef2b8a275111882e9ea827a200e90932ecae1ff4f319a7abbe3a3a416f1f079c",
    });
  });

  it("leaves darwin-x64 unpinned so Intel Macs keep the legacy path", () => {
    expect(COMPUTER_HELPER_PINS["darwin-x64"]).toBeUndefined();
  });
});
