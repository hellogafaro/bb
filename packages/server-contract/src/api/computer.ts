import {
  computerActionOutcomeSchema,
  computerCaptureImageSchema,
  computerDoctorReportSchema,
  computerObservationSchema,
  computerOperationKindSchema,
  computerOperationSchema,
  computerPreviewFrameSchema,
  computerPreviewSizeSchema,
  computerRunIdSchema,
} from "@bb/host-daemon-contract";
import { z } from "zod";

const hostId = z.string().min(1).max(160);

export const computerObservationWithHostSchema = computerObservationSchema
  .extend({ hostId })
  .strict();
export type ComputerObservation = z.infer<
  typeof computerObservationWithHostSchema
>;

export const computerActionOutcomeWithHostSchema = computerActionOutcomeSchema
  .extend({ observation: computerObservationWithHostSchema.nullable() })
  .strict();
export type ComputerActionOutcome = z.infer<
  typeof computerActionOutcomeWithHostSchema
>;

export const computerDoctorReportWithHostSchema = computerDoctorReportSchema
  .extend({ hostId })
  .strict();
export type ComputerDoctorReport = z.infer<
  typeof computerDoctorReportWithHostSchema
>;

export const computerRunStateSchema = z.enum([
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
export type ComputerRunState = z.infer<typeof computerRunStateSchema>;

export const computerRunModeSchema = z.enum(["agent", "jev"]);
export type ComputerRunMode = z.infer<typeof computerRunModeSchema>;

export const computerRunStatusSchema = z
  .object({
    runId: computerRunIdSchema,
    hostId,
    mode: computerRunModeSchema,
    goal: z.string().max(2_000),
    state: computerRunStateSchema,
    steps: z.number().int().nonnegative(),
    noProgressSteps: z.number().int().nonnegative(),
    lastSummary: z.string().max(2_000).nullable(),
    startedAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .strict();
export type ComputerRunStatus = z.infer<typeof computerRunStatusSchema>;

export const computerMachineSummarySchema = z
  .object({
    hostId,
    name: z.string(),
    status: z.enum(["connected", "disconnected"]),
    type: z.enum(["persistent", "ephemeral"]),
    lastSeenAt: z.number().int().nullable(),
  })
  .strict();
export type ComputerMachineSummary = z.infer<
  typeof computerMachineSummarySchema
>;

export const computerMachinesRequestSchema = z
  .object({ threadId: z.string().min(1).optional() })
  .strict();
export type ComputerMachinesRequest = z.infer<
  typeof computerMachinesRequestSchema
>;
export type ComputerMachinesResponse = {
  machines: ComputerMachineSummary[];
  currentHostId: string | null;
};

export const computerHostRequestSchema = z.object({ hostId }).strict();
export type ComputerHostRequest = z.infer<typeof computerHostRequestSchema>;

export const computerPermissionIdSchema = z.enum(["accessibility", "screen-recording"]);
export type ComputerPermissionId = z.infer<typeof computerPermissionIdSchema>;
export const computerRequestPermissionsRequestSchema = z
  .object({ hostId, permission: computerPermissionIdSchema.optional() })
  .strict();
export type ComputerRequestPermissionsRequest = z.infer<
  typeof computerRequestPermissionsRequestSchema
>;

export const computerObserveRequestSchema = z
  .object({ hostId, appId: z.string().max(160).optional() })
  .strict();
export type ComputerObserveRequest = z.infer<
  typeof computerObserveRequestSchema
>;

export const computerActRequestSchema = z
  .object({ hostId, action: computerOperationSchema })
  .strict();
export type ComputerActRequest = z.infer<typeof computerActRequestSchema>;
export type ComputerActInput = z.input<typeof computerActRequestSchema>;

export const computerScreenshotRequestSchema = z
  .object({
    hostId,
    threadId: z.string().min(1),
    appId: z.string().max(160).optional(),
  })
  .strict();
export type ComputerScreenshotRequest = z.infer<
  typeof computerScreenshotRequestSchema
>;
export type ComputerScreenshotResponse = {
  path: string;
  mimeType: "image/jpeg" | "image/png";
};

export const computerRecordRequestSchema = z
  .object({
    hostId,
    threadId: z.string().min(1),
    action: z.enum(["start", "stop"]),
    runId: computerRunIdSchema,
  })
  .strict();
export type ComputerRecordRequest = z.infer<typeof computerRecordRequestSchema>;
export type ComputerRecordResponse = {
  recording: boolean;
  path: string | null;
  trajectoryPath: string | null;
};

export const computerStartRequestSchema = z
  .object({
    hostId,
    goal: z.string().min(1).max(2_000),
    allowedApps: z.array(z.string().max(160)).max(20).default([]),
    allowedOperations: z.array(computerOperationKindSchema).max(10).optional(),
    maxSteps: z.number().int().min(1).max(200).default(40),
    mode: computerRunModeSchema.default("agent"),
  })
  .strict();
export type ComputerStartRequest = z.infer<typeof computerStartRequestSchema>;
export type ComputerStartInput = z.input<typeof computerStartRequestSchema>;

export const computerRunRequestSchema = z
  .object({ runId: computerRunIdSchema })
  .strict();
export type ComputerRunRequest = z.infer<typeof computerRunRequestSchema>;

export const computerActiveRunRequestSchema = computerHostRequestSchema;
export type ComputerActiveRunRequest = z.infer<
  typeof computerActiveRunRequestSchema
>;
export type ComputerActiveRunResponse = { runId: string | null };

export const computerControlRequestSchema = z
  .object({ hostId, clientId: z.string().min(1) })
  .strict();
export type ComputerControlRequest = z.infer<
  typeof computerControlRequestSchema
>;
export type ComputerTakeControlResponse = { owner: "human" | "busy" };
export type ComputerReleaseControlResponse = { released: boolean };
export type ComputerControlStatusResponse = { owner: "you" | "other" | "agent" };

export const computerPreviewRequestSchema = z
  .object({
    hostId,
    viewerId: z.string().min(1).max(80),
    size: computerPreviewSizeSchema.default("thumbnail"),
    afterSequence: z.number().int().nonnegative().nullable(),
  })
  .strict();
export type ComputerPreviewRequest = z.infer<
  typeof computerPreviewRequestSchema
>;
export type ComputerPreviewInput = z.input<typeof computerPreviewRequestSchema>;
export type ComputerPreviewFrame = z.infer<typeof computerPreviewFrameSchema>;

export type ComputerCaptureImage = z.infer<typeof computerCaptureImageSchema>;
