import { resolveTxt } from "node:dns/promises";

const COMMON_SELECTORS = [
  "google",
  "selector1",
  "selector2",
  "default",
  "k1",
  "s1",
  "s2",
  "dkim",
  "mail",
  "smtp",
  "mandrill",
  "everlytickey1",
  "cm",
];

export interface DkimSignals {
  hasDkim: boolean;
  selectors: string[];
  hasMtaSts: boolean;
  hasBimi: boolean;
}

const cache = new Map<string, { result: DkimSignals; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

async function probeTxt(hostname: string, timeoutMs: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const records = await resolveTxt(hostname);
    clearTimeout(timer);
    return records.length > 0;
  } catch {
    return false;
  }
}

export async function checkDkimSignals(
  domain: string,
  timeoutMs: number = 3_000,
): Promise<DkimSignals> {
  const cached = cache.get(domain);
  if (cached && cached.expiresAt > Date.now()) return cached.result;

  const selectorProbes = COMMON_SELECTORS.map(async (sel) => {
    const found = await probeTxt(`${sel}._domainkey.${domain}`, timeoutMs);
    return found ? sel : null;
  });

  const [selectorResults, mtaSts, bimi] = await Promise.all([
    Promise.all(selectorProbes),
    probeTxt(`_mta-sts.${domain}`, timeoutMs),
    probeTxt(`_bimi.${domain}`, timeoutMs),
  ]);

  const selectors = selectorResults.filter((s): s is string => s !== null);

  const result: DkimSignals = {
    hasDkim: selectors.length > 0,
    selectors,
    hasMtaSts: mtaSts,
    hasBimi: bimi,
  };

  cache.set(domain, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
}, 60_000).unref();
