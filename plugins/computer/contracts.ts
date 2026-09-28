import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const hostIdSchema = z.string().min(1).max(160);
export const runIdSchema = z.string().uuid();

export const imageMimeTypeSchema = z.enum(["image/jpeg", "image/png"]);
export type ImageMimeType = z.infer<typeof imageMimeTypeSchema>;

export const boundsSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  })
  .strict();
export type Bounds = z.infer<typeof boundsSchema>;

export const targetSchema = z
  .object({
    index: z.number().int().nonnegative(),
    targetId: z.string().min(1).max(80),
    role: z.string().max(80),
    name: z.string().max(300),
    value: z.string().max(500).nullable(),
    bounds: boundsSchema.nullable(),
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
export type Target = z.infer<typeof targetSchema>;

export const observationSchema = z
  .object({
    hostId: hostIdSchema,
    surface: z.enum(["desktop", "browser"]),
    title: z.string().max(500),
    snapshotId: z.string().min(1).max(64),
    observedAt: z.number().int(),
    targets: z.array(targetSchema).max(1_000),
    hint: z.string().max(500).nullable(),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;

export const operationKindSchema = z.enum([
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
export type OperationKind = z.infer<typeof operationKindSchema>;

export const operationSchema = z.discriminatedUnion("kind", [
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
export type Operation = z.infer<typeof operationSchema>;

export const actionOutcomeSchema = z
  .object({
    state: z.enum(["completed", "stale", "blocked", "error"]),
    summary: z.string().max(2_000),
    observation: observationSchema.nullable(),
  })
  .strict();
export type ActionOutcome = z.infer<typeof actionOutcomeSchema>;

export const doctorProbeSchema = z
  .object({
    label: z.string(),
    status: z.enum(["ok", "setup-required", "unavailable"]),
    message: z.string(),
  })
  .strict();
export const doctorReportSchema = z
  .object({
    hostId: hostIdSchema,
    state: z.enum(["ready", "setup-required", "unavailable"]),
    version: z.string().nullable(),
    probes: z.array(doctorProbeSchema).max(16),
  })
  .strict();
export type DoctorReport = z.infer<typeof doctorReportSchema>;

export const captureImageSchema = z
  .object({
    mimeType: imageMimeTypeSchema,
    dataBase64: z.string().min(1).max(3_500_000),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export type CaptureImage = z.infer<typeof captureImageSchema>;

export const previewSizeSchema = z.enum(["thumbnail", "full"]);
export type PreviewSize = z.infer<typeof previewSizeSchema>;

export const previewFrameSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    state: z.enum(["live", "paused", "redacted", "disconnected", "none"]),
    mimeType: imageMimeTypeSchema.nullable(),
    dataBase64: z.string().nullable(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    capturedAt: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type PreviewFrame = z.infer<typeof previewFrameSchema>;

export const runStateSchema = z.enum([
  "idle",
  "observing",
  "deciding",
  "acting",
  "escalated",
  "blocked",
  "done",
  "cancelled",
  "error",
]);
export type RunState = z.infer<typeof runStateSchema>;

export const runModeSchema = z.enum(["agent", "jev"]);
export type RunMode = z.infer<typeof runModeSchema>;

export const runStatusSchema = z
  .object({
    runId: runIdSchema,
    hostId: hostIdSchema,
    mode: runModeSchema,
    goal: z.string().max(2_000),
    state: runStateSchema,
    steps: z.number().int().nonnegative(),
    noProgressSteps: z.number().int().nonnegative(),
    lastSummary: z.string().max(2_000).nullable(),
    startedAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();
export type RunStatus = z.infer<typeof runStatusSchema>;

export const startInputSchema = z
  .object({
    hostId: hostIdSchema,
    goal: z.string().min(1).max(2_000),
    allowedApps: z.array(z.string().max(160)).max(20).default([]),
    allowedOperations: z.array(operationKindSchema).max(10).optional(),
    maxSteps: z.number().int().min(1).max(200).default(40),
    mode: runModeSchema.default("agent"),
  })
  .strict();
export type StartInput = z.infer<typeof startInputSchema>;

export const rpcContract = defineRpcContract({
  machines: {
    input: z.object({}).strict(),
    output: z.object({
      machines: z.array(
        z.object({ hostId: hostIdSchema, name: z.string() }).strict(),
      ),
    }),
  },
  doctor: {
    input: z.object({ hostId: hostIdSchema }).strict(),
    output: doctorReportSchema,
  },
  observe: {
    input: z
      .object({ hostId: hostIdSchema, appId: z.string().max(160).optional() })
      .strict(),
    output: observationSchema,
  },
  act: {
    input: z.object({ hostId: hostIdSchema, action: operationSchema }).strict(),
    output: actionOutcomeSchema,
  },
  screenshot: {
    input: z
      .object({
        hostId: hostIdSchema,
        threadId: z.string().min(1),
        appId: z.string().max(160).optional(),
      })
      .strict(),
    output: z
      .object({ path: z.string(), mimeType: imageMimeTypeSchema })
      .strict(),
  },
  record: {
    input: z
      .object({
        hostId: hostIdSchema,
        threadId: z.string().min(1),
        action: z.enum(["start", "stop"]),
        runId: runIdSchema,
      })
      .strict(),
    output: z
      .object({
        recording: z.boolean(),
        path: z.string().nullable(),
        trajectoryPath: z.string().nullable(),
      })
      .strict(),
  },
  start: { input: startInputSchema, output: runStatusSchema },
  status: {
    input: z.object({ runId: runIdSchema }).strict(),
    output: runStatusSchema,
  },
  cancel: {
    input: z.object({ runId: runIdSchema }).strict(),
    output: runStatusSchema,
  },
  activeRun: {
    input: z.object({ hostId: hostIdSchema }).strict(),
    output: z.object({ runId: runIdSchema.nullable() }).strict(),
  },
  takeControl: {
    input: z.object({ hostId: hostIdSchema, clientId: z.string().min(1) }).strict(),
    output: z.object({ owner: z.enum(["human", "busy"]) }).strict(),
  },
  releaseControl: {
    input: z.object({ hostId: hostIdSchema, clientId: z.string().min(1) }).strict(),
    output: z.object({ released: z.boolean() }).strict(),
  },
  controlStatus: {
    input: z.object({ hostId: hostIdSchema, clientId: z.string().min(1) }).strict(),
    output: z.object({ owner: z.enum(["you", "other", "agent"]) }).strict(),
  },
  preview: {
    input: z
      .object({
        hostId: hostIdSchema,
        viewerId: z.string().min(1).max(80),
        size: previewSizeSchema.default("thumbnail"),
        afterSequence: z.number().int().nonnegative().nullable(),
      })
      .strict(),
    output: previewFrameSchema,
  },
});

export const hostContract = defineRpcContract({
  doctor: {
    input: z.object({}).strict(),
    output: doctorReportSchema.omit({ hostId: true }),
  },
  observe: {
    input: z.object({ appId: z.string().max(160).optional() }).strict(),
    output: observationSchema.omit({ hostId: true }),
  },
  act: {
    input: z.object({ action: operationSchema }).strict(),
    output: actionOutcomeSchema.omit({ observation: true }).extend({
      observation: observationSchema.omit({ hostId: true }).nullable(),
    }),
  },
  capture: {
    input: z
      .object({ kind: z.enum(["desktop", "window"]), appId: z.string().optional() })
      .strict(),
    output: captureImageSchema,
  },
  recordStart: {
    input: z.object({ runId: runIdSchema }).strict(),
    output: z.object({ started: z.boolean() }).strict(),
  },
  recordStop: {
    input: z.object({ runId: runIdSchema }).strict(),
    output: z
      .object({
        videoPath: z.string().nullable(),
        trajectoryPath: z.string().nullable(),
      })
      .strict(),
  },
  previewTouch: {
    input: z.object({ viewerId: z.string().min(1), size: previewSizeSchema.default("thumbnail") }).strict(),
    output: z.object({ ok: z.boolean() }).strict(),
  },
  previewLatest: {
    input: z.object({ afterSequence: z.number().int().nonnegative().nullable() }).strict(),
    output: previewFrameSchema,
  },
});
