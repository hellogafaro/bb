import { z } from "zod";

export const BB_DESKTOP_WEBAUTHN_PROMPT_STATE_CHANNEL =
  "bb-desktop:webauthn-prompt:state";
export const BB_DESKTOP_WEBAUTHN_PROMPT_ACTION_CHANNEL =
  "bb-desktop:webauthn-prompt:action";

const MAX_TEXT_LENGTH = 512;

export const webauthnPromptStateSchema = z.discriminatedUnion("stage", [
  z
    .object({
      stage: z.literal("notice"),
      message: z.string().max(MAX_TEXT_LENGTH),
    })
    .strict(),
]);
export type WebauthnPromptState = z.infer<typeof webauthnPromptStateSchema>;

export const webauthnPromptActionRequestSchema = z
  .object({
    action: z.enum(["dismiss"]),
  })
  .strict();
export type WebauthnPromptActionRequest = z.infer<
  typeof webauthnPromptActionRequestSchema
>;
