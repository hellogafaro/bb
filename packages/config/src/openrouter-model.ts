const OPENROUTER_MODEL_ID_PATTERN = /^[^/\s]+\/\S+$/u;
const RETIRED_SERVICE_PREFIXES = ["codex/", "openrouter/"];

interface ValidateOpenRouterModelIdArgs {
  name: string;
  value: string;
  example: string;
}

export function validateOpenRouterModelId(
  args: ValidateOpenRouterModelIdArgs,
): string {
  const trimmed = args.value.trim();
  if (!OPENROUTER_MODEL_ID_PATTERN.test(trimmed)) {
    throw new Error(
      `${args.name} must name an OpenRouter model id such as ${args.example}, received "${args.value}"`,
    );
  }
  const retiredPrefix = RETIRED_SERVICE_PREFIXES.find((prefix) =>
    trimmed.startsWith(prefix),
  );
  if (retiredPrefix !== undefined) {
    throw new Error(
      `${args.name} is an OpenRouter model id without a service prefix (received "${args.value}"); drop the "${retiredPrefix}" prefix and set OPENROUTER_API_KEY`,
    );
  }
  return trimmed;
}

export function validateInferenceModel(value: string): string {
  return validateOpenRouterModelId({
    name: "BB_INFERENCE",
    value,
    example: "openai/gpt-5.4-mini",
  });
}

export function validateTranscriptionModel(value: string): string {
  return validateOpenRouterModelId({
    name: "BB_TRANSCRIPTION",
    value,
    example: "mistralai/voxtral-mini-transcribe",
  });
}
