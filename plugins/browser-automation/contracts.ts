import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const idSchema = z.string().min(1).max(160);
export const sessionIdSchema = z.string().uuid();
export const profileNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "Profile names use letters, digits, '.', '_', or '-'",
  );
export type ProfileName = z.infer<typeof profileNameSchema>;
export const sessionSchema = z
  .object({
    id: sessionIdSchema,
    threadId: idSchema,
    hostId: idSchema,
    backend: z.enum(["desktop", "local"]),
    state: z.enum(["ready", "stopped", "closed"]),
    createdAt: z.number().int(),
    expiresAt: z.number().int(),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;
export const selectionSchema = z.discriminatedUnion("backend", [
  z.object({ backend: z.literal("local"), hostId: idSchema }).strict(),
  z
    .object({
      backend: z.literal("desktop"),
      hostId: idSchema,
      instanceId: idSchema,
      tabId: idSchema.optional(),
    })
    .strict(),
]);
export const openSchema = z
  .object({ threadId: idSchema, selection: selectionSchema })
  .strict();
export const ownedSchema = z
  .object({ threadId: idSchema, sessionId: sessionIdSchema })
  .strict();
export const runSchema = ownedSchema.extend({
  script: z.string().min(1).max(128_000),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
});
export const screenshotSchema = ownedSchema.extend({
  page: z.string().min(1).max(120).default("main"),
});
export const imageSchema = z
  .object({
    path: z.string().min(1),
    mimeType: z.literal("image/jpeg"),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();
export const outputSchema = z
  .object({
    text: z.string().max(160_000),
    images: z.array(imageSchema).max(4),
    exitCode: z.number().int(),
  })
  .strict();
export type RunOutput = z.infer<typeof outputSchema>;
export const previewFrameSchema = z
  .object({
    sequence: z.number().int().positive(),
    mimeType: z.literal("image/jpeg"),
    data: z.string().min(1).max(700_000),
    width: z.number().positive(),
    height: z.number().positive(),
    url: z.string().max(2_000),
    title: z.string().max(300),
  })
  .strict();
export type PreviewFrame = z.infer<typeof previewFrameSchema>;
export const previewSizeSchema = z.enum(["thumbnail", "full"]);
export type PreviewSize = z.infer<typeof previewSizeSchema>;
export const previewSchema = ownedSchema.extend({
  afterSequence: z.number().int().nonnegative().default(0),
  size: previewSizeSchema.default("thumbnail"),
});
export const previewOutputSchema = z
  .object({
    session: sessionSchema,
    frame: previewFrameSchema.nullable(),
    controlled: z.boolean(),
  })
  .strict();
export type PreviewOutput = z.infer<typeof previewOutputSchema>;
export const doSchema = ownedSchema.extend({
  goal: z.string().min(1).max(4_000),
  maxSteps: z.number().int().min(1).max(40).default(20),
  timeoutMs: z.number().int().min(5_000).max(300_000).default(120_000),
});
export const doStepSchema = z
  .object({
    index: z.number().int().nonnegative(),
    action: z.string().max(40),
    target: z.string().max(200).nullable(),
    outcome: z.string().max(400),
  })
  .strict();
export type DoStep = z.infer<typeof doStepSchema>;
export const doOutputSchema = z
  .object({
    state: z.enum(["done", "blocked", "max_steps"]),
    answer: z.string().max(4_000),
    steps: z.array(doStepSchema).max(40),
    image: imageSchema.nullable(),
  })
  .strict();
export type DoOutput = z.infer<typeof doOutputSchema>;
export const fillLoginSchema = ownedSchema.extend({
  page: z.string().min(1).max(120).default("main"),
  usernameSelector: z.string().min(1).max(2000),
  passwordSelector: z.string().min(1).max(2000),
  otpSelector: z.string().min(1).max(2000).optional(),
  submitSelector: z.string().min(1).max(2000).optional(),
  label: z.string().min(1).max(160).optional(),
});
export const fillOutputSchema = z
  .object({ filled: z.boolean(), fields: z.array(z.string()).max(8) })
  .strict();
export type FillOutput = z.infer<typeof fillOutputSchema>;
export const previewInputEventSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("mouseMove"), x: z.number(), y: z.number() })
    .strict(),
  z
    .object({
      type: z.literal("mouseDown"),
      x: z.number(),
      y: z.number(),
      button: z.enum(["left", "middle", "right"]),
      clickCount: z.number().int().min(1).max(3).default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("mouseUp"),
      x: z.number(),
      y: z.number(),
      button: z.enum(["left", "middle", "right"]),
      clickCount: z.number().int().min(1).max(3).default(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("wheel"),
      x: z.number(),
      y: z.number(),
      deltaX: z.number(),
      deltaY: z.number(),
    })
    .strict(),
  z
    .object({
      type: z.literal("keyDown"),
      key: z.string().min(1).max(40),
      code: z.string().min(1).max(40),
      text: z.string().max(8).optional(),
      modifiers: z.number().int().min(0).max(15).default(0),
    })
    .strict(),
  z
    .object({
      type: z.literal("keyUp"),
      key: z.string().min(1).max(40),
      code: z.string().min(1).max(40),
      modifiers: z.number().int().min(0).max(15).default(0),
    })
    .strict(),
  z
    .object({ type: z.literal("insertText"), text: z.string().min(1).max(200) })
    .strict(),
]);
export type PreviewInputEvent = z.infer<typeof previewInputEventSchema>;
export const inputSchema = ownedSchema.extend({
  event: previewInputEventSchema,
});
export const rpcContract = defineRpcContract({
  open: { input: openSchema, output: sessionSchema },
  list: {
    input: z.object({ threadId: idSchema }).strict(),
    output: z.array(sessionSchema).max(64),
  },
  run: { input: runSchema, output: outputSchema },
  do: { input: doSchema, output: doOutputSchema },
  pages: { input: ownedSchema, output: outputSchema },
  screenshot: { input: screenshotSchema, output: outputSchema },
  preview: { input: previewSchema, output: previewOutputSchema },
  fillLogin: { input: fillLoginSchema, output: fillOutputSchema },
  stop: { input: ownedSchema, output: sessionSchema },
  close: { input: ownedSchema, output: sessionSchema },
  takeover: { input: ownedSchema, output: z.null() },
  release: { input: ownedSchema, output: z.null() },
  input: { input: inputSchema, output: z.null() },
});
export const runtimeStateSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("ready"),
      version: z.string(),
      source: z.enum(["release", "developer-artifact"]),
    })
    .strict(),
  z.object({ status: z.literal("installing"), detail: z.string() }).strict(),
]);
export type RuntimeState = z.infer<typeof runtimeStateSchema>;
export const hostContract = defineRpcContract({
  prepare: { input: z.object({}).strict(), output: runtimeStateSchema },
  open: {
    input: z
      .object({
        sessionId: sessionIdSchema,
        connectionUrl: z.string().url().optional(),
        expiresAt: z.number().int(),
        idleTimeoutMs: z.number().int().positive(),
        profileName: profileNameSchema.optional(),
      })
      .strict(),
    output: z.null(),
  },
  run: {
    input: z
      .object({
        sessionId: sessionIdSchema,
        script: z.string().min(1).max(128_000),
        timeoutMs: z.number().int().min(1000).max(120_000),
      })
      .strict(),
    output: outputSchema,
  },
  preview: {
    input: z
      .object({
        sessionId: sessionIdSchema,
        afterSequence: z.number().int().nonnegative(),
        waitMs: z.number().int().min(0).max(10_000),
        size: previewSizeSchema,
      })
      .strict(),
    output: z.object({ frame: previewFrameSchema.nullable() }).strict(),
  },
  close: {
    input: z.object({ sessionId: sessionIdSchema }).strict(),
    output: z.null(),
  },
  input: {
    input: z
      .object({ sessionId: sessionIdSchema, event: previewInputEventSchema })
      .strict(),
    output: z.null(),
  },
});
