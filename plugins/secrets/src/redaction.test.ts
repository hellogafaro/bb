import { describe, expect, it } from "vitest";
import { redactSecretValues } from "./redaction.js";

describe("redactSecretValues", () => {
  it("removes everything after = on lines that mention a requested name", () => {
    const text = [
      "error: API_KEY=sk-live-123 rejected",
      "export TOKEN=abc",
      "unrelated=keep",
      "API_KEY without assignment",
    ].join("\n");
    expect(redactSecretValues(text, ["API_KEY", "TOKEN"])).toBe(
      [
        "error: API_KEY=[redacted]",
        "export TOKEN=[redacted]",
        "unrelated=keep",
        "API_KEY without assignment",
      ].join("\n"),
    );
  });

  it("redacts the temp file path form used for infisical secrets set", () => {
    expect(
      redactSecretValues("failed to read API_KEY=@/tmp/bb-secret-x/API_KEY", [
        "API_KEY",
      ]),
    ).toBe("failed to read API_KEY=[redacted]");
  });

  it("leaves text untouched when no names are known", () => {
    expect(redactSecretValues("API_KEY=value", [])).toBe("API_KEY=value");
  });
});
