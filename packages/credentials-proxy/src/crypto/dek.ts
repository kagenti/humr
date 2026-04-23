import { randomBytes } from "node:crypto";
import { decrypt, encrypt } from "./aes-gcm.js";
import type { KeyRing } from "./key.js";

export const DEK_LEN = 32;

export function generateDek(): Buffer {
  return randomBytes(DEK_LEN);
}

export interface WrappedWithKek {
  wrapped: Buffer;
  keyVersion: number;
}

export function wrapWithKek(keyRing: KeyRing, plaintext: Buffer): WrappedWithKek {
  const keyVersion = keyRing.currentVersion;
  const kek = keyRing.get(keyVersion);
  return { wrapped: encrypt(kek, plaintext), keyVersion };
}

export function unwrapWithKek(keyRing: KeyRing, wrapped: Buffer, keyVersion: number): Buffer {
  const kek = keyRing.get(keyVersion);
  return decrypt(kek, wrapped);
}

export function wrapWithDek(dek: Buffer, plaintext: Buffer): Buffer {
  if (dek.length !== DEK_LEN) throw new Error(`dek must be ${DEK_LEN} bytes`);
  return encrypt(dek, plaintext);
}

export function unwrapWithDek(dek: Buffer, wrapped: Buffer): Buffer {
  if (dek.length !== DEK_LEN) throw new Error(`dek must be ${DEK_LEN} bytes`);
  return decrypt(dek, wrapped);
}
