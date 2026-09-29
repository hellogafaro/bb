import { z } from "zod";

export const BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL =
  "bb-desktop:webauthn-prompt:state";
export const BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL =
  "bb-desktop:webauthn-prompt:action";

const MAX_TEXT_LENGTH = 512;

export const webauthnPromptStateSchema = z.discriminatedUnion("stage", [
  z
    .object({
      stage: z.literal("ask"),
      host: z.string().max(MAX_TEXT_LENGTH),
      browserLabel: z.string().max(MAX_TEXT_LENGTH),
    })
    .strict(),
  z
    .object({
      stage: z.literal("handoff"),
      host: z.string().max(MAX_TEXT_LENGTH),
      browserLabel: z.string().max(MAX_TEXT_LENGTH),
    })
    .strict(),
  z
    .object({
      stage: z.literal("importing"),
      host: z.string().max(MAX_TEXT_LENGTH),
      browserLabel: z.string().max(MAX_TEXT_LENGTH),
    })
    .strict(),
  z
    .object({
      stage: z.literal("error"),
      host: z.string().max(MAX_TEXT_LENGTH),
      browserLabel: z.string().max(MAX_TEXT_LENGTH),
      message: z.string().max(MAX_TEXT_LENGTH),
      retryable: z.boolean(),
    })
    .strict(),
]);
export type WebauthnPromptState = z.infer<typeof webauthnPromptStateSchema>;

export const webauthnPromptActionRequestSchema = z
  .object({
    action: z.enum(["continue", "bring-to-bb", "retry", "cancel"]),
  })
  .strict();
export type WebauthnPromptActionRequest = z.infer<
  typeof webauthnPromptActionRequestSchema
>;
