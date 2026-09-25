import { providerGuardStatusSchema } from "@bb/host-daemon-contract";
import { z } from "zod";

export const providerGuardResponseSchema = z
  .object({
    hostId: z.string(),
    hostName: z.string(),
    status: providerGuardStatusSchema,
    issues: z.array(
      z
        .object({
          provider: z.enum(["claude", "codex"]),
          message: z.string(),
          fixable: z.boolean(),
        })
        .strict(),
    ),
    changes: z.array(z.string()),
    text: z.string(),
  })
  .strict();
export type ProviderGuardResponse = z.infer<typeof providerGuardResponseSchema>;

export const providerGuardFixRequestSchema = z
  .object({
    hostId: z.string().min(1).nullable(),
    projectPath: z.string().min(1).nullable(),
  })
  .strict();
export type ProviderGuardFixRequest = z.infer<
  typeof providerGuardFixRequestSchema
>;
