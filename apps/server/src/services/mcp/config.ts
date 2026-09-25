import { z } from "zod";
import type { McpServerType } from "./types.js";

export interface McpServerResult {
  valid: boolean;
  type: McpServerType | null;
  errors: string[];
  config: Record<string, unknown> | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype
  );
}

function safeRecord(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) return Object.create(null);
  const out: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(input)) out[k] = v;
  return out;
}

function hasShellMeta(value: string): boolean {
  return /[\s|&;`$()<>\"']/.test(value);
}

export function validateMcpServer(raw: unknown): McpServerResult {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return {
      valid: false,
      type: null,
      errors: ["server entry must be object"],
      config: null,
    };
  }
  const rec = safeRecord(raw);
  const type = rec.type;
  if (type !== "stdio" && type !== "streamable-http" && type !== "sse") {
    return {
      valid: false,
      type: null,
      errors: [`invalid type: ${String(type)}`],
      config: null,
    };
  }

  const allowedByType: Record<McpServerType, Set<string>> = {
    stdio: new Set(["type", "command", "args", "env", "cwd"]),
    "streamable-http": new Set(["type", "url", "headers"]),
    sse: new Set(["type", "url", "headers"]),
  };
  for (const k of Object.keys(rec)) {
    if (!allowedByType[type].has(k))
      errors.push(`unknown field for ${type}: ${k}`);
  }

  if (type === "stdio") {
    const command = rec.command;
    if (typeof command !== "string" || command.length === 0)
      errors.push("stdio command must be non-empty string");
    else {
      if (command.includes("\0")) errors.push("invalid command: NUL");
      if (hasShellMeta(command))
        errors.push("command must be single token without shell metachars");
      if (
        command.includes("${PLUGIN_ROOT}") ||
        command.includes("${PLUGIN_DATA}")
      )
        errors.push("command must not contain placeholders");
      const isPluginRelative = command.startsWith("./");
      const isAbsolute = command.startsWith("/");
      if (!isPluginRelative && !isAbsolute) {
        if (command.includes("/") || command.includes("\\"))
          errors.push(
            "command must be bare name, absolute path, or ./-prefixed path",
          );
        else if (!/^[a-zA-Z0-9._-]+$/.test(command))
          errors.push("command must be a bare executable name");
      } else if (command.split("/").includes("..")) {
        errors.push("command must not contain .. segments");
      }
      if (command.length > 1024) errors.push("command too long");
    }
    if ("args" in rec && rec.args !== undefined) {
      if (
        !Array.isArray(rec.args) ||
        !rec.args.every((v) => typeof v === "string")
      )
        errors.push("args must be string[]");
    }
    if ("env" in rec && rec.env !== undefined) {
      if (!isRecord(rec.env)) errors.push("env must be object");
      else {
        for (const [k, v] of Object.entries(rec.env)) {
          if (typeof v !== "string") errors.push(`env.${k} must be string`);
          const reserved = k.toUpperCase();
          if (reserved === "PLUGIN_ROOT" || reserved === "PLUGIN_DATA")
            errors.push(`env must not contain ${k}`);
        }
      }
    }
    if ("cwd" in rec && rec.cwd !== undefined) {
      if (typeof rec.cwd !== "string" || rec.cwd.length === 0)
        errors.push("cwd must be non-empty string");
      else {
        const c = rec.cwd;
        const ok =
          c.startsWith("./") ||
          c.startsWith("/") ||
          c === "${PLUGIN_ROOT}" ||
          c.startsWith("${PLUGIN_ROOT}/") ||
          c === "${PLUGIN_DATA}" ||
          c.startsWith("${PLUGIN_DATA}/");
        if (!ok)
          errors.push(
            `cwd must be absolute, ./…, or \${PLUGIN_ROOT}/\${PLUGIN_DATA}`,
          );
        else if (c.split("/").includes(".."))
          errors.push(`cwd must not contain .. segments: ${c}`);
      }
    }
  } else {
    const url = rec.url;
    if (typeof url !== "string" || url.length === 0)
      errors.push("url must be non-empty string");
    else {
      try {
        const u = new URL(url);
        if (u.protocol !== "https:" && u.protocol !== "http:")
          errors.push("url must be http or https");
        if (u.username || u.password)
          errors.push("url must not contain userinfo");
        if (u.hash) errors.push("url must not contain fragment");
        if (u.protocol === "http:") {
          const host = u.hostname.toLowerCase();
          const isLoopback =
            host === "localhost" ||
            host === "127.0.0.1" ||
            host === "::1" ||
            host === "[::1]";
          if (!isLoopback) errors.push("non-loopback url must be https");
        }
        if (url.includes("\r") || url.includes("\n"))
          errors.push("url must not contain CRLF");
      } catch {
        errors.push(`invalid url: ${url}`);
      }
    }
    if ("headers" in rec && rec.headers !== undefined) {
      if (!isRecord(rec.headers)) errors.push("headers must be object");
      else {
        const seenLower = new Set<string>();
        for (const [k, v] of Object.entries(rec.headers)) {
          if (typeof v !== "string") {
            errors.push(`headers.${k} must be string`);
            continue;
          }
          const lower = k.toLowerCase();
          if (seenLower.has(lower))
            errors.push(`duplicate header (case-insensitive): ${k}`);
          seenLower.add(lower);
          if (!/^[!#$%&'*+\-.0-9A-Za-z^_`|~]+$/.test(k))
            errors.push(`invalid header name: ${k}`);
          if (
            k.includes("\r") ||
            k.includes("\n") ||
            v.includes("\r") ||
            v.includes("\n")
          )
            errors.push(`header must not contain CRLF: ${k}`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    type,
    errors,
    config: errors.length === 0 ? rec : null,
  };
}

export function expandPlaceholders(
  input: string,
  root: string,
  data: string,
): string {
  return input.replace(/\$\{PLUGIN_ROOT\}|\$\{PLUGIN_DATA\}/g, (m) =>
    m === "${PLUGIN_ROOT}" ? root : data,
  );
}

export function parseHeaderLines(lines: string[]): Record<string, string> {
  const headers: Record<string, string> = Object.create(null);
  const seen = new Set<string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const index = line.indexOf(":");
    if (index <= 0)
      throw new Error(`invalid header (use Name: value): ${line}`);
    const name = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim();
    if (!name || value.length === 0)
      throw new Error(`invalid header (use Name: value): ${line}`);
    const lower = name.toLowerCase();
    if (seen.has(lower)) throw new Error(`duplicate header: ${name}`);
    seen.add(lower);
    headers[name] = value;
  }
  return headers;
}

const stringRecordSchema = z.record(z.string(), z.string());

export const storedServerConfigSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("stdio"),
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      env: stringRecordSchema.optional(),
      cwd: z.string().min(1).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("streamable-http"),
      url: z.string().min(1),
      headers: stringRecordSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("sse"),
      url: z.string().min(1),
      headers: stringRecordSchema.optional(),
    })
    .strict(),
]);
export type StoredServerConfig = z.infer<typeof storedServerConfigSchema>;
export type StdioServerConfig = Extract<StoredServerConfig, { type: "stdio" }>;
export type HttpServerConfig = Exclude<StoredServerConfig, { type: "stdio" }>;

export function parseStoredServerConfig(
  handle: string,
  configJson: string,
): StoredServerConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(configJson);
  } catch {
    throw new Error(`invalid server config for ${handle}`);
  }
  const validation = validateMcpServer(raw);
  if (!validation.valid)
    throw new Error(
      `invalid server config for ${handle}: ${validation.errors.join("; ")}`,
    );
  const parsed = storedServerConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid server config for ${handle}`);
  return parsed.data;
}
