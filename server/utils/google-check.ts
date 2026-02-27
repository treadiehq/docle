/**
 * Check if a Google/Gmail account exists using Google's Android auth endpoint.
 * The endpoint returns different error codes for existing vs non-existing accounts.
 * No API key required — this is the same endpoint Android devices use during setup.
 */

const GOOGLE_CONSUMER_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
]);

let lastCallTs = 0;
const MIN_INTERVAL_MS = 3_000;

export function isGoogleDomain(domain: string, mxHosts: string[] = []): boolean {
  if (GOOGLE_CONSUMER_DOMAINS.has(domain.toLowerCase())) return true;
  return mxHosts.some(
    (h) => h.endsWith(".google.com") || h.endsWith(".googlemail.com"),
  );
}

export async function checkGoogleAccount(
  email: string,
  timeoutMs: number = 6_000,
): Promise<boolean | null> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallTs);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallTs = Date.now();

  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  const isConsumer = GOOGLE_CONSUMER_DOMAINS.has(domain);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const params = new URLSearchParams({
      Email: email,
      EncryptedPasswd: ".",
      has_permission: "1",
      service: "mail",
      source: "android",
      app: "com.google.android.gm",
      device_country: "us",
      operatorCountry: "us",
      lang: "en",
      sdk_version: "28",
    });

    const response = await fetch("https://android.clients.google.com/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "GoogleAuth/1.4",
      },
      body: params.toString(),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const text = await response.text();

    // Definitive signals (work for both consumer and Workspace)
    if (text.includes("INVALID_EMAIL")) return false;
    if (text.includes("NeedsBrowser")) return true;
    // Workspace-specific: device management required = account exists
    if (text.includes("DeviceManagementRequiredOrSyncDisabled")) return true;
    // BadAuthentication is definitive for consumer Gmail but ambiguous for Workspace
    // (Workspace returns this for both real and fake accounts)
    if (text.includes("BadAuthentication")) return isConsumer ? true : null;

    return null;
  } catch {
    return null;
  }
}
