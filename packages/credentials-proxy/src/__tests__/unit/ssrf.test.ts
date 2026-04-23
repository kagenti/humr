import { describe, expect, it } from "vitest";
import {
  isHostnameBlocked,
  isIpBlocked,
  isPortBlocked,
  validateDestination,
} from "../../gateway/ssrf.js";

describe("isIpBlocked", () => {
  const table: Array<[string, boolean]> = [
    // IPv4 blocked
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["10.0.0.1", true],
    ["10.255.255.255", true],
    ["172.16.0.1", true],
    ["172.31.255.255", true],
    ["172.32.0.1", false],       // JUST outside 172.16/12
    ["192.168.1.1", true],
    ["100.64.0.1", true],        // CGNAT
    ["100.100.100.200", true],   // Alibaba metadata (in CGNAT)
    ["169.254.169.254", true],   // AWS/GCP/Azure metadata
    ["192.0.0.192", true],       // OCI metadata
    ["224.0.0.1", true],
    ["255.255.255.255", true],
    ["0.0.0.0", true],
    // IPv4 public
    ["8.8.8.8", false],
    ["1.1.1.1", false],
    ["93.184.216.34", false],
    // IPv6 blocked
    ["::1", true],
    ["fe80::1", true],
    ["fc00::1", true],
    ["fd00::1", true],
    ["ff02::1", true],
    ["::", true],
    // IPv6 public
    ["2606:4700:4700::1111", false],
    // v4-mapped should be treated as v4
    ["::ffff:127.0.0.1", true],
    ["::ffff:10.0.0.1", true],
    ["::ffff:8.8.8.8", false],
    // unparseable
    ["not-an-ip", true],
    ["", true],
  ];

  for (const [ip, expected] of table) {
    it(`${ip} → blocked=${expected}`, () => {
      expect(isIpBlocked(ip)).toBe(expected);
    });
  }

  it("respects extra CIDRs (e.g. cluster pod CIDR)", () => {
    expect(isIpBlocked("11.0.0.1")).toBe(false);
    expect(isIpBlocked("11.0.0.1", ["11.0.0.0/8"])).toBe(true);
  });

  it("respects explicit extra IPs", () => {
    expect(isIpBlocked("8.8.4.4")).toBe(false);
    expect(isIpBlocked("8.8.4.4", [], ["8.8.4.4"])).toBe(true);
  });
});

describe("isHostnameBlocked", () => {
  it("blocks well-known internal hostnames", () => {
    expect(isHostnameBlocked("localhost")).toBe(true);
    expect(isHostnameBlocked("LOCALHOST")).toBe(true);
    expect(isHostnameBlocked("metadata.google.internal")).toBe(true);
    expect(isHostnameBlocked("ip6-localhost")).toBe(true);
  });

  it("blocks .internal and .local suffixes", () => {
    expect(isHostnameBlocked("whatever.internal")).toBe(true);
    expect(isHostnameBlocked("service.local")).toBe(true);
  });

  it("does not block unrelated hostnames", () => {
    expect(isHostnameBlocked("api.github.com")).toBe(false);
    expect(isHostnameBlocked("example.com")).toBe(false);
  });
});

describe("isPortBlocked", () => {
  it("blocks DNS / DoT / mDNS", () => {
    expect(isPortBlocked(53)).toBe(true);
    expect(isPortBlocked(853)).toBe(true);
    expect(isPortBlocked(5353)).toBe(true);
  });

  it("allows normal HTTPS ports", () => {
    expect(isPortBlocked(443)).toBe(false);
    expect(isPortBlocked(80)).toBe(false);
    expect(isPortBlocked(8443)).toBe(false);
  });
});

describe("validateDestination", () => {
  it("accepts a public IP literal", async () => {
    const result = await validateDestination("8.8.8.8", 443);
    expect(result).toEqual({ ok: true, resolvedIp: "8.8.8.8" });
  });

  it("rejects a private IP literal without DNS", async () => {
    const result = await validateDestination("10.0.0.1", 443, {
      lookup: async () => {
        throw new Error("should not be called");
      },
    });
    expect(result.ok).toBe(false);
  });

  it("rejects when any resolved address is blocked (split-horizon defense)", async () => {
    const result = await validateDestination("evil.example.com", 443, {
      lookup: async () => ["8.8.8.8", "10.0.0.5"], // second record is internal
    });
    expect(result.ok).toBe(false);
  });

  it("re-pins to the first resolved IP", async () => {
    const result = await validateDestination("api.github.com", 443, {
      lookup: async () => ["140.82.114.6"],
    });
    expect(result).toEqual({ ok: true, resolvedIp: "140.82.114.6" });
  });

  it("rejects invalid ports", async () => {
    const r1 = await validateDestination("example.com", 0);
    expect(r1.ok).toBe(false);
    const r2 = await validateDestination("example.com", 99999);
    expect(r2.ok).toBe(false);
  });

  it("rejects blocked ports", async () => {
    const r = await validateDestination("8.8.8.8", 53);
    expect(r.ok).toBe(false);
  });

  it("rejects hostname-denylisted names before DNS", async () => {
    const r = await validateDestination("metadata.google.internal", 443, {
      lookup: async () => {
        throw new Error("should not be called");
      },
    });
    expect(r.ok).toBe(false);
  });

  it("rejects when DNS lookup fails", async () => {
    const r = await validateDestination("nxdomain.example", 443, {
      lookup: async () => {
        throw new Error("NXDOMAIN");
      },
    });
    expect(r.ok).toBe(false);
  });
});
