interface Bucket {
  count: number;
  expiresAt: number;
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(
  ip: string,
  windowMs: number,
  maxRequests: number,
): boolean {
  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket || bucket.expiresAt <= now) {
    buckets.set(ip, { count: 1, expiresAt: now + windowMs });
    return true;
  }

  if (bucket.count >= maxRequests) return false;
  bucket.count++;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(key);
  }
}, 60_000).unref();
