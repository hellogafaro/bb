export function videoDecodeSupported(): boolean {
  return typeof VideoDecoder !== "undefined" && typeof VideoFrame !== "undefined";
}

export function avcCodecString(avcC: Uint8Array): string | null {
  if (avcC.length < 4) return null;
  const [, profileIdc, profileCompat, levelIdc] = avcC;
  const hex = (value: number) => value.toString(16).padStart(2, "0");
  return `avc1.${hex(profileIdc!)}${hex(profileCompat!)}${hex(levelIdc!)}`;
}

export class VideoFrameDecoder {
  #decoder: VideoDecoder | null = null;
  #canvas: HTMLCanvasElement | null = null;
  #configured = false;

  attachCanvas(canvas: HTMLCanvasElement | null): void {
    this.#canvas = canvas;
  }

  configure(avcC: Uint8Array): boolean {
    const codec = avcCodecString(avcC);
    if (codec === null || !videoDecodeSupported()) return false;
    this.close();
    this.#decoder = new VideoDecoder({
      output: (frame) => this.#paint(frame),
      error: (error) => {
        console.error("bb Computer live video decode failed", error);
        this.close();
      },
    });
    this.#decoder.configure({ codec, description: avcC, optimizeForLatency: true });
    this.#configured = true;
    return true;
  }

  get isConfigured(): boolean {
    return this.#configured;
  }

  decode(payload: Uint8Array, keyframe: boolean, ptsMicros: number): void {
    if (this.#decoder === null || this.#decoder.state !== "configured") return;
    this.#decoder.decode(
      new EncodedVideoChunk({
        type: keyframe ? "key" : "delta",
        timestamp: ptsMicros,
        data: payload,
      }),
    );
  }

  #paint(frame: VideoFrame): void {
    const canvas = this.#canvas;
    if (canvas === null) {
      frame.close();
      return;
    }
    if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
      canvas.width = frame.displayWidth;
      canvas.height = frame.displayHeight;
    }
    const context = canvas.getContext("2d");
    context?.drawImage(frame, 0, 0, canvas.width, canvas.height);
    frame.close();
  }

  close(): void {
    if (this.#decoder !== null && this.#decoder.state !== "closed") this.#decoder.close();
    this.#decoder = null;
    this.#configured = false;
  }
}
