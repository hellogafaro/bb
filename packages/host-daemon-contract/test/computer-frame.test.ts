import { describe, expect, it } from "vitest";
import {
  computerHumanInputSchema,
  decodeComputerFrame,
  encodeComputerFrame,
  type ComputerFrameHeader,
} from "../src/index.js";

const header: ComputerFrameHeader = {
  sequence: 7,
  capturedAt: 1_700_000_000_000,
  mimeType: "image/png",
  width: 640,
  height: 360,
  originalWidth: 1280,
  originalHeight: 720,
};

describe("computer frame codec", () => {
  it("round-trips the header and body", () => {
    const body = new Uint8Array([1, 2, 3, 4, 5]);
    const decoded = decodeComputerFrame(encodeComputerFrame({ header, body }));
    expect(decoded?.header).toEqual(header);
    expect([...(decoded?.body ?? [])]).toEqual([1, 2, 3, 4, 5]);
  });

  it("decodes a frame that sits at an offset inside a larger buffer", () => {
    const encoded = encodeComputerFrame({ header, body: new Uint8Array([9]) });
    const padded = new Uint8Array(encoded.length + 3);
    padded.set(encoded, 3);
    expect(decodeComputerFrame(padded.subarray(3))?.header.sequence).toBe(7);
  });

  it("rejects foreign bytes, truncated frames, and invalid headers", () => {
    const encoded = encodeComputerFrame({ header, body: new Uint8Array([1]) });
    expect(decodeComputerFrame(new TextEncoder().encode('{"type":"x"}'))).toBeNull();
    expect(decodeComputerFrame(encoded.subarray(0, encoded.length - 1))).toBeNull();
    const invalid = encodeComputerFrame({
      header: { ...header, width: 0 },
      body: new Uint8Array([1]),
    });
    expect(decodeComputerFrame(invalid)).toBeNull();
  });
});

describe("computer human input", () => {
  it("rejects pointer input without the frame it was mapped against", () => {
    expect(
      computerHumanInputSchema.safeParse({
        kind: "click",
        x: 1,
        y: 1,
        button: "left",
        count: 1,
        modifiers: [],
      }).success,
    ).toBe(false);
  });
});
