import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decodeState, encodeState } from "../../api/oauth/state.js";

describe("oauth state", () => {
  const key = randomBytes(32);

  it("round-trips userSub and providerId", () => {
    const token = encodeState(key, { userSub: "abc", providerId: "github" });
    const decoded = decodeState(key, token);
    expect(decoded.userSub).toBe("abc");
    expect(decoded.providerId).toBe("github");
    expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects tokens signed by a different key", () => {
    const token = encodeState(key, { userSub: "abc", providerId: "github" });
    expect(() => decodeState(randomBytes(32), token)).toThrow(/signature/);
  });

  it("rejects tampered payloads", () => {
    const token = encodeState(key, { userSub: "abc", providerId: "github" });
    const [body, sig] = token.split(".");
    const bodyBytes = Buffer.from(body!, "base64url").toString("utf8");
    const hacked = bodyBytes.replace('"userSub":"abc"', '"userSub":"attacker"');
    const tamperedBody = Buffer.from(hacked, "utf8").toString("base64url");
    expect(() => decodeState(key, `${tamperedBody}.${sig}`)).toThrow();
  });

  it("rejects expired tokens", () => {
    const token = encodeState(key, { userSub: "abc", providerId: "github" }, -1);
    expect(() => decodeState(key, token)).toThrow(/expired/);
  });

  it("generates a fresh nonce per call", () => {
    const a = encodeState(key, { userSub: "abc", providerId: "github" });
    const b = encodeState(key, { userSub: "abc", providerId: "github" });
    expect(a).not.toBe(b);
  });
});
