export interface GatewayConfig {
  /** Loopback port the gateway listens on inside the agent pod. */
  listenPort: number;
  /** Agent identifier (set by the controller via Downward API). */
  agentId: string;
  /** Path to the per-agent DEK file (mounted K8s Secret, raw 32 bytes). */
  dekPath: string;
  /** Path to the CA certificate PEM (mounted Secret). */
  caCertPath: string;
  /** Path to the CA private key PEM (mounted Secret, PKCS8 ECDSA P-256). */
  caKeyPath: string;
  /** Postgres DSN for the cp_sidecar (read-only) role. */
  databaseUrl: string;
  /** Grant-cache refresh interval in ms. Default 60000 (60s). */
  refreshIntervalMs: number;
  /** Extra CIDRs to add to the SSRF blocklist (cluster pod + service CIDR). */
  extraBlockedCidrs: string[];
}

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const get = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`${name} is required`);
    return v;
  };

  return {
    listenPort: Number(env.GATEWAY_LISTEN_PORT ?? 10255),
    agentId: get("CREDENTIALS_PROXY_AGENT_ID"),
    dekPath: env.AGENT_DEK_PATH ?? "/etc/humr/agent-dek/dek",
    caCertPath: env.CA_CERT_PATH ?? "/etc/humr/ca/ca.crt",
    caKeyPath: env.CA_KEY_PATH ?? "/etc/humr/ca/ca.key",
    databaseUrl: get("DATABASE_URL"),
    refreshIntervalMs: Number(env.GRANT_REFRESH_INTERVAL_MS ?? 60_000),
    extraBlockedCidrs: (env.EXTRA_BLOCKED_CIDRS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  };
}
