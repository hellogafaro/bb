import { z } from "zod";

const base64UrlString = z.string().regex(/^[A-Za-z0-9_-]*$/);

export const serializedPublicKeyCredentialDescriptorSchema = z
  .object({
    id: base64UrlString,
    type: z.literal("public-key"),
    transports: z.array(z.string()).optional(),
  })
  .strict();

export const serializedPublicKeyGetOptionsSchema = z
  .object({
    mode: z.literal("get"),
    challenge: base64UrlString,
    rpId: z.string().nullable(),
    timeout: z.number().nullable(),
    userVerification: z
      .enum(["required", "preferred", "discouraged"])
      .nullable(),
    allowCredentials: z
      .array(serializedPublicKeyCredentialDescriptorSchema)
      .nullable(),
  })
  .strict();

export const serializedPublicKeyCreateOptionsSchema = z
  .object({
    mode: z.literal("create"),
    rp: z.object({ id: z.string().nullable(), name: z.string() }).strict(),
    user: z
      .object({
        id: base64UrlString,
        name: z.string(),
        displayName: z.string(),
      })
      .strict(),
    challenge: base64UrlString,
    pubKeyCredParams: z
      .array(z.object({ type: z.literal("public-key"), alg: z.number() }).strict())
      .nullable(),
    timeout: z.number().nullable(),
    excludeCredentials: z
      .array(serializedPublicKeyCredentialDescriptorSchema)
      .nullable(),
    authenticatorSelection: z
      .object({
        authenticatorAttachment: z.string().nullable().optional(),
        residentKey: z.string().nullable().optional(),
        requireResidentKey: z.boolean().nullable().optional(),
        userVerification: z.string().nullable().optional(),
      })
      .strict()
      .nullable(),
    attestation: z
      .enum(["none", "indirect", "direct", "enterprise"])
      .nullable(),
  })
  .strict();

export const serializedPublicKeyOptionsSchema = z.discriminatedUnion("mode", [
  serializedPublicKeyGetOptionsSchema,
  serializedPublicKeyCreateOptionsSchema,
]);
export type SerializedPublicKeyOptions = z.infer<
  typeof serializedPublicKeyOptionsSchema
>;

export const nativeWebauthnGetRequestSchema = z
  .object({
    mode: z.literal("get"),
    origin: z.string(),
    rpId: z.string(),
    clientDataHash: base64UrlString,
    allowCredentials: z.array(serializedPublicKeyCredentialDescriptorSchema),
    userVerification: z.enum(["required", "preferred", "discouraged"]),
  })
  .strict();

export const nativeWebauthnCreateRequestSchema = z
  .object({
    mode: z.literal("create"),
    origin: z.string(),
    rpId: z.string(),
    rpName: z.string(),
    userId: base64UrlString,
    userName: z.string(),
    userDisplayName: z.string(),
    clientDataHash: base64UrlString,
    pubKeyCredParams: z.array(
      z.object({ type: z.literal("public-key"), alg: z.number() }).strict(),
    ),
    excludeCredentials: z.array(serializedPublicKeyCredentialDescriptorSchema),
    userVerification: z.enum(["required", "preferred", "discouraged"]),
    attestation: z.enum(["none", "indirect", "direct", "enterprise"]),
  })
  .strict();

export const nativeWebauthnRequestSchema = z.discriminatedUnion("mode", [
  nativeWebauthnGetRequestSchema,
  nativeWebauthnCreateRequestSchema,
]);
export type NativeWebauthnRequest = z.infer<typeof nativeWebauthnRequestSchema>;

export const WEBAUTHN_NATIVE_ERROR_NAMES = [
  "NotAllowedError",
  "InvalidStateError",
  "NotSupportedError",
  "AbortError",
  "UnknownError",
] as const;
export type WebauthnNativeErrorName = (typeof WEBAUTHN_NATIVE_ERROR_NAMES)[number];

export const nativeWebauthnGetSuccessSchema = z
  .object({
    ok: z.literal(true),
    mode: z.literal("get"),
    id: base64UrlString,
    rawId: base64UrlString,
    authenticatorData: base64UrlString,
    signature: base64UrlString,
    userHandle: base64UrlString.nullable(),
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).nullable(),
  })
  .strict();
export type NativeWebauthnGetSuccess = z.infer<
  typeof nativeWebauthnGetSuccessSchema
>;

export const nativeWebauthnCreateSuccessSchema = z
  .object({
    ok: z.literal(true),
    mode: z.literal("create"),
    id: base64UrlString,
    rawId: base64UrlString,
    attestationObject: base64UrlString,
    transports: z.array(z.string()),
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).nullable(),
  })
  .strict();
export type NativeWebauthnCreateSuccess = z.infer<
  typeof nativeWebauthnCreateSuccessSchema
>;

export const nativeWebauthnFailureSchema = z
  .object({
    ok: z.literal(false),
    errorName: z.enum(WEBAUTHN_NATIVE_ERROR_NAMES),
    message: z.string(),
  })
  .strict();
export type NativeWebauthnFailure = z.infer<typeof nativeWebauthnFailureSchema>;

export const nativeWebauthnResponseSchema = z.union([
  nativeWebauthnGetSuccessSchema,
  nativeWebauthnCreateSuccessSchema,
  nativeWebauthnFailureSchema,
]);
export type NativeWebauthnResponse = z.infer<typeof nativeWebauthnResponseSchema>;
