/**
 * Check if an Apple ID exists for an email (iCloud, me.com, mac.com).
 * Uses Apple's public auth endpoint — same as the Sign In with Apple flow.
 * Returns true if account exists, false if not, null on error/rate-limit.
 */

const APPLE_WIDGET_KEY = "d39ba9916b7251055b22c7f910e2ea796ee65e98b2ddecea8f5dde8d9d1a815d";

const APPLE_DOMAINS = new Set([
  "icloud.com",
  "me.com",
  "mac.com",
]);

let lastCallTs = 0;
const MIN_INTERVAL_MS = 2_000;

export function isAppleDomain(domain: string): boolean {
  return APPLE_DOMAINS.has(domain.toLowerCase());
}

export async function checkAppleAccount(
  email: string,
  timeoutMs: number = 6_000,
): Promise<boolean | null> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallTs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallTs = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch("https://appleid.apple.com/auth/verify/trusteddevice", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Apple-Widget-Key": APPLE_WIDGET_KEY,
        "X-Apple-OAuth-Client-Id": APPLE_WIDGET_KEY,
        "X-Apple-OAuth-Client-Type": "firstPartyAuth",
        "X-Apple-OAuth-Redirect-URI": "https://appleid.apple.com",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        Origin: "https://appleid.apple.com",
        Referer: "https://appleid.apple.com/",
      },
      body: JSON.stringify({
        accountName: email,
        rememberMe: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    // 200/409 = account exists (auth challenge returned)
    // 400 with specific error = account doesn't exist
    // 403 = rate limited or blocked
    if (response.status === 409 || response.status === 200) return true;
    if (response.status === 403 || response.status === 429) return null;

    if (response.status === 400 || response.status === 404) {
      try {
        const data = await response.json();
        const code = data?.serviceErrors?.[0]?.code;
        if (code === "-20101" || code === "-20209") return false;
      } catch { /* ignore parse errors */ }
      return false;
    }

    // Fallback: try the iForgot endpoint as secondary check
    return await checkViaIforgot(email, timeoutMs);
  } catch {
    return null;
  }
}

async function checkViaIforgot(
  email: string,
  timeoutMs: number,
): Promise<boolean | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch("https://iforgot.apple.com/password/verify/appleid", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      },
      body: JSON.stringify({ id: email }),
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
