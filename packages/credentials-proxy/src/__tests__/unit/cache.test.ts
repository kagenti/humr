import { describe, expect, it } from "vitest";
import { compileHostPattern, findRule, type CacheSnapshot } from "../../gateway/cache.js";

describe("compileHostPattern", () => {
  it("matches exact hostnames", () => {
    const p = compileHostPattern("api.github.com");
    expect(p.test("api.github.com")).toBe(true);
    expect(p.test("api.github.com.evil.com")).toBe(false);
  });

  it("treats * as a single label wildcard", () => {
    const p = compileHostPattern("*.github.com");
    expect(p.test("api.github.com")).toBe(true);
    expect(p.test("raw.github.com")).toBe(true);
    expect(p.test("a.b.github.com")).toBe(false);
    expect(p.test("github.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    const p = compileHostPattern("api.GitHub.com");
    expect(p.test("api.github.com")).toBe(true);
    expect(p.test("API.GITHUB.COM")).toBe(true);
  });

  it("escapes regex special characters in literals", () => {
    const p = compileHostPattern("api.example.com");
    expect(p.test("apiXexampleXcom")).toBe(false);
  });
});

describe("findRule", () => {
  const rule = (pat: string, header: string, value: string) => ({
    secretId: pat,
    hostPattern: compileHostPattern(pat),
    headerName: header,
    headerValue: value,
  });

  it("returns the first matching rule in iteration order", () => {
    const snapshot: CacheSnapshot = {
      loadedAt: new Date(),
      rules: [rule("api.github.com", "Authorization", "Bearer gh-work"), rule("*.github.com", "Authorization", "Bearer gh-fallback")],
    };
    expect(findRule(snapshot, "api.github.com")?.headerValue).toBe("Bearer gh-work");
    expect(findRule(snapshot, "raw.github.com")?.headerValue).toBe("Bearer gh-fallback");
    expect(findRule(snapshot, "example.com")).toBeUndefined();
  });
});
