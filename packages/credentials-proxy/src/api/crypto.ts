import { encrypt } from "../crypto/aes-gcm.js";
import {
  generateDek,
  unwrapWithDek,
  unwrapWithKek,
  wrapWithDek,
  wrapWithKek,
} from "../crypto/dek.js";
import type { KeyRing } from "../crypto/key.js";

export interface EncryptedSecret {
  ciphertext: Buffer;
  wrappedDek: Buffer;
  kekVersion: number;
}

export interface WrappedAgentDek {
  rawDek: Buffer;
  wrappedDek: Buffer;
  kekVersion: number;
}

/** Generate a per-agent DEK and wrap it under the KEK for long-term storage. */
export function issueAgentDek(keyRing: KeyRing): WrappedAgentDek {
  const rawDek = generateDek();
  const { wrapped, keyVersion } = wrapWithKek(keyRing, rawDek);
  return { rawDek, wrappedDek: wrapped, kekVersion: keyVersion };
}

/**
 * Encrypt a secret value with a fresh per-secret DEK, and wrap that DEK under
 * the KEK so the API can recover it later when granting the secret to agents.
 */
export function encryptSecret(keyRing: KeyRing, plaintext: string): EncryptedSecret {
  const secretDek = generateDek();
  const ciphertext = encrypt(secretDek, Buffer.from(plaintext, "utf8"));
  const { wrapped, keyVersion } = wrapWithKek(keyRing, secretDek);
  return { ciphertext, wrappedDek: wrapped, kekVersion: keyVersion };
}

/**
 * Re-wrap a secret's DEK under an agent's DEK so the sidecar (which holds only
 * that agent's DEK) can decrypt the secret.
 */
export function wrapSecretDekForAgent(
  keyRing: KeyRing,
  secretWrappedDek: Buffer,
  secretKekVersion: number,
  agentWrappedDek: Buffer,
  agentKekVersion: number,
): Buffer {
  const secretDek = unwrapWithKek(keyRing, secretWrappedDek, secretKekVersion);
  const agentDek = unwrapWithKek(keyRing, agentWrappedDek, agentKekVersion);
  return wrapWithDek(agentDek, secretDek);
}

/** Used by administrative endpoints that need to surface the plaintext (rare). */
export function decryptSecret(keyRing: KeyRing, enc: EncryptedSecret): string {
  const secretDek = unwrapWithKek(keyRing, enc.wrappedDek, enc.kekVersion);
  return unwrapWithDek(secretDek, enc.ciphertext).toString("utf8");
}
