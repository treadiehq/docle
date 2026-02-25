import { resolve4 } from "node:dns/promises";

export interface DomainIntel {
  websiteAlive: boolean | null;
  isParked: boolean;
  domainAgeDays: number | null;
  blacklisted: boolean | null;
  blacklistHits: string[];
}

const PARKED_INDICATORS = [
  "domain is for sale",
  "buy this domain",
  "parked domain",
  "this domain is parked",
  "coming soon",
  "under construction",
  "godaddy",
  "sedoparking",
  "hugedomains",
  "dan.com",
  "afternic",
  "namecheap parking",
  "squarespace - claim this domain",
];

const DNSBL_ZONES = [
  { zone: "zen.spamhaus.org", name: "Spamhaus" },
  { zone: "bl.spamcop.net", name: "SpamCop" },
  { zone: "b.barracudacentral.org", name: "Barracuda" },
];

function reverseIp(ip: string): string {
  return ip.split(".").reverse().join(".");
}

/**
 * Check if the domain's website is alive and whether it looks like a parked/for-sale page.
 */
async function checkWebsite(
  domain: string,
  timeoutMs: number,
): Promise<{ alive: boolean | null; parked: boolean }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`http://${domain}`, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "EmailVerify/1.0" },
    });

    clearTimeout(timer);

    if (!response.ok) {
      return { alive: false, parked: false };
    }

    const text = await response.text();
    const lower = text.toLowerCase().slice(0, 10_000);
    const parked = PARKED_INDICATORS.some((p) => lower.includes(p));

    return { alive: true, parked };
  } catch {
    return { alive: null, parked: false };
  }
}

/**
 * Check domain age via RDAP (free, structured JSON, no API key).
 * Queries the RDAP bootstrap to find the right server, then looks up registration date.
 */
async function checkDomainAge(
  domain: string,
  timeoutMs: number,
): Promise<number | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(`https://rdap.org/domain/${domain}`, {
      signal: controller.signal,
      headers: { Accept: "application/rdap+json" },
    });

    clearTimeout(timer);

    if (!response.ok) return null;

    const data = await response.json();
    const events: Array<{ eventAction: string; eventDate: string }> =
      data?.events ?? [];

    const registration = events.find(
      (e) => e.eventAction === "registration",
    );
    if (!registration?.eventDate) return null;

    const regDate = new Date(registration.eventDate);
    if (isNaN(regDate.getTime())) return null;

    return Math.floor((Date.now() - regDate.getTime()) / 86_400_000);
  } catch {
    return null;
  }
}

/**
 * Check if any of the domain's mail server IPs appear on DNS-based blacklists.
 * Uses standard DNSBL query format: reversed-ip.zone → if it resolves, IP is listed.
 */
async function checkDnsbl(
  mxHosts: string[],
  timeoutMs: number,
): Promise<{ blacklisted: boolean; hits: string[] }> {
  const hits: string[] = [];

  const hostToCheck = mxHosts[0];
  if (!hostToCheck) return { blacklisted: false, hits };

  let ips: string[];
  try {
    ips = await Promise.race([
      resolve4(hostToCheck),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), timeoutMs),
      ),
    ]);
  } catch {
    return { blacklisted: false, hits };
  }

  const ip = ips[0];
  if (!ip) return { blacklisted: false, hits };

  const reversed = reverseIp(ip);

  const checks = DNSBL_ZONES.map(async ({ zone, name }) => {
    try {
      await Promise.race([
        resolve4(`${reversed}.${zone}`),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("timeout")), timeoutMs),
        ),
      ]);
      hits.push(name);
    } catch {
      // NXDOMAIN = not listed (expected)
    }
  });

  await Promise.all(checks);

  return { blacklisted: hits.length > 0, hits };
}

const intelCache = new Map<
  string,
  { result: DomainIntel; expiresAt: number }
>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function getDomainIntel(
  domain: string,
  mxHosts: string[],
  timeoutMs: number = 5_000,
): Promise<DomainIntel> {
  const cached = intelCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const [website, ageDays, dnsbl] = await Promise.all([
    checkWebsite(domain, timeoutMs),
    checkDomainAge(domain, timeoutMs),
    checkDnsbl(mxHosts, timeoutMs),
  ]);

  const result: DomainIntel = {
    websiteAlive: website.alive,
    isParked: website.parked,
    domainAgeDays: ageDays,
    blacklisted: dnsbl.blacklisted,
    blacklistHits: dnsbl.hits,
  };

  intelCache.set(domain, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
