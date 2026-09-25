import { pendingInteractionSchema, type PendingInteraction } from "@bb/domain";
import type { PendingInteractionRow } from "@bb/db";
import { ApiError } from "../../errors.js";

export class PendingInteractionSerializationError extends ApiError {
  readonly interactionId: string;
  readonly field: "payload" | "resolution";

  constructor(interactionId: string, field: "payload" | "resolution") {
    super(
      500,
      "internal_error",
      `Stored pending interaction ${field} is invalid`,
    );
    this.interactionId = interactionId;
    this.field = field;
  }
}

function parseStoredPendingInteractionJson(
  row: PendingInteractionRow,
  field: "payload" | "resolution",
): unknown {
  const value = field === "payload" ? row.payload : row.resolution;
  if (value === null) {
    throw new PendingInteractionSerializationError(row.id, field);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new PendingInteractionSerializationError(row.id, field);
  }
}

function storedOrigin(row: PendingInteractionRow) {
  switch (row.originKind) {
    case "provider":
      return {
        kind: "provider",
        providerId: row.providerId,
        providerThreadId: row.providerThreadId,
        providerRequestId: row.providerRequestId,
      };
    case "plugin":
      return {
        kind: "plugin",
        pluginId: row.pluginId,
        rendererId: row.rendererId,
      };
    case "core":
      return { kind: "core" };
  }
}

export function toPendingInteraction(
  row: PendingInteractionRow,
): PendingInteraction {
  const payload = parseStoredPendingInteractionJson(row, "payload");
  const resolution =
    row.resolution === null
      ? null
      : parseStoredPendingInteractionJson(row, "resolution");

  try {
    return pendingInteractionSchema.parse({
      id: row.id,
      threadId: row.threadId,
      turnId: row.turnId,
      ...(row.originKind === "provider"
        ? {
            providerId: row.providerId,
            providerThreadId: row.providerThreadId,
            providerRequestId: row.providerRequestId,
          }
        : {}),
      origin: storedOrigin(row),
      status: row.status,
      payload,
      resolution,
      statusReason: row.statusReason,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      resolvedAt: row.resolvedAt,
    });
  } catch {
    throw new PendingInteractionSerializationError(row.id, "payload");
  }
}
