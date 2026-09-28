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
  "wait",
  "done",
  "blocked",
]);
export type ComputerOperationKind = z.infer<typeof computerOperationKindSchema>;

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

export const computerPreviewSizeSchema = z.enum(["thumbnail", "full"]);
export type ComputerPreviewSize = z.infer<typeof computerPreviewSizeSchema>;

export const computerPreviewFrameSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    state: z.enum(["live", "paused", "redacted", "disconnected", "none"]),
    mimeType: computerImageMimeTypeSchema.nullable(),
    dataBase64: z.string().nullable(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    capturedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ComputerPreviewFrame = z.infer<typeof computerPreviewFrameSchema>;

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
  "computer.preview_touch": z
    .object({
      type: z.literal("computer.preview_touch"),
      viewerId: z.string().min(1).max(80),
      size: computerPreviewSizeSchema.default("thumbnail"),
    })
    .strict(),
  "computer.preview_latest": z
    .object({
      type: z.literal("computer.preview_latest"),
      afterSequence: z.number().int().nonnegative().nullable(),
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
  computerCommandSchemas["computer.preview_touch"],
  computerCommandSchemas["computer.preview_latest"],
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
  "computer.preview_touch": z.object({ ok: z.boolean() }).strict(),
  "computer.preview_latest": computerPreviewFrameSchema,
};
export type ComputerCommand = z.infer<typeof computerCommandSchema>;
export type ComputerCommandType = ComputerCommand["type"];
export type ComputerResult<T extends ComputerCommandType = ComputerCommandType> =
  z.infer<(typeof computerResultSchemas)[T]>;
