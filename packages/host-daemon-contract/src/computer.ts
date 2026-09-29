import { z } from "zod";

export const computerRunIdSchema = z.string().uuid();

export const computerImageMimeTypeSchema = z.enum(["image/jpeg", "image/png"]);
export type ComputerImageMimeType = z.infer<typeof computerImageMimeTypeSchema>;

export const computerBoundsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export type ComputerBounds = z.infer<typeof computerBoundsSchema>;

export const computerTargetSchema = z
  .object({
    index: z.number().int().nonnegative(),
    targetId: z.string().min(1).max(80),
    role: z.string().max(80),
    name: z.string().max(300),
    value: z.string().max(500).nullable(),
    bounds: computerBoundsSchema.nullable(),
    ref: z.string().max(200).nullable(),
    allowedOperations: z
      .array(
        z.enum([
          "click",
          "double_click",
          "type",
          "set_value",
          "select",
          "scroll",
        ]),
      )
      .max(6),
  })
  .strict();
export type ComputerTarget = z.infer<typeof computerTargetSchema>;

export const computerObservationSchema = z
  .object({
    surface: z.enum(["desktop", "browser"]),
    title: z.string().max(500),
    snapshotId: z.string().min(1).max(64),
    observedAt: z.number().int(),
    targets: z.array(computerTargetSchema).max(1_000),
    hint: z.string().max(500).nullable(),
  })
  .strict();
export type ComputerObservation = z.infer<typeof computerObservationSchema>;

export const computerOperationKindSchema = z.enum([
  "click",
  "double_click",
  "type",
  "set_value",
  "select",
  "scroll",
  "hotkey",
  "type_window",
  "press_key",
  "focus_window",
  "wait",
  "done",
  "blocked",
]);
export type ComputerOperationKind = z.infer<typeof computerOperationKindSchema>;

export const computerKeyPressSchema = z.enum(["Enter", "Escape", "Tab", "mod+a", "mod+c", "mod+v"]);
export type ComputerKeyPress = z.infer<typeof computerKeyPressSchema>;

export const computerOperationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("click"),
      targetId: z.string().min(1).max(80),
      snapshotId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal("double_click"),
      targetId: z.string().min(1).max(80),
      snapshotId: z.string().min(1).max(64),
    })
    .strict(),
  z
    .object({
      kind: z.literal("type"),
      targetId: z.string().min(1).max(80),
      snapshotId: z.string().min(1).max(64),
      text: z.string().max(10_000),
      protect: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("set_value"),
      targetId: z.string().min(1).max(80),
      snapshotId: z.string().min(1).max(64),
      value: z.string().max(10_000),
      protect: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("select"),
      targetId: z.string().min(1).max(80),
      snapshotId: z.string().min(1).max(64),
      value: z.string().max(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scroll"),
      targetId: z.string().min(1).max(80).nullable(),
      snapshotId: z.string().min(1).max(64),
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.enum(["small", "page"]).default("small"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("hotkey"),
      keys: z.array(z.string().min(1).max(40)).min(1).max(5),
    })
    .strict(),
  z
    .object({
      kind: z.literal("type_window"),
      text: z.string().min(1).max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("press_key"),
      key: computerKeyPressSchema,
    })
    .strict(),
  z.object({ kind: z.literal("focus_window") }).strict(),
  z
    .object({
      kind: z.literal("wait"),
      ms: z.number().int().min(50).max(10_000),
    })
    .strict(),
  z.object({ kind: z.literal("done"), summary: z.string().max(2_000) }).strict(),
  z
    .object({ kind: z.literal("blocked"), reason: z.string().max(2_000) })
    .strict(),
]);
export type ComputerOperation = z.infer<typeof computerOperationSchema>;

export const computerActionOutcomeSchema = z
  .object({
    state: z.enum(["completed", "stale", "blocked", "error"]),
    summary: z.string().max(2_000),
    observation: computerObservationSchema.nullable(),
  })
  .strict();
export type ComputerActionOutcome = z.infer<typeof computerActionOutcomeSchema>;

export const computerPermissionIdSchema = z.enum(["accessibility", "screen-recording"]);
export type ComputerPermissionId = z.infer<typeof computerPermissionIdSchema>;
export const computerDoctorProbeIdSchema = z.enum([
  "driver",
  "service",
  "accessibility",
  "screen-recording",
  "capture",
  "windows",
  "doctor",
]);
export type ComputerDoctorProbeId = z.infer<typeof computerDoctorProbeIdSchema>;
export const computerDoctorProbeSchema = z
  .object({
    id: computerDoctorProbeIdSchema,
    label: z.string(),
    status: z.enum(["ok", "setup-required", "unavailable"]),
    message: z.string(),
  })
  .strict();
export type ComputerDoctorProbe = z.infer<typeof computerDoctorProbeSchema>;
export const computerDoctorReportSchema = z
  .object({
    state: z.enum(["ready", "setup-required", "unavailable"]),
    platform: z.string().min(1).max(16),
    version: z.string().nullable(),
    driverPath: z.string().nullable(),
    probes: z.array(computerDoctorProbeSchema).max(16),
  })
  .strict();
export type ComputerDoctorReport = z.infer<typeof computerDoctorReportSchema>;

export const computerCaptureImageSchema = z
  .object({
    mimeType: computerImageMimeTypeSchema,
    dataBase64: z.string().min(1).max(3_500_000),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type ComputerCaptureImage = z.infer<typeof computerCaptureImageSchema>;

export const computerLiveProfileSchema = z.enum(["full", "thumbnail"]);
export type ComputerLiveProfile = z.infer<typeof computerLiveProfileSchema>;

export const computerFrameSizeSchema = z
  .object({
    width: z.number().int().positive().max(16_384),
    height: z.number().int().positive().max(16_384),
  })
  .strict();
export type ComputerFrameSize = z.infer<typeof computerFrameSizeSchema>;

const frameCoordinateSchema = z.number().finite().min(0).max(16_384);
export const computerPointerButtonSchema = z.enum(["left", "right", "middle"]);
export type ComputerPointerButton = z.infer<typeof computerPointerButtonSchema>;
export const computerKeyModifierSchema = z.enum(["ctrl", "shift", "alt", "meta"]);
export type ComputerKeyModifier = z.infer<typeof computerKeyModifierSchema>;
const keyModifiersSchema = z.array(computerKeyModifierSchema).max(4);

export const computerHumanInputSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("click"),
      frame: computerFrameSizeSchema,
      x: frameCoordinateSchema,
      y: frameCoordinateSchema,
      button: computerPointerButtonSchema,
      count: z.number().int().min(1).max(3),
      modifiers: keyModifiersSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("drag"),
      frame: computerFrameSizeSchema,
      fromX: frameCoordinateSchema,
      fromY: frameCoordinateSchema,
      toX: frameCoordinateSchema,
      toY: frameCoordinateSchema,
      button: computerPointerButtonSchema,
      durationMs: z.number().int().min(0).max(10_000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("scroll"),
      frame: computerFrameSizeSchema,
      x: frameCoordinateSchema,
      y: frameCoordinateSchema,
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().int().min(1).max(50),
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      frame: computerFrameSizeSchema,
      x: frameCoordinateSchema,
      y: frameCoordinateSchema,
    })
    .strict(),
  z.object({ kind: z.literal("type"), text: z.string().min(1).max(10_000) }).strict(),
  z
    .object({
      kind: z.literal("key"),
      key: z.string().min(1).max(40),
      modifiers: keyModifiersSchema,
    })
    .strict(),
]);
export type ComputerHumanInput = z.infer<typeof computerHumanInputSchema>;

export const COMPUTER_CLIPBOARD_MAX_CHARS = 1_000_000;

export const computerLiveStateSchema = z.enum(["starting", "live", "stopped", "error"]);
export type ComputerLiveState = z.infer<typeof computerLiveStateSchema>;

export const computerVideoCodecSchema = z.enum(["h264"]);
export type ComputerVideoCodec = z.infer<typeof computerVideoCodecSchema>;

export const computerFrameHeaderSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    capturedAt: z.number().int().nonnegative(),
    mimeType: computerImageMimeTypeSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    originalWidth: z.number().int().positive(),
    originalHeight: z.number().int().positive(),
  })
  .strict();
export type ComputerFrameHeader = z.infer<typeof computerFrameHeaderSchema>;

/**
 * Sent once when a hardware H.264 video stream starts (or its parameter sets
 * change): carries the avcC (AVCDecoderConfigurationRecord) extradata a
 * WebCodecs VideoDecoder needs in its `description` to configure for 'avc'
 * (AVCC) chunk type. The body of the accompanying ComputerFrame-shaped
 * message is the raw avcC bytes.
 */
export const computerVideoConfigHeaderSchema = z
  .object({
    kind: z.literal("video-config"),
    sequence: z.number().int().nonnegative(),
    capturedAt: z.number().int().nonnegative(),
    codec: computerVideoCodecSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type ComputerVideoConfigHeader = z.infer<typeof computerVideoConfigHeaderSchema>;

/**
 * One H.264 access unit in AVCC (4-byte length-prefixed NAL units) framing,
 * matching what VideoToolbox emits and what WebCodecs expects for the 'avc'
 * chunk type. The body of the accompanying ComputerFrame-shaped message is
 * the raw AVCC payload.
 */
export const computerVideoFrameHeaderSchema = z
  .object({
    kind: z.literal("video-frame"),
    sequence: z.number().int().nonnegative(),
    capturedAt: z.number().int().nonnegative(),
    codec: computerVideoCodecSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    keyframe: z.boolean(),
    ptsMicros: z.number().int(),
  })
  .strict();
export type ComputerVideoFrameHeader = z.infer<typeof computerVideoFrameHeaderSchema>;

export const computerLiveFrameHeaderSchema = z.union([
  computerFrameHeaderSchema,
  computerVideoConfigHeaderSchema,
  computerVideoFrameHeaderSchema,
]);
export type ComputerLiveFrameHeader = z.infer<typeof computerLiveFrameHeaderSchema>;

export interface ComputerFrame {
  readonly header: ComputerLiveFrameHeader;
  readonly body: Uint8Array;
}

const COMPUTER_FRAME_MAGIC = [0x42, 0x42, 0x46, 0x31] as const;
const COMPUTER_FRAME_PREFIX_BYTES = 8;
const COMPUTER_FRAME_MAX_HEADER_BYTES = 4_096;

export function encodeComputerFrame(frame: ComputerFrame): Uint8Array<ArrayBuffer> {
  const header = new TextEncoder().encode(JSON.stringify(frame.header));
  const bytes = new Uint8Array(COMPUTER_FRAME_PREFIX_BYTES + header.length + frame.body.length);
  bytes.set(COMPUTER_FRAME_MAGIC, 0);
  new DataView(bytes.buffer).setUint32(4, header.length);
  bytes.set(header, COMPUTER_FRAME_PREFIX_BYTES);
  bytes.set(frame.body, COMPUTER_FRAME_PREFIX_BYTES + header.length);
  return bytes;
}

export function decodeComputerFrame(bytes: Uint8Array): ComputerFrame | null {
  if (bytes.length < COMPUTER_FRAME_PREFIX_BYTES) return null;
  if (COMPUTER_FRAME_MAGIC.some((value, index) => bytes[index] !== value)) return null;
  const headerLength = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4);
  const bodyStart = COMPUTER_FRAME_PREFIX_BYTES + headerLength;
  if (headerLength > COMPUTER_FRAME_MAX_HEADER_BYTES || bodyStart >= bytes.length) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(bytes.subarray(COMPUTER_FRAME_PREFIX_BYTES, bodyStart)));
  } catch {
    return null;
  }
  const header = computerLiveFrameHeaderSchema.safeParse(raw);
  if (!header.success) return null;
  return { header: header.data, body: bytes.subarray(bodyStart) };
}

export const computerCommandSchemas = {
  "computer.doctor": z.object({ type: z.literal("computer.doctor") }).strict(),
  "computer.install_driver": z
    .object({ type: z.literal("computer.install_driver") })
    .strict(),
  "computer.request_permissions": z
    .object({
      type: z.literal("computer.request_permissions"),
      permission: computerPermissionIdSchema.optional(),
    })
    .strict(),
  "computer.observe": z
    .object({
      type: z.literal("computer.observe"),
      appId: z.string().max(160).optional(),
    })
    .strict(),
  "computer.act": z
    .object({
      type: z.literal("computer.act"),
      action: computerOperationSchema,
    })
    .strict(),
  "computer.capture": z
    .object({
      type: z.literal("computer.capture"),
      kind: z.enum(["desktop", "window"]),
      appId: z.string().max(160).optional(),
    })
    .strict(),
  "computer.record_start": z
    .object({
      type: z.literal("computer.record_start"),
      runId: computerRunIdSchema,
    })
    .strict(),
  "computer.record_stop": z
    .object({
      type: z.literal("computer.record_stop"),
      runId: computerRunIdSchema,
    })
    .strict(),
  "computer.input": z
    .object({
      type: z.literal("computer.input"),
      input: computerHumanInputSchema,
    })
    .strict(),
  "computer.clipboard_read": z
    .object({ type: z.literal("computer.clipboard_read") })
    .strict(),
  "computer.clipboard_write": z
    .object({
      type: z.literal("computer.clipboard_write"),
      text: z.string().max(COMPUTER_CLIPBOARD_MAX_CHARS),
      paste: z.boolean(),
    })
    .strict(),
};
export const computerCommandSchema = z.discriminatedUnion("type", [
  computerCommandSchemas["computer.doctor"],
  computerCommandSchemas["computer.install_driver"],
  computerCommandSchemas["computer.observe"],
  computerCommandSchemas["computer.act"],
  computerCommandSchemas["computer.capture"],
  computerCommandSchemas["computer.record_start"],
  computerCommandSchemas["computer.record_stop"],
  computerCommandSchemas["computer.input"],
  computerCommandSchemas["computer.clipboard_read"],
  computerCommandSchemas["computer.clipboard_write"],
]);
export const computerResultSchemas = {
  "computer.doctor": computerDoctorReportSchema,
  "computer.install_driver": computerDoctorReportSchema,
  "computer.request_permissions": computerDoctorReportSchema,
  "computer.observe": computerObservationSchema,
  "computer.act": computerActionOutcomeSchema,
  "computer.capture": computerCaptureImageSchema,
  "computer.record_start": z.object({ started: z.boolean() }).strict(),
  "computer.record_stop": z
    .object({
      videoPath: z.string().nullable(),
      trajectoryPath: z.string().nullable(),
    })
    .strict(),
  "computer.input": z.object({ summary: z.string().max(2_000) }).strict(),
  "computer.clipboard_read": z
    .object({ text: z.string().max(COMPUTER_CLIPBOARD_MAX_CHARS).nullable() })
    .strict(),
  "computer.clipboard_write": z.object({ written: z.boolean() }).strict(),
};
export type ComputerCommand = z.infer<typeof computerCommandSchema>;
export type ComputerCommandType = ComputerCommand["type"];
export type ComputerResult<T extends ComputerCommandType = ComputerCommandType> =
  z.infer<(typeof computerResultSchemas)[T]>;

export const computerLiveDemandMessageSchema = z
  .object({
    type: z.literal("computer.live.demand"),
    profile: computerLiveProfileSchema.nullable(),
    resync: z.boolean().optional(),
  })
  .strict();
export type ComputerLiveDemandMessage = z.infer<typeof computerLiveDemandMessageSchema>;

export const computerLiveStatusMessageSchema = z
  .object({
    type: z.literal("computer.live.status"),
    state: computerLiveStateSchema,
    message: z.string().max(1_000).nullable(),
  })
  .strict();
export type ComputerLiveStatusMessage = z.infer<typeof computerLiveStatusMessageSchema>;
