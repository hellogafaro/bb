import { describe, expect, it } from "vitest";
import { isHttpOrHttpsUrl } from "./url-open-routing";

describe("isHttpOrHttpsUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpOrHttpsUrl("http://example.com")).toBe(true);
    expect(isHttpOrHttpsUrl("https://example.com/docs?q=1#frag")).toBe(true);
    expect(isHttpOrHttpsUrl("HTTPS://EXAMPLE.COM")).toBe(true);
  });

  it("rejects non-http schemes, relative paths, and protocol-relative URLs", () => {
    expect(isHttpOrHttpsUrl("mailto:hi@example.com")).toBe(false);
    expect(isHttpOrHttpsUrl("file:///Users/me/app.ts")).toBe(false);
    expect(isHttpOrHttpsUrl("/projects/abc")).toBe(false);
    expect(isHttpOrHttpsUrl("#section")).toBe(false);
    expect(isHttpOrHttpsUrl("//example.com")).toBe(false);
    expect(isHttpOrHttpsUrl("javascript:alert(1)")).toBe(false);
  });
});
