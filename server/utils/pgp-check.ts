/**
 * Check if an email has a published PGP key on keys.openpgp.org.
 * Free, no auth, generous rate limits.
 * A PGP key means a real technical user deliberately registered that email.
 */

let lastCallTs = 0;
const MIN_INTERVAL_MS = 300;

export async function checkPgpKey(
  email: string,
  timeoutMs: number = 5_000,
): Promise<boolean | null> {
  const now = Date.now();
  const wait = MIN_INTERVAL_MS - (now - lastCallTs);
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastCallTs = Date.now();

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(
      `https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(email)}`,
      {
        method: "HEAD",
        signal: controller.signal,
      },
    );

    clearTimeout(timer);

    if (response.status === 200) return true;
    if (response.status === 404) return false;
    return null;
  } catch {
    return null;
  }
}
