import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION = "v1";

function loadKey(): Buffer | null {
  const raw = process.env.HUMR_CHANNEL_ENCRYPTION_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("HUMR_CHANNEL_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

let cachedKey: Buffer | null | undefined;

function getKey(): Buffer {
  if (cachedKey === undefined) cachedKey = loadKey();
  if (!cachedKey) {
    throw new Error("HUMR_CHANNEL_ENCRYPTION_KEY is not configured; per-instance channel tokens cannot be stored or read");
  }
  return cachedKey;
}

export function isEncryptionConfigured(): boolean {
  if (cachedKey === undefined) cachedKey = loadKey();
  return cachedKey !== null;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${ciphertext.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("invalid encrypted payload format");
  }
  const key = getKey();
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const ciphertext = Buffer.from(parts[3], "base64");
  if (iv.length !== IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) {
    throw new Error("invalid encrypted payload structure");
  }
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
