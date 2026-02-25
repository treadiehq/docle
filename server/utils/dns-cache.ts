import { resolveMx, resolve4, resolve6 } from "node:dns/promises";

export interface MxLookupResult {
  hasMx: boolean;
  hosts: string[];
  viaImplicitMx: boolean;
}

interface CacheEntry {
  result: MxLookupResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

export async function lookupMx(
  domain: string,
  timeoutMs: number,
  ttlMs: number,
): Promise<MxLookupResult | null> {
  const now = Date.now();
  const cached = cache.get(domain);
  if (cached && cached.expiresAt > now) return cached.result;

  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS timeout")), timeoutMs),
      ),
    ]);

  try {
    const records = await withTimeout(resolveMx(domain));
    const hasMx = Array.isArray(records) && records.length > 0;
    const hosts = hasMx
      ? records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange)
      : [];

    if (hasMx) {
      const result: MxLookupResult = { hasMx: true, hosts, viaImplicitMx: false };
      cache.set(domain, { result, expiresAt: now + ttlMs });
      return result;
    }

    // RFC 5321 sec 5.1: no MX → fall back to A/AAAA
    return await fallbackToAddressRecord(domain, now, ttlMs, withTimeout);
  } catch (err: any) {
    if (err?.code === "ENOTFOUND" || err?.code === "ENODATA") {
      return await fallbackToAddressRecord(domain, now, ttlMs, withTimeout);
    }
    return null;
  }
}

async function fallbackToAddressRecord(
  domain: string,
  now: number,
  ttlMs: number,
  withTimeout: <T>(p: Promise<T>) => Promise<T>,
): Promise<MxLookupResult> {
  try {
    const [v4, v6] = await Promise.allSettled([
      withTimeout(resolve4(domain)),
      withTimeout(resolve6(domain)),
    ]);
    const addrs = [
      ...(v4.status === "fulfilled" ? v4.value : []),
      ...(v6.status === "fulfilled" ? v6.value : []),
    ];
    if (addrs.length > 0) {
      const result: MxLookupResult = {
        hasMx: true,
        hosts: [domain],
        viaImplicitMx: true,
      };
      cache.set(domain, { result, expiresAt: now + ttlMs });
      return result;
    }
  } catch {
    // fall through
  }

  const result: MxLookupResult = { hasMx: false, hosts: [], viaImplicitMx: false };
  cache.set(domain, { result, expiresAt: now + ttlMs });
  return result;
}

export function clearExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}
