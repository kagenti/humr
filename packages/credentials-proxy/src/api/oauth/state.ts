import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";

export interface StatePayload {
  userSub: string;
  providerId: string;
  nonce: string;
  exp: number;
}

const SEPARATOR = ".";

function sign(macKey: Buffer, body: string): string {
  return createHmac("sha256", macKey).update(body).digest("base64url");
}

export function encodeState(macKey: Buffer, payload: Omit<StatePayload, "nonce" | "exp">, ttlSeconds = 300): string {
  const full: StatePayload = {
    ...payload,
    nonce: randomBytes(16).toString("base64url"),
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const body = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  return `${body}${SEPARATOR}${sign(macKey, body)}`;
}

export function decodeState(macKey: Buffer, token: string): StatePayload {
  const idx = token.lastIndexOf(SEPARATOR);
  if (idx === -1) throw new Error("malformed state");
  const body = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = sign(macKey, body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("bad state signature");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("state expired");
  }
  return payload;
}

export function loadMacKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const v = env.OAUTH_STATE_MAC_KEY;
  if (!v) throw new Error("OAUTH_STATE_MAC_KEY is required");
  const key = Buffer.from(v, "base64");
  if (key.length < 32) throw new Error("OAUTH_STATE_MAC_KEY must decode to at least 32 bytes");
  return key;
}
