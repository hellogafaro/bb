import { connect, type Socket } from "node:net";
import type { CapturedVideoConfigFrame, CapturedVideoFrame, ComputerFrameSource } from "./computer-live.js";
import type { ComputerLiveProfile } from "@bb/host-daemon-contract";

const HEADER_BYTES = 24;
const FRAME_TYPE_CONFIG = 1;
const FRAME_TYPE_ACCESS_UNIT = 2;
const REQUEST_KEYFRAME_COMMAND = Buffer.from([0x01]);

export class VideoFrameStreamParser {
  #buffer: Buffer = Buffer.alloc(0);

  push(chunk: Buffer): Array<CapturedVideoConfigFrame | CapturedVideoFrame> {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk]);
    const frames: Array<CapturedVideoConfigFrame | CapturedVideoFrame> = [];
    for (;;) {
      if (this.#buffer.length < HEADER_BYTES) return frames;
      const payloadLength = this.#buffer.readUInt32LE(20);
      const totalLength = HEADER_BYTES + payloadLength;
      if (this.#buffer.length < totalLength) return frames;

      const type = this.#buffer.readUInt8(0);
      const keyframe = this.#buffer.readUInt8(1) === 1;
      const width = this.#buffer.readUInt32LE(4);
      const height = this.#buffer.readUInt32LE(8);
      const ptsMicros = Number(this.#buffer.readBigInt64LE(12));
      const payload = Uint8Array.prototype.slice.call(this.#buffer, HEADER_BYTES, totalLength) as Uint8Array;
      const capturedAt = Date.now();

      if (type === FRAME_TYPE_CONFIG) {
        frames.push({ kind: "video-config", bytes: payload, codec: "h264", width, height, capturedAt });
      } else if (type === FRAME_TYPE_ACCESS_UNIT) {
        frames.push({ kind: "video-frame", bytes: payload, codec: "h264", width, height, keyframe, ptsMicros, capturedAt });
      }
      this.#buffer = Buffer.from(this.#buffer.subarray(totalLength));
    }
  }
}

export interface VideoSocketFrameSourceOptions {
  readonly socketPath: () => Promise<string>;
  readonly connectImpl?: (path: string) => Socket;
}

export class VideoSocketFrameSource implements ComputerFrameSource {
  readonly #options: VideoSocketFrameSourceOptions;
  #activeSocket: Socket | null = null;

  constructor(options: VideoSocketFrameSourceOptions) {
    this.#options = options;
  }

  requestKeyframe(): void {
    this.#activeSocket?.write(REQUEST_KEYFRAME_COMMAND);
  }

  async stream(
    _profile: ComputerLiveProfile,
    onFrame: (frame: CapturedVideoConfigFrame | CapturedVideoFrame) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const path = await this.#options.socketPath();
    const parser = new VideoFrameStreamParser();
    const connectImpl = this.#options.connectImpl ?? ((socketPath: string) => connect(socketPath));

    await new Promise<void>((resolve, reject) => {
      const socket = connectImpl(path);
      this.#activeSocket = socket;
      const onAbort = () => {
        socket.destroy();
      };
      signal.addEventListener("abort", onAbort, { once: true });

      const clearActiveSocket = () => {
        if (this.#activeSocket === socket) this.#activeSocket = null;
      };
      socket.on("data", (chunk: Buffer) => {
        for (const frame of parser.push(chunk)) onFrame(frame);
      });
      socket.on("error", (error) => {
        signal.removeEventListener("abort", onAbort);
        clearActiveSocket();
        reject(error);
      });
      socket.on("close", () => {
        signal.removeEventListener("abort", onAbort);
        clearActiveSocket();
        resolve();
      });
    });
  }
}
