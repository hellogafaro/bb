import type { ToolCallResponse } from "@bb/domain";
import { boundJson, boundText, formatMcpResult } from "./catalog.js";

export const AGENT_REPLY_MAX_CHARS = 8_000;

function textResponse(text: string, success: boolean): ToolCallResponse {
  return { success, contentItems: [{ type: "inputText", text }] };
}

export async function agentReply(
  value: unknown,
  name: string,
  artifactDir: string,
): Promise<ToolCallResponse> {
  const formatted = formatMcpResult(value);
  const text = await boundText(formatted.text, {
    artifactDir,
    name,
    maxChars: AGENT_REPLY_MAX_CHARS,
  });
  return textResponse(text, !formatted.isError);
}

export async function agentData(
  value: unknown,
  name: string,
  artifactDir: string,
): Promise<ToolCallResponse> {
  const result = await boundJson(value, {
    artifactDir,
    name,
    maxChars: AGENT_REPLY_MAX_CHARS,
  });
  return textResponse(result.json, true);
}
