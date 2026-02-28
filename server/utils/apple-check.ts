/**
 * Check if an Apple ID exists for an email (iCloud, me.com, mac.com).
 * Uses Apple's federate auth endpoint — the first step of Sign In with Apple.
 * A real account returns { hasSWP: true, primaryAuthOptions: ["SWP"] }.
 * A non-existent account returns only { federated: false } with no hasSWP field.
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
let queue: Promise<unknown> = Promise.resolve();

export function isAppleDomain(domain: string): boolean {
  return APPLE_DOMAINS.has(domain.toLowerCase());
}

export function checkAppleAccount(
  email: string,
  timeoutMs: number = 6_000,
): Promise<boolean | null> {
  const p = queue.then(async (): Promise<boolean | null> => {
    const now = Date.now();
    const wait = MIN_INTERVAL_MS - (now - lastCallTs);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCallTs = Date.now();

    const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(
      "https://appleid.apple.com/appleauth/auth/federate?isRememberMeEnabled=true",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Apple-Widget-Key": APPLE_WIDGET_KEY,
          "X-Apple-OAuth-Client-Id": APPLE_WIDGET_KEY,
          "X-Apple-OAuth-Client-Type": "firstPartyAuth",
          "X-Apple-OAuth-Redirect-URI": "https://appleid.apple.com",
          "X-Apple-OAuth-Response-Mode": "web_message",
          "X-Apple-OAuth-Response-Type": "code",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Origin: "https://appleid.apple.com",
          Referer: "https://appleid.apple.com/",
        },
        body: JSON.stringify({ accountName: email, rememberMe: true }),
        signal: controller.signal,
      },
    );

    if (response.status === 403 || response.status === 429) return null;

    if (response.status === 200) {
      try {
        const data = await response.json() as Record<string, unknown>;
        if (data.hasSWP === true) return true;
        return false;
      } catch {
        return null;
      }
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
  });
  queue = p.catch(() => {});
  return p;
}
