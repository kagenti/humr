export interface ApiConfig {
  listenPort: number;
  databaseUrl: string;
  caCertPath: string;
  caKeyPath: string;
  keycloak: {
    issuerUrl: string;
    jwksUrl: string;
    audience: string;
  };
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const get = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`${name} is required`);
    return v;
  };

  return {
    listenPort: Number(env.API_LISTEN_PORT ?? 10254),
    databaseUrl: get("DATABASE_URL"),
    caCertPath: env.CA_CERT_PATH ?? "/etc/humr/ca/ca.crt",
    caKeyPath: env.CA_KEY_PATH ?? "/etc/humr/ca/ca.key",
    keycloak: {
      issuerUrl: get("KEYCLOAK_ISSUER_URL"),
      jwksUrl: get("KEYCLOAK_JWKS_URL"),
      audience: env.KEYCLOAK_AUDIENCE ?? "credentials-proxy",
    },
  };
}
