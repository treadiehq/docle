/**
 * Check if an email has a Gravatar profile by querying the Gravatar API.
 * Uses the MD5 hash of the lowercase, trimmed email address.
 * Returns 200 if a profile exists, 404 if not — completely free, no API key.
 */

import { createHash } from "node:crypto";

let lastCallTs = 0;
const MIN_INTERVAL_MS = 200;

export async function checkGravatar(
  email: string,
  timeoutMs: number = 5_000,
): Promise<boolean | null> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallTs);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCallTs = Date.now();

  const hash = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  const url = `https://gravatar.com/avatar/${hash}?d=404&s=1`;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.status === 200) return true;
    if (response.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}
