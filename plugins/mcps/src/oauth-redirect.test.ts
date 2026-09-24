import { describe, expect, it } from "vitest";
import { oauthRedirectBase, serverAccessPublicUrl, serverAppUrl } from "./oauth-redirect.js";

describe("oauthRedirectBase", () => {
  it("prefers an explicit setting over the public app URL", () => {
    expect(oauthRedirectBase({
      setting: "https://g4f4r0.getbb.app/",
      appUrl: "https://app.example",
      publicUrl: "https://connect.example",
      loopbackBaseUrl: "http://127.0.0.1:38886",
    })).toBe("https://g4f4r0.getbb.app");
  });

  it("uses the public app URL when no setting is set", () => {
    expect(oauthRedirectBase({
      setting: "  ",
      appUrl: "https://g4f4r0.getbb.app",
      publicUrl: "https://connect.example",
      loopbackBaseUrl: "http://127.0.0.1:38886",
    })).toBe("https://g4f4r0.getbb.app");
  });

  it("uses the Connect public URL when BB_APP_URL is unset", () => {
    expect(oauthRedirectBase({
      publicUrl: "https://g4f4r0.getbb.app/",
      loopbackBaseUrl: "http://127.0.0.1:38886",
    })).toBe("https://g4f4r0.getbb.app");
  });

  it("falls back to loopback when nothing public is configured", () => {
    expect(oauthRedirectBase({
      loopbackBaseUrl: "http://127.0.0.1:38886",
    })).toBe("http://127.0.0.1:38886");
  });
});

describe("serverAccessPublicUrl", () => {
  it("prefers effectiveUrl", () => {
    expect(serverAccessPublicUrl({
      serverAccess: {
        effectiveUrl: "https://custom.example/",
        defaultProviderId: "connect",
        providers: [{
          id: "connect",
          availability: { status: "available", serverUrl: "https://g4f4r0.getbb.app" },
        }],
      },
    })).toBe("https://custom.example");
  });

  it("uses the default Connect provider URL", () => {
    expect(serverAccessPublicUrl({
      serverAccess: {
        effectiveUrl: null,
        defaultProviderId: "connect",
        providers: [
          { id: "direct", availability: { status: "unavailable", message: "unset" } },
          { id: "connect", availability: { status: "available", serverUrl: "https://g4f4r0.getbb.app" } },
        ],
      },
    })).toBe("https://g4f4r0.getbb.app");
  });
});

describe("serverAppUrl", () => {
  it("reads experimental_appUrl when present", () => {
    expect(serverAppUrl({ experimental_appUrl: "https://g4f4r0.getbb.app" })).toBe("https://g4f4r0.getbb.app");
    expect(serverAppUrl({ loopbackBaseUrl: "http://127.0.0.1:38886" })).toBeNull();
  });
});
