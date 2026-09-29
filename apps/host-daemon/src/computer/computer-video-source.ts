import { connect, type Socket } from "node:net";
import type { CapturedVideoConfigFrame, CapturedVideoFrame, ComputerFrameSource } from "./computer-live.js";
import type { ComputerLiveProfile } from "@bb/host-daemon-contract";

const HEADER_BYTES = 24;
const FRAME_TYPE_CONFIG = 1;
const FRAME_TYPE_ACCESS_UNIT = 2;

/**
 * Parses the bb Computer helper's local video wire format (see
 * apps/computer-macos/Sources/BBComputerHelper/VideoSocketServer.swift):
 * a 24-byte little-endian header followed by `payloadLength` bytes, repeated
 * over a persistent Unix domain socket stream (no message framing at the
 * socket layer, so headers must be parsed out of a running byte buffer).
 */
export class VideoFrameStreamParser {
  #buffer: Buffer = Buffer.alloc(0);

  /** Feeds newly received bytes and returns every complete frame they contain. */
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

/**
 * Connects to the bb Computer helper's video Unix domain socket as a client
 * and streams parsed H.264 access units. Ignores `profile`: the helper always
 * captures at native resolution and full frame rate; there is no separate
 * thumbnail encode (unlike the PNG DriverCaptureFrameSource).
 */
export class VideoSocketFrameSource implements ComputerFrameSource {
  readonly #options: VideoSocketFrameSourceOptions;

  constructor(options: VideoSocketFrameSourceOptions) {
    this.#options = options;
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
      const onAbort = () => {
        socket.destroy();
      };
      signal.addEventListener("abort", onAbort, { once: true });

      socket.on("connect", () => {
        // Connecting is itself the helper's cue to force a keyframe (see
        // VideoSocketServer.onViewerConnected), so no handshake is needed here.
      });
      socket.on("data", (chunk: Buffer) => {
        for (const frame of parser.push(chunk)) onFrame(frame);
      });
      socket.on("error", (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
      socket.on("close", () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      });
    });
  }
}
