import { createHash } from "node:crypto";

interface BounceRecord {
  count: number;
  reporters: Set<string>;
  lastReportedAt: number;
}

const bounceMap = new Map<string, BounceRecord>();

function hashEmail(email: string): string {
  return createHash("sha256").update(email.toLowerCase().trim()).digest("hex");
}

export function reportBounce(email: string, reporterIp: string): void {
  const key = hashEmail(email);
  let record = bounceMap.get(key);
  if (!record) {
    record = { count: 0, reporters: new Set(), lastReportedAt: 0 };
    bounceMap.set(key, record);
  }
  record.count++;
  record.reporters.add(reporterIp);
  record.lastReportedAt = Date.now();
}

export function getBounceCount(email: string): { totalReports: number; uniqueReporters: number } {
  const key = hashEmail(email);
  const record = bounceMap.get(key);
  if (!record) return { totalReports: 0, uniqueReporters: 0 };
  return { totalReports: record.count, uniqueReporters: record.reporters.size };
}

// Rate limiter for bounce reports (per IP)
const reportBuckets = new Map<string, { count: number; expiresAt: number }>();

export function checkBounceReportRate(ip: string, maxPerMinute: number = 5): boolean {
  const now = Date.now();
  const bucket = reportBuckets.get(ip);
  if (!bucket || bucket.expiresAt <= now) {
    reportBuckets.set(ip, { count: 1, expiresAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= maxPerMinute) return false;
  bucket.count++;
  return true;
}

// Periodic cleanup of stale records (older than 30 days)
setInterval(() => {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [key, record] of bounceMap) {
    if (record.lastReportedAt < cutoff) bounceMap.delete(key);
  }
  const now = Date.now();
  for (const [key, bucket] of reportBuckets) {
    if (bucket.expiresAt <= now) reportBuckets.delete(key);
  }
}, 60_000).unref();
