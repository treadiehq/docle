/**
 * Uses Microsoft's public GetCredentialType endpoint to check whether an
 * email account exists on Outlook.com, Hotmail, Live, or any Microsoft 365
 * tenant. This is the same endpoint the Microsoft login page calls when you
 * type an email and click "Next."
 */

export interface MicrosoftCheckResult {
  exists: boolean | null;
  isManaged: boolean;
  throttled: boolean;
}

const MS_ENDPOINT = "https://login.microsoftonline.com/common/GetCredentialType";

const MICROSOFT_CONSUMER_DOMAINS = new Set([
  "outlook.com",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.de",
  "hotmail.it",
  "hotmail.es",
  "live.com",
  "live.co.uk",
  "live.fr",
  "live.de",
  "live.it",
  "live.nl",
  "msn.com",
  "outlook.co.uk",
  "outlook.fr",
  "outlook.de",
  "outlook.it",
  "outlook.es",
  "outlook.com.au",
  "outlook.jp",
]);

let lastCallTs = 0;
const MIN_INTERVAL_MS = 500;

export function isMicrosoftDomain(domain: string): boolean {
  return MICROSOFT_CONSUMER_DOMAINS.has(domain);
}

/**
 * Check if a Microsoft-hosted email account exists.
 * Works for consumer Outlook/Hotmail/Live domains and Microsoft 365 tenants.
 * Rate-limited to max 2 requests/second to avoid throttling.
 */
export async function checkMicrosoftAccount(
  email: string,
  timeoutMs: number = 5_000,
): Promise<MicrosoftCheckResult> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallTs);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCallTs = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(MS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: email,
        isOtherIdpSupported: false,
        checkPhones: false,
        isRemoteNGCSupported: false,
        isCookieBannerShown: false,
        isFidoSupported: false,
        forceotclogin: false,
        isExternalFederationDisallowed: false,
        isRemoteConnectSupported: false,
        isSignup: false,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.status === 429) {
      return { exists: null, isManaged: false, throttled: true };
    }

    if (!response.ok) {
      return { exists: null, isManaged: false, throttled: false };
    }

    const data = await response.json();

    // IfExistsResult: 0 = exists, 1 = doesn't exist, 5/6 = exists on different IdP
    const ifExists: number | undefined = data?.IfExistsResult;
    const isManaged: boolean = data?.EstsProperties?.DomainType === 3;

    if (ifExists === 0 || ifExists === 5 || ifExists === 6) {
      return { exists: true, isManaged, throttled: false };
    }
    if (ifExists === 1) {
      return { exists: false, isManaged, throttled: false };
    }

    return { exists: null, isManaged, throttled: false };
  } catch {
    return { exists: null, isManaged: false, throttled: false };
  }
}
