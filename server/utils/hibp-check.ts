/**
 * Check if an email has appeared in known data breaches via
 * Have I Been Pwned (HIBP). If an email appears in breaches,
 * it definitely existed at some point — strong proof of realness.
 *
 * The HIBP v3 API requires an API key ($3.50/month from haveibeenpwned.com/API/Key).
 * Set NUXT_HIBP_API_KEY in your environment to enable this check.
 * If no key is set, the check is skipped (returns null).
 *
 * HIBP requires a minimum 1.5s delay between requests.
 */

let lastCallTs = 0;
const MIN_INTERVAL_MS = 1_600;

export async function checkHIBP(
  email: string,
  apiKey: string | undefined,
  timeoutMs: number = 5_000,
): Promise<{ breached: boolean; breachCount: number } | null> {
  if (!apiKey) return null;

  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallTs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallTs = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(
      `https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=true`,
      {
        headers: {
          "hibp-api-key": apiKey,
          "User-Agent": "Docle-EmailVerify",
        },
        signal: controller.signal,
      },
    );

    clearTimeout(timer);

    if (response.status === 200) {
      const breaches = await response.json();
      return { breached: true, breachCount: Array.isArray(breaches) ? breaches.length : 1 };
    }
    if (response.status === 404) {
      return { breached: false, breachCount: 0 };
    }
    // 401 = bad key, 429 = rate limited
    return null;
  } catch {
    return null;
  }
}
