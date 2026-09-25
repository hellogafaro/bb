import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { deleteSecretFile, writeSecretFile } from "@bb/secret-storage";
import type { OAuthCredentialBackend, OAuthCredentialRecord } from "./oauth.js";

const CREDENTIALS_FILE = "oauth-credentials.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function parseCredentials(text: string): Record<string, OAuthCredentialRecord> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed))
    throw new Error("MCP OAuth credentials must be a JSON object");
  const records: Record<string, OAuthCredentialRecord> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!isRecord(value))
      throw new Error(`MCP OAuth credentials for ${key} must be a JSON object`);
    records[key] = value as OAuthCredentialRecord;
  }
  return records;
}

export function mcpOAuthCredentialFile(
  mcpDir: string,
  warn: (message: string) => void,
): OAuthCredentialBackend {
  const path = join(mcpDir, CREDENTIALS_FILE);
  return {
    async load() {
      let text: string;
      try {
        text = await readFile(path, "utf8");
      } catch (error) {
        if (isMissingFile(error)) return {};
        throw error;
      }
      if (!text.trim()) return {};
      try {
        return parseCredentials(text);
      } catch (error) {
        warn(
          `MCP OAuth credential store is invalid: ${error instanceof Error ? error.message : String(error)}`,
        );
        return {};
      }
    },
    async save(value) {
      if (Object.keys(value).length === 0) await deleteSecretFile(path);
      else await writeSecretFile(path, JSON.stringify(value));
    },
  };
}
