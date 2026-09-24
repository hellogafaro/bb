export const DEFAULTS = {
  appVersion: "0.0.0-dev",
  logLevel: { prod: "info", dev: "debug" },
  secretToken: { dev: "dev-secret" },
  inferenceModel: "openai/gpt-5.4-mini",
  transcriptionModel: "mistralai/voxtral-mini-transcribe",
} as const;
