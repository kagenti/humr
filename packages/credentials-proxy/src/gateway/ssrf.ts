import { promises as dns } from "node:dns";
import ipaddr from "ipaddr.js";

export type LookupFn = (host: string) => Promise<string[]>;

export interface SsrfPolicy {
  /** Extra CIDRs to block beyond the hard-coded set (e.g. cluster pod/service CIDR from Helm values). */
  extraBlockedCidrs?: string[];
  /** Extra hostname literals to reject (case-insensitive, exact match; suffix match for values starting with "."). */
  extraHostnameDenylist?: string[];
  /** Explicit IPs to block beyond the CIDR set (e.g. cloud metadata endpoints outside RFC1918). */
  extraIpDenylist?: string[];
  /** DNS resolver override; defaults to node:dns Promises A+AAAA lookup. */
  lookup?: LookupFn;
}

export type ValidationResult =
  | { ok: true; resolvedIp: string }
  | { ok: false; reason: string };

// Hard-coded blocked ranges — single source of truth, must match values.yaml blockedCIDRs.
const HARD_BLOCKED_V4 = [
  "127.0.0.0/8",       // loopback
  "0.0.0.0/8",         // "this network"
  "10.0.0.0/8",        // RFC1918
  "172.16.0.0/12",     // RFC1918
  "192.168.0.0/16",    // RFC1918
  "100.64.0.0/10",     // RFC6598 CGNAT (covers Alibaba metadata 100.100.100.200)
  "169.254.0.0/16",    // link-local (covers AWS/GCP/Azure metadata 169.254.169.254)
  "192.0.0.0/24",      // IETF protocol assignments (covers OCI metadata 192.0.0.192)
  "224.0.0.0/4",       // multicast
  "240.0.0.0/4",       // reserved
  "255.255.255.255/32", // broadcast
];

const HARD_BLOCKED_V6 = [
  "::1/128",           // loopback
  "::ffff:0:0/96",     // v4-mapped (belt-and-suspenders; we also normalize v4-mapped → v4 before check)
  "fc00::/7",          // unique local
  "fe80::/10",         // link-local
  "ff00::/8",          // multicast
  "::/128",            // unspecified
  "2001:db8::/32",     // documentation
];

const HOSTNAME_DENYLIST = new Set<string>([
  "localhost",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254.xip.io",
]);

const HOSTNAME_SUFFIX_DENYLIST = [
  ".internal",
  ".local",
  ".localhost",
];

const CLOUD_METADATA_IPS = new Set<string>([
  "169.254.169.254", // AWS, GCP, Azure
  "100.100.100.200", // Alibaba Cloud
  "192.0.0.192",     // Oracle Cloud
  "fd00:ec2::254",   // AWS IMDSv6
]);

const BLOCKED_PORTS = new Set<number>([
  53,    // DNS
  853,   // DNS-over-TLS
  5353,  // mDNS
]);

export function isIpBlocked(ip: string, extraCidrs: string[] = [], extraIps: string[] = []): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    return true; // unparseable IP is untrusted
  }

  // Normalize v4-mapped-v6 (::ffff:a.b.c.d) down to v4 so CIDR checks match either family.
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      parsed = v6.toIPv4Address();
    }
  }

  const all = [
    ...(parsed.kind() === "ipv4" ? HARD_BLOCKED_V4 : HARD_BLOCKED_V6),
    ...extraCidrs.filter((c) => (parsed.kind() === "ipv4") === c.includes(".")),
  ];
  for (const cidr of all) {
    try {
      const [net, bits] = ipaddr.parseCIDR(cidr);
      if (parsed.kind() === net.kind() && parsed.match(net as ipaddr.IPv4 & ipaddr.IPv6, bits)) {
        return true;
      }
    } catch {
      // Skip malformed CIDR rather than fail-open.
      continue;
    }
  }

  const canonical = parsed.toNormalizedString();
  if (CLOUD_METADATA_IPS.has(canonical) || CLOUD_METADATA_IPS.has(parsed.toString())) return true;
  if (extraIps.some((blocked) => blocked === canonical || blocked === parsed.toString())) return true;

  return false;
}

export function isHostnameBlocked(host: string, extras: string[] = []): boolean {
  const h = host.toLowerCase();
  if (HOSTNAME_DENYLIST.has(h)) return true;
  if (extras.some((e) => e.toLowerCase() === h)) return true;
  for (const suffix of HOSTNAME_SUFFIX_DENYLIST) {
    if (h === suffix.slice(1) || h.endsWith(suffix)) return true;
  }
  for (const e of extras) {
    const el = e.toLowerCase();
    if (el.startsWith(".") && h.endsWith(el)) return true;
  }
  return false;
}

export function isPortBlocked(port: number): boolean {
  return BLOCKED_PORTS.has(port);
}

async function defaultLookup(host: string): Promise<string[]> {
  const records = await dns.lookup(host, { all: true, verbatim: true });
  return records.map((r) => r.address);
}

export async function validateDestination(
  host: string,
  port: number,
  policy: SsrfPolicy = {},
): Promise<ValidationResult> {
  if (!host) return { ok: false, reason: "empty host" };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, reason: `invalid port: ${port}` };
  }
  if (isPortBlocked(port)) return { ok: false, reason: `port ${port} blocked` };

  // If the host IS an IP literal, check it directly (no DNS round-trip).
  if (ipaddr.isValid(host)) {
    const blocked = isIpBlocked(host, policy.extraBlockedCidrs, policy.extraIpDenylist);
    return blocked
      ? { ok: false, reason: `ip ${host} in blocked range` }
      : { ok: true, resolvedIp: host };
  }

  if (isHostnameBlocked(host, policy.extraHostnameDenylist)) {
    return { ok: false, reason: `hostname ${host} on denylist` };
  }

  const lookup = policy.lookup ?? defaultLookup;
  let addrs: string[];
  try {
    addrs = await lookup(host);
  } catch (err) {
    return { ok: false, reason: `dns lookup failed: ${(err as Error).message}` };
  }
  if (addrs.length === 0) return { ok: false, reason: `no A/AAAA records for ${host}` };

  // Reject if ANY resolved address is blocked (defeats "split-horizon" or DNS-round-robin bypasses
  // where one record is public and another is private).
  for (const addr of addrs) {
    if (isIpBlocked(addr, policy.extraBlockedCidrs, policy.extraIpDenylist)) {
      return { ok: false, reason: `${host} resolves to blocked ip ${addr}` };
    }
  }

  // Re-pin outbound dial to the first resolved IP to defeat DNS rebinding between check and connect.
  return { ok: true, resolvedIp: addrs[0]! };
}
