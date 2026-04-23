import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import * as x509 from "@peculiar/x509";

x509.cryptoProvider.set(webcrypto as unknown as Crypto);

export interface Ca {
  /** CA certificate as a parsed X.509 object. */
  cert: x509.X509Certificate;
  /** Raw PEM of the CA certificate (served to agents as the trust anchor). */
  certPem: string;
  /** Private key, usable for signing leaf certs. */
  signingKey: CryptoKey;
}

function pemToDer(pem: string): Buffer {
  const body = pem
    .replace(/-----(BEGIN|END)[^-]+-----/g, "")
    .replace(/\s+/g, "");
  return Buffer.from(body, "base64");
}

/**
 * Load the CA cert + private key from mounted file paths.
 * In-cluster: both files come from the `humr-credentials-proxy-ca` Secret,
 * populated by a Helm pre-install Job (openssl-generated ECDSA P-256, PKCS8).
 */
export async function loadCaFromFiles(certPath: string, keyPath: string): Promise<Ca> {
  const [certPem, keyPem] = await Promise.all([
    readFile(certPath, "utf8"),
    readFile(keyPath, "utf8"),
  ]);
  const cert = new x509.X509Certificate(certPem);
  const signingKey = await webcrypto.subtle.importKey(
    "pkcs8",
    pemToDer(keyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return { cert, certPem, signingKey };
}
