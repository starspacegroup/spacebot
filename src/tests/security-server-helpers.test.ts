import { describe, expect, it } from "vitest";
import {
  applySecurityHeaders,
  buildContentSecurityPolicy,
  isHtmlResponse,
  SECURITY_HEADERS,
} from "../lib/server/security-headers.js";
import {
  isSameOrigin,
  isSameOriginRequest,
  normalizeOrigin,
  parseTrustedOrigins,
} from "../lib/server/csrf.js";
import {
  DEFAULT_SESSION_TTL_SECONDS,
  MAX_SESSION_TTL_SECONDS,
  MIN_SESSION_TTL_SECONDS,
  getSessionTtlSeconds,
  parseSessionTtlSeconds,
} from "../lib/server/session.js";

function htmlResponse(body = "<html></html>") {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

describe("security-headers", () => {
  it("applies all security headers + CSP-Report-Only to HTML responses", () => {
    const res = applySecurityHeaders(htmlResponse());

    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers.get(name)).toBe(value);
    }
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toContain(
      "frame-ancestors 'none'",
    );
    expect(res.headers.get("Content-Security-Policy")).toBeNull();
  });

  it("enforces CSP (not report-only) when cspReportOnly is false", () => {
    const res = applySecurityHeaders(htmlResponse(), { cspReportOnly: false });
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(res.headers.get("Content-Security-Policy-Report-Only")).toBeNull();
  });

  it("is a no-op for non-HTML responses (JSON, assets, WebSocket-style)", () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    applySecurityHeaders(json);
    expect(json.headers.get("X-Content-Type-Options")).toBeNull();
    expect(json.headers.get("Content-Security-Policy-Report-Only")).toBeNull();

    // A response without a content-type (as a WebSocket upgrade has) must be left untouched.
    const noType = new Response(null);
    noType.headers.delete("content-type");
    expect(isHtmlResponse(noType)).toBe(false);
    applySecurityHeaders(noType);
    expect(noType.headers.get("X-Frame-Options")).toBeNull();
  });

  it("never clobbers a header that is already set", () => {
    const res = htmlResponse();
    res.headers.set("X-Frame-Options", "SAMEORIGIN");
    applySecurityHeaders(res);
    expect(res.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("CSP locks down framing, base-uri and objects", () => {
    const csp = buildContentSecurityPolicy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });
});

describe("csrf same-origin helper", () => {
  it("normalizes origins and rejects garbage", () => {
    expect(normalizeOrigin("https://example.com/path?q=1")).toBe("https://example.com");
    expect(normalizeOrigin("not a url")).toBeNull();
    expect(normalizeOrigin(null)).toBeNull();
  });

  it("accepts a matching origin and rejects a mismatched one", () => {
    expect(
      isSameOrigin({ originHeader: "https://app.example.com", requestOrigin: "https://app.example.com" }),
    ).toBe(true);
    expect(
      isSameOrigin({ originHeader: "https://evil.example.com", requestOrigin: "https://app.example.com" }),
    ).toBe(false);
  });

  it("rejects requests with a missing Origin header (machine/cross-origin callers)", () => {
    expect(isSameOrigin({ originHeader: null, requestOrigin: "https://app.example.com" })).toBe(false);
  });

  it("honors allowedOrigins (e.g. a trusted tunnel host)", () => {
    expect(
      isSameOrigin({
        originHeader: "https://tunnel.starspace.group",
        requestOrigin: "https://app.example.com",
        allowedOrigins: ["https://tunnel.starspace.group"],
      }),
    ).toBe(true);
  });

  it("parses TRUSTED_ORIGINS into normalized origins", () => {
    expect(parseTrustedOrigins("https://a.com, https://b.com/x , bad")).toEqual([
      "https://a.com",
      "https://b.com",
    ]);
    expect(parseTrustedOrigins("")).toEqual([]);
    expect(parseTrustedOrigins(null)).toEqual([]);
  });

  it("isSameOriginRequest matches event.url.origin and platform TRUSTED_ORIGINS", () => {
    const makeEvent = (origin, urlOrigin, trusted = null) => ({
      request: { headers: { get: (n) => (n === "origin" ? origin : null) } },
      url: { origin: urlOrigin },
      platform: trusted ? { env: { TRUSTED_ORIGINS: trusted } } : null,
    });

    expect(isSameOriginRequest(makeEvent("https://app.x", "https://app.x"))).toBe(true);
    expect(isSameOriginRequest(makeEvent("https://evil.x", "https://app.x"))).toBe(false);
    expect(
      isSameOriginRequest(makeEvent("https://tunnel.x", "https://app.x", "https://tunnel.x")),
    ).toBe(true);
  });
});

describe("session TTL", () => {
  it("falls back to the default for empty / invalid input", () => {
    expect(parseSessionTtlSeconds(undefined)).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(parseSessionTtlSeconds("")).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(parseSessionTtlSeconds("not-a-number")).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(parseSessionTtlSeconds("-5")).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(parseSessionTtlSeconds("0")).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });

  it("parses a valid value and floors it to an integer", () => {
    expect(parseSessionTtlSeconds("3600")).toBe(3600);
    expect(parseSessionTtlSeconds("3600.9")).toBe(3600);
    expect(parseSessionTtlSeconds(7200)).toBe(7200);
  });

  it("clamps to the configured bounds", () => {
    expect(parseSessionTtlSeconds("1")).toBe(MIN_SESSION_TTL_SECONDS);
    expect(parseSessionTtlSeconds(String(MAX_SESSION_TTL_SECONDS * 10))).toBe(
      MAX_SESSION_TTL_SECONDS,
    );
  });

  it("getSessionTtlSeconds reads via the supplied env getter", () => {
    expect(getSessionTtlSeconds(() => undefined)).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(getSessionTtlSeconds((name) => (name === "SESSION_TTL_SECONDS" ? "86400" : undefined))).toBe(
      86400,
    );
  });
});
