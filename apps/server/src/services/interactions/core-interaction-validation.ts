import { isDeepStrictEqual } from "node:util";
import {
  corePendingInteractionResolutionSchema,
  mcpElicitationValueSchema,
  type CorePendingInteraction,
  type CorePendingInteractionResolution,
  type JsonValue,
  type PendingInteractionResolution,
} from "@bb/domain";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { validElicitationContent } from "../mcp/elicitation.js";

const approvalResponseSchema = z.object({ allowed: z.boolean() }).strict();

const elicitationResponseSchema = z.union([
  z
    .object({
      action: z.literal("accept"),
      content: z.record(z.string(), mcpElicitationValueSchema),
    })
    .strict(),
  z.object({ action: z.literal("decline") }).strict(),
]);

function invalidResponse(message: string): ApiError {
  return new ApiError(400, "invalid_request", message);
}

export function coreResolutionFromResponse(
  interaction: CorePendingInteraction,
  value: JsonValue,
): CorePendingInteractionResolution {
  const kinded = corePendingInteractionResolutionSchema.safeParse(value);
  if (kinded.success) return kinded.data;
  if (interaction.payload.kind === "mcp_approval") {
    const parsed = approvalResponseSchema.safeParse(value);
    if (!parsed.success) {
      throw invalidResponse('MCP approvals take {"allowed": true|false}');
    }
    return { kind: "mcp_approval", allowed: parsed.data.allowed };
  }
  const parsed = elicitationResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw invalidResponse(
      'MCP questions take {"action": "accept", "content": {...}} or {"action": "decline"}',
    );
  }
  return { kind: "mcp_elicitation", ...parsed.data };
}

export function validateCoreInteractionResolution(
  interaction: CorePendingInteraction,
  resolution: PendingInteractionResolution,
): void {
  const parsed = corePendingInteractionResolutionSchema.safeParse(resolution);
  if (!parsed.success || parsed.data.kind !== interaction.payload.kind) {
    throw invalidResponse(
      `Only an ${interaction.payload.kind} answer can resolve this interaction`,
    );
  }
  const answer = parsed.data;
  if (
    interaction.payload.kind === "mcp_elicitation" &&
    answer.kind === "mcp_elicitation" &&
    answer.action === "accept" &&
    validElicitationContent(interaction.payload.fields, answer.content) === null
  ) {
    throw invalidResponse("The answer does not fit the requested form");
  }
}

export function coreResolutionEquals(
  left: PendingInteractionResolution,
  right: PendingInteractionResolution,
): boolean {
  return isDeepStrictEqual(left, right);
}
