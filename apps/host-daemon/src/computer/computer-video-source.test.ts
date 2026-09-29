import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { VideoFrameStreamParser, VideoSocketFrameSource } from "./computer-video-source.js";

function configFrame(payload: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt8(1, 0);
  header.writeUInt8(0, 1);
  header.writeUInt32LE(width, 4);
  header.writeUInt32LE(height, 8);
  header.writeBigInt64LE(0n, 12);
  header.writeUInt32LE(payload.length, 20);
  return Buffer.concat([header, payload]);
}

function accessUnitFrame(payload: Buffer, keyframe: boolean, ptsMicros: bigint): Buffer {
  const header = Buffer.alloc(24);
  header.writeUInt8(2, 0);
  header.writeUInt8(keyframe ? 1 : 0, 1);
  header.writeUInt32LE(1920, 4);
  header.writeUInt32LE(1080, 8);
  header.writeBigInt64LE(ptsMicros, 12);
  header.writeUInt32LE(payload.length, 20);
  return Buffer.concat([header, payload]);
}

describe("VideoFrameStreamParser", () => {
  it("parses a config frame followed by an access unit delivered as one chunk", () => {
    const parser = new VideoFrameStreamParser();
    const avcC = Buffer.from([0x01, 0x64, 0x00, 0x1f]);
    const nalu = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x65, 0xaa, 0xbb]);
    const chunk = Buffer.concat([configFrame(avcC, 3840, 2160), accessUnitFrame(nalu, true, 1_000n)]);

    const frames = parser.push(chunk);
    expect(frames).toHaveLength(2);
    expect(frames[0]).toMatchObject({ kind: "video-config", codec: "h264", width: 3840, height: 2160 });
    expect(Buffer.from(frames[0]!.bytes)).toEqual(avcC);
    expect(frames[1]).toMatchObject({ kind: "video-frame", keyframe: true, ptsMicros: 1_000, width: 1920, height: 1080 });
    expect(Buffer.from(frames[1]!.bytes)).toEqual(nalu);
  });

  it("reassembles a frame split across multiple chunks, including mid-header splits", () => {
    const parser = new VideoFrameStreamParser();
    const nalu = Buffer.from(Array.from({ length: 40 }, (_, i) => i));
    const frame = accessUnitFrame(nalu, false, 42n);

    expect(parser.push(frame.subarray(0, 5))).toHaveLength(0);
    expect(parser.push(frame.subarray(5, 24))).toHaveLength(0);
    expect(parser.push(frame.subarray(24, 30))).toHaveLength(0);
    const frames = parser.push(frame.subarray(30));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ kind: "video-frame", keyframe: false, ptsMicros: 42 });
    expect(Buffer.from(frames[0]!.bytes)).toEqual(nalu);
  });

  it("parses two frames packed back to back and leaves a trailing partial frame buffered", () => {
    const parser = new VideoFrameStreamParser();
    const first = accessUnitFrame(Buffer.from([1, 2, 3]), true, 1n);
    const second = accessUnitFrame(Buffer.from([4, 5]), false, 2n);
    const combined = Buffer.concat([first, second]);

    const frames = parser.push(Buffer.concat([combined, Buffer.from([9, 9, 9])]));
    expect(frames).toHaveLength(2);
    expect(Buffer.from(frames[0]!.bytes)).toEqual(Buffer.from([1, 2, 3]));
    expect(Buffer.from(frames[1]!.bytes)).toEqual(Buffer.from([4, 5]));

    const rest = parser.push(Buffer.concat([Buffer.alloc(21), Buffer.from([0, 0, 1])]));
    expect(rest).toHaveLength(0);
  });
});

describe("VideoSocketFrameSource", () => {
  it("connects to the resolved socket path and forwards every parsed frame until aborted", async () => {
    const socket = new EventEmitter() as EventEmitter & { destroy(): void };
    socket.destroy = () => socket.emit("close");
    const connectImpl = (path: string) => {
      expect(path).toBe("/tmp/fake-video.sock");
      queueMicrotask(() => socket.emit("connect"));
      return socket as unknown as import("node:net").Socket;
    };

    const source = new VideoSocketFrameSource({
      socketPath: async () => "/tmp/fake-video.sock",
      connectImpl,
    });

    const received: string[] = [];
    const controller = new AbortController();
    const done = source.stream("full", (frame) => received.push(frame.kind), controller.signal);

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    socket.emit("data", configFrame(Buffer.from([1]), 100, 100));
    socket.emit("data", accessUnitFrame(Buffer.from([2]), true, 5n));
    controller.abort();
    await done;

    expect(received).toEqual(["video-config", "video-frame"]);
  });
});
