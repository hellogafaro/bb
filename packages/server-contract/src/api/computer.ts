import {
  computerActionOutcomeSchema,
  computerCaptureImageSchema,
  computerDoctorReportSchema,
  computerObservationSchema,
  computerOperationKindSchema,
  computerOperationSchema,
  computerHumanInputSchema,
  computerLiveProfileSchema,
  computerLiveStateSchema,
  computerRunIdSchema,
  COMPUTER_CLIPBOARD_MAX_CHARS,
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

export const computerRunStepTraceSchema = z
  .object({
    step: z.number().int().nonnegative(),
    windowTitle: z.string().max(500),
    targetCount: z.number().int().nonnegative(),
    offeredOperations: z.array(computerOperationKindSchema).max(20),
    chosenOperation: computerOperationKindSchema,
    chosenTargetId: z.string().max(80).nullable(),
    chosenConfidence: z.number().nullable(),
    textCandidate: z.string().max(2_000).nullable(),
    submitProbability: z.number().nullable(),
    goalCompleteProbability: z.number(),
    confirmProbability: z.number().nullable(),
    outcomeState: z.string().max(40),
    outcomeSummary: z.string().max(2_000),
    costUsd: z.number().nullable(),
    timingsMs: z
      .object({
        observe: z.number().nonnegative(),
        decide: z.number().nonnegative(),
        act: z.number().nonnegative(),
        wait: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();
export type ComputerRunStepTrace = z.infer<typeof computerRunStepTraceSchema>;

export const COMPUTER_RUN_TRACE_MAX_STEPS = 50;

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
    lastObservation: computerObservationWithHostSchema.nullable(),
    trace: z.array(computerRunStepTraceSchema).max(COMPUTER_RUN_TRACE_MAX_STEPS),
    jevCostUsd: z.number().nonnegative(),
    jevModel: z.string().max(200).nullable(),
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
    mode: computerRunModeSchema.optional(),
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

export const computerLiveSocketQuerySchema = z
  .object({
    clientId: z.string().min(1).max(200),
    profile: computerLiveProfileSchema,
  })
  .strict();
export type ComputerLiveSocketQuery = z.infer<typeof computerLiveSocketQuerySchema>;

export function buildComputerLiveWebSocketPath(
  args: { hostId: string } & ComputerLiveSocketQuery,
): string {
  const query = new URLSearchParams({ clientId: args.clientId, profile: args.profile });
  return `/ws/computer/${encodeURIComponent(args.hostId)}?${query.toString()}`;
}

const liveRequestId = z.string().min(1).max(80);

export const computerLiveClientMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("input"),
      requestId: liveRequestId.nullable(),
      input: computerHumanInputSchema,
    })
    .strict(),
  z.object({ type: z.literal("clipboard.read"), requestId: liveRequestId }).strict(),
  z
    .object({
      type: z.literal("clipboard.write"),
      requestId: liveRequestId,
      text: z.string().max(COMPUTER_CLIPBOARD_MAX_CHARS),
      paste: z.boolean(),
    })
    .strict(),
]);
export type ComputerLiveClientMessage = z.infer<typeof computerLiveClientMessageSchema>;

export const computerControlOwnerSchema = z.enum(["you", "other", "agent"]);
export type ComputerControlOwner = z.infer<typeof computerControlOwnerSchema>;

export const computerLiveServerMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("status"),
      state: computerLiveStateSchema,
      message: z.string().nullable(),
      control: computerControlOwnerSchema,
      runId: z.string().nullable(),
      fps: z.number().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("clipboard"),
      requestId: liveRequestId,
      text: z.string().nullable(),
    })
    .strict(),
  z.object({ type: z.literal("clipboard.written"), requestId: liveRequestId }).strict(),
  z.object({ type: z.literal("input.done"), requestId: liveRequestId }).strict(),
  z
    .object({
      type: z.literal("error"),
      requestId: liveRequestId.nullable(),
      code: z.string(),
      message: z.string(),
    })
    .strict(),
]);
export type ComputerLiveServerMessage = z.infer<typeof computerLiveServerMessageSchema>;

export type ComputerCaptureImage = z.infer<typeof computerCaptureImageSchema>;
