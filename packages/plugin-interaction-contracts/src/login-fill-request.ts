import { z } from "zod";

export const LOGIN_FILL_RENDERER_ID = "login-fill-request";

const FIELD_VALUE_MAX_LENGTH = 4096;

export const loginFillFieldNameSchema = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/u);

export const loginFillPayloadSchema = z.object({
  label: z.string().min(1).nullable(),
  fields: z
    .array(
      z.object({
        name: loginFillFieldNameSchema,
        kind: z.enum(["text", "password"]),
      }),
    )
    .min(1),
});
export type LoginFillPayload = z.infer<typeof loginFillPayloadSchema>;

const loginFillValueSchema = z
  .string()
  .min(1)
  .max(FIELD_VALUE_MAX_LENGTH)
  .refine((value) => !value.includes("\n") && !value.includes("\r"), {
    message: "Login field values must be single-line strings",
  })
  .refine((value) => !value.includes("\0"), {
    message: "Login field values must not contain NUL",
  });

export const loginFillResponseSchema = z.object({
  values: z.record(loginFillFieldNameSchema, loginFillValueSchema),
});
export type LoginFillResponse = z.infer<typeof loginFillResponseSchema>;
