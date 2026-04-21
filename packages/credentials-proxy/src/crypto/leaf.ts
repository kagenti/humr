import { webcrypto, randomBytes } from "node:crypto";
import * as x509 from "@peculiar/x509";
import type { Ca } from "./ca.js";

export interface LeafCert {
  certPem: string;
  keyPem: string;
}

export interface LeafCache {
  get(host: string): Promise<LeafCert>;
}

const LEAF_VALIDITY_DAYS = 30;

async function exportPrivateKeyPem(key: CryptoKey): Promise<string> {
  const der = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", key));
  const b64 = Buffer.from(der).toString("base64");
  const wrapped = b64.match(/.{1,64}/g)!.join("\n");
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----\n`;
}

async function mintLeaf(host: string, ca: Ca): Promise<LeafCert> {
  const { privateKey, publicKey } = await webcrypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );

  const now = new Date();
  const notAfter = new Date(now.getTime() + LEAF_VALIDITY_DAYS * 86_400 * 1000);
  const serialNumber = randomBytes(16).toString("hex");

  const cert = await x509.X509CertificateGenerator.create({
    serialNumber,
    subject: `CN=${host}`,
    issuer: ca.cert.subject,
    notBefore: now,
    notAfter,
    signingKey: ca.signingKey,
    publicKey,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      new x509.BasicConstraintsExtension(false),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
      ),
      new x509.ExtendedKeyUsageExtension([x509.id_ce_extKeyUsage_serverAuth]),
      new x509.SubjectAlternativeNameExtension([{ type: "dns", value: host }]),
    ],
  });

  return {
    certPem: cert.toString("pem"),
    keyPem: await exportPrivateKeyPem(privateKey),
  };
}

/**
 * LRU cache keyed by host. Leafs expire after LEAF_VALIDITY_DAYS but
 * we cache aggressively — a new CONNECT per cluster host is expensive
 * if we re-mint every time. Bounded to keep memory predictable.
 */
export function createLeafCache(ca: Ca, maxEntries = 256): LeafCache {
  const order = new Map<string, LeafCert>();

  return {
    async get(host: string) {
      const cached = order.get(host);
      if (cached) {
        order.delete(host);
        order.set(host, cached);
        return cached;
      }
      const fresh = await mintLeaf(host, ca);
      order.set(host, fresh);
      while (order.size > maxEntries) {
        const oldest = order.keys().next().value;
        if (oldest === undefined) break;
        order.delete(oldest);
      }
      return fresh;
    },
  };
}
