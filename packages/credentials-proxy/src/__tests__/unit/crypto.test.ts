import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "../../crypto/aes-gcm.js";
import { loadKeyRingFromEnv } from "../../crypto/key.js";
import {
  generateDek,
  unwrapWithDek,
  unwrapWithKek,
  wrapWithDek,
  wrapWithKek,
} from "../../crypto/dek.js";

function keyEnv(keys: Record<number, Buffer>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [v, k] of Object.entries(keys)) {
    env[`SECRET_ENCRYPTION_KEY_V${v}`] = k.toString("base64");
  }
  return env;
}

describe("aes-gcm", () => {
  it("round-trips arbitrary bytes", () => {
    const key = randomBytes(32);
    const plaintext = Buffer.from("hello: api key 123");
    expect(decrypt(key, encrypt(key, plaintext))).toEqual(plaintext);
  });

  it("rejects keys of the wrong length", () => {
    expect(() => encrypt(randomBytes(16), Buffer.from("x"))).toThrow(/32 bytes/);
  });

  it("detects tampering (auth tag failure)", () => {
    const key = randomBytes(32);
    const wrapped = encrypt(key, Buffer.from("payload"));
    wrapped[wrapped.length - 1] ^= 1;
    expect(() => decrypt(key, wrapped)).toThrow();
  });

  it("rejects a different key", () => {
    const wrapped = encrypt(randomBytes(32), Buffer.from("payload"));
    expect(() => decrypt(randomBytes(32), wrapped)).toThrow();
  });
});

describe("key ring", () => {
  it("picks the highest version as current", () => {
    const ring = loadKeyRingFromEnv(keyEnv({ 1: randomBytes(32), 3: randomBytes(32), 2: randomBytes(32) }));
    expect(ring.currentVersion).toBe(3);
  });

  it("throws on unknown version", () => {
    const ring = loadKeyRingFromEnv(keyEnv({ 1: randomBytes(32) }));
    expect(() => ring.get(2)).toThrow(/unknown key version/);
  });

  it("throws when no keys are present", () => {
    expect(() => loadKeyRingFromEnv({})).toThrow(/no SECRET_ENCRYPTION_KEY/);
  });

  it("rejects keys that are not 32 bytes", () => {
    expect(() => loadKeyRingFromEnv({ SECRET_ENCRYPTION_KEY_V1: Buffer.alloc(16).toString("base64") })).toThrow(/32 bytes/);
  });
});

describe("dek wrapping", () => {
  it("round-trips with the current KEK", () => {
    const ring = loadKeyRingFromEnv(keyEnv({ 1: randomBytes(32) }));
    const dek = generateDek();
    const { wrapped, keyVersion } = wrapWithKek(ring, dek);
    expect(keyVersion).toBe(1);
    expect(unwrapWithKek(ring, wrapped, keyVersion)).toEqual(dek);
  });

  it("rotation: v1-wrapped values still decrypt when v2 is the current version", () => {
    const v1 = randomBytes(32);
    const ring1 = loadKeyRingFromEnv(keyEnv({ 1: v1 }));
    const dek = generateDek();
    const { wrapped, keyVersion } = wrapWithKek(ring1, dek);

    const ring2 = loadKeyRingFromEnv(keyEnv({ 1: v1, 2: randomBytes(32) }));
    expect(ring2.currentVersion).toBe(2);
    expect(unwrapWithKek(ring2, wrapped, keyVersion)).toEqual(dek);
  });

  it("per-agent DEK scoping: a secret's DEK wrapped under agent A's DEK cannot be unwrapped with agent B's DEK", () => {
    const secretDek = generateDek();
    const agentA = generateDek();
    const agentB = generateDek();

    const wrappedForA = wrapWithDek(agentA, secretDek);
    expect(unwrapWithDek(agentA, wrappedForA)).toEqual(secretDek);
    expect(() => unwrapWithDek(agentB, wrappedForA)).toThrow();
  });
});
