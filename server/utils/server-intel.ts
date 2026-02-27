import type { SmtpVerdict } from "./smtp";

interface ServerRecord {
  totalProbes: number;
  acceptedCount: number;
  rejectedCount: number;
  catchAllCount: number;
  lastUpdated: number;
}

const serverMap = new Map<string, ServerRecord>();

export function recordServerResult(host: string, verdict: SmtpVerdict): void {
  if (!host) return;
  const key = host.toLowerCase();
  let record = serverMap.get(key);
  if (!record) {
    record = { totalProbes: 0, acceptedCount: 0, rejectedCount: 0, catchAllCount: 0, lastUpdated: 0 };
    serverMap.set(key, record);
  }
  record.totalProbes++;
  record.lastUpdated = Date.now();

  switch (verdict) {
    case "accepted":
      record.acceptedCount++;
      break;
    case "rejected":
      record.rejectedCount++;
      break;
    case "catch-all":
      record.catchAllCount++;
      break;
  }
}

/**
 * Returns the accept rate for a server (0-1), or null if insufficient data.
 * A server that accepts >90% of probes across 10+ checks is likely a catch-all
 * that our two-probe test doesn't detect.
 */
export function getServerCatchAllRate(host: string): number | null {
  if (!host) return null;
  const key = host.toLowerCase();
  const record = serverMap.get(key);
  if (!record || record.totalProbes < 10) return null;

  const acceptRate = (record.acceptedCount + record.catchAllCount) / record.totalProbes;
  return acceptRate;
}

/**
 * Check if a server is a suspected catch-all based on historical behavior.
 */
export function isSuspectedCatchAll(host: string): boolean {
  const rate = getServerCatchAllRate(host);
  return rate !== null && rate > 0.9;
}

// Periodic cleanup of stale records (older than 7 days)
setInterval(() => {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [key, record] of serverMap) {
    if (record.lastUpdated < cutoff) serverMap.delete(key);
  }
}, 300_000).unref();
