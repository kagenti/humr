export interface KeyRing {
  readonly currentVersion: number;
  get(version: number): Buffer;
}

const ENV_PREFIX = "SECRET_ENCRYPTION_KEY_V";

export function loadKeyRingFromEnv(env: NodeJS.ProcessEnv = process.env): KeyRing {
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || !name.startsWith(ENV_PREFIX)) continue;
    const suffix = name.slice(ENV_PREFIX.length);
    const version = Number(suffix);
    if (!Number.isInteger(version) || version < 1) continue;
    const key = Buffer.from(value, "base64");
    if (key.length !== 32) throw new Error(`${name} must decode to 32 bytes (got ${key.length})`);
    keys.set(version, key);
  }
  if (keys.size === 0) throw new Error(`no ${ENV_PREFIX}<N> keys found in environment`);
  const currentVersion = Math.max(...keys.keys());
  return {
    currentVersion,
    get(version: number) {
      const key = keys.get(version);
      if (!key) throw new Error(`unknown key version: ${version}`);
      return key;
    },
  };
}
