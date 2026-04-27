import { describe, expect, it } from "vitest";
import {
  extractHost,
  pickUsername,
  toGhEnterpriseHosts,
} from "../../modules/connections/services/gh-enterprise-snapshot.js";

describe("extractHost", () => {
  it("strips scheme and port", () => {
    expect(extractHost({ baseUrl: "https://ghe.example.com" })).toBe("ghe.example.com");
    expect(extractHost({ baseUrl: "https://ghe.example.com:8443" })).toBe("ghe.example.com");
  });

  it("returns undefined on missing or malformed baseUrl", () => {
    expect(extractHost(null)).toBeUndefined();
    expect(extractHost({})).toBeUndefined();
    expect(extractHost({ baseUrl: 42 })).toBeUndefined();
    expect(extractHost({ baseUrl: "" })).toBeUndefined();
  });
});

describe("pickUsername", () => {
  it("prefers username, then login, then name", () => {
    expect(pickUsername({ username: "u", login: "l", name: "n" })).toBe("u");
    expect(pickUsername({ login: "l", name: "n" })).toBe("l");
    expect(pickUsername({ name: "n" })).toBe("n");
    expect(pickUsername({ email: "e" })).toBeUndefined();
  });
});

describe("toGhEnterpriseHosts", () => {
  it("filters non-github-enterprise rows and sorts by host", () => {
    const out = toGhEnterpriseHosts([
      { provider: "github", metadata: { baseUrl: "https://github.com" } },
      { provider: "github-enterprise", metadata: { baseUrl: "https://b.example.com", username: "ub" } },
      { provider: "github-enterprise", metadata: { baseUrl: "https://a.example.com", username: "ua" } },
    ]);
    expect(out).toEqual([
      { host: "a.example.com", username: "ua" },
      { host: "b.example.com", username: "ub" },
    ]);
  });

  it("skips rows without a resolvable host", () => {
    const out = toGhEnterpriseHosts([
      { provider: "github-enterprise", metadata: null },
      { provider: "github-enterprise", metadata: { baseUrl: "" } },
    ]);
    expect(out).toEqual([]);
  });

  it("omits username when none available", () => {
    const out = toGhEnterpriseHosts([
      { provider: "github-enterprise", metadata: { baseUrl: "https://x.example.com" } },
    ]);
    expect(out).toEqual([{ host: "x.example.com" }]);
  });
});
