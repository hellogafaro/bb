import { z } from "zod";
import { secretNameSchema } from "@bb/plugin-interaction-contracts";

export const infisicalDestinationSchema = z.object({
  kind: z.literal("infisical"),
  project: z.string().min(1).nullable(),
  env: z.string().min(1),
  path: z.string().min(1),
});
export type InfisicalDestination = z.infer<typeof infisicalDestinationSchema>;

export const infisicalSecretRequestPayloadSchema = z.object({
  purpose: z.string().min(1).nullable(),
  destination: infisicalDestinationSchema,
  fields: z
    .array(
      z.object({
        name: secretNameSchema,
        description: z.string().min(1).nullable(),
      }),
    )
    .min(1),
});
export type InfisicalSecretRequestPayload = z.infer<
  typeof infisicalSecretRequestPayloadSchema
>;
