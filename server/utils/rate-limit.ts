interface RequestBucket {
  count: number;
  expiresAt: number;
}

interface DailyBucket {
  emailCount: number;
  resetsAt: number;
  violationCount: number;
}

interface ConcurrencyTracker {
  active: number;
}

const requestBuckets = new Map<string, RequestBucket>();
const dailyBuckets = new Map<string, DailyBucket>();
const concurrency = new Map<string, ConcurrencyTracker>();
let globalDailyEmails = 0;
let globalResetsAt = nextMidnightUTC();

function nextMidnightUTC(): number {
  const now = new Date();
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return tomorrow.getTime();
}

function getDailyBucket(ip: string): DailyBucket {
  const now = Date.now();
  let bucket = dailyBuckets.get(ip);
  if (!bucket || bucket.resetsAt <= now) {
    bucket = { emailCount: 0, resetsAt: nextMidnightUTC(), violationCount: 0 };
    dailyBuckets.set(ip, bucket);
  }
  return bucket;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  dailyEmailCap: number;
  maxConcurrent: number;
  globalDailyCap: number;
}

export interface RateLimitResult {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
}

/**
 * Check per-IP request rate (requests per minute).
 */
export function checkRequestRate(ip: string, maxPerMinute: number): RateLimitResult {
  const now = Date.now();
  const bucket = requestBuckets.get(ip);

  if (!bucket || bucket.expiresAt <= now) {
    requestBuckets.set(ip, { count: 1, expiresAt: now + 60_000 });
    return { allowed: true };
  }

  if (bucket.count >= maxPerMinute) {
    const daily = getDailyBucket(ip);
    daily.violationCount++;

    const backoffMs = Math.min(60_000 * Math.pow(2, daily.violationCount - 1), 3_600_000);
    return {
      allowed: false,
      reason: `Rate limit exceeded. Max ${maxPerMinute} requests per minute.`,
      retryAfterMs: Math.min(bucket.expiresAt - now, backoffMs),
    };
  }

  bucket.count++;
  return { allowed: true };
}

/**
 * Check per-IP daily email cap and reserve capacity atomically.
 * Returns how many emails are allowed from the requested count.
 */
export function checkDailyEmailCap(ip: string, requestedCount: number, dailyCap: number): RateLimitResult & { allowedCount: number } {
  const bucket = getDailyBucket(ip);
  const remaining = Math.max(0, dailyCap - bucket.emailCount);

  if (remaining === 0) {
    return {
      allowed: false,
      allowedCount: 0,
      reason: `Daily limit of ${dailyCap} emails reached. Resets at midnight UTC.`,
      retryAfterMs: bucket.resetsAt - Date.now(),
    };
  }

  const allowedCount = Math.min(requestedCount, remaining);
  bucket.emailCount += allowedCount;
  return { allowed: true, allowedCount };
}

/**
 * Check global daily email ceiling across all IPs and reserve capacity atomically.
 */
export function checkGlobalCap(requestedCount: number, globalCap: number): RateLimitResult {
  const now = Date.now();
  if (now >= globalResetsAt) {
    globalDailyEmails = 0;
    globalResetsAt = nextMidnightUTC();
  }

  if (globalDailyEmails + requestedCount > globalCap) {
    return {
      allowed: false,
      reason: "Service is at capacity for today. Please try again tomorrow.",
      retryAfterMs: globalResetsAt - now,
    };
  }

  globalDailyEmails += requestedCount;
  return { allowed: true };
}

/**
 * Acquire a concurrent request slot. Returns false if at max.
 */
export function acquireConcurrency(ip: string, maxConcurrent: number): RateLimitResult {
  let tracker = concurrency.get(ip);
  if (!tracker) {
    tracker = { active: 0 };
    concurrency.set(ip, tracker);
  }

  if (tracker.active >= maxConcurrent) {
    return {
      allowed: false,
      reason: `Too many concurrent requests. Max ${maxConcurrent} at a time.`,
    };
  }

  tracker.active++;
  return { allowed: true };
}

/**
 * Release a concurrent request slot.
 */
export function releaseConcurrency(ip: string): void {
  const tracker = concurrency.get(ip);
  if (tracker && tracker.active > 0) {
    tracker.active--;
  }
}

// Periodic cleanup of expired buckets
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of requestBuckets) {
    if (bucket.expiresAt <= now) requestBuckets.delete(key);
  }
  for (const [key, bucket] of dailyBuckets) {
    if (bucket.resetsAt <= now) dailyBuckets.delete(key);
  }
  for (const [key, tracker] of concurrency) {
    if (tracker.active === 0) concurrency.delete(key);
  }
}, 60_000).unref();
