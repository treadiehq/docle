/**
 * Check if an email is publicly associated with a GitHub user profile.
 * Uses the unauthenticated GitHub search API (10 req/min limit).
 * Only use for single-email verification — skip during bulk.
 */

let lastCallTs = 0;
const MIN_INTERVAL_MS = 6_500;

export async function checkGitHub(
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
      `https://api.github.com/search/users?q=${encodeURIComponent(email)}+in:email`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "EmailVerify/1.0",
        },
        signal: controller.signal,
      },
    );

    clearTimeout(timer);

    if (response.status === 403 || response.status === 429) {
      return null;
    }
    if (!response.ok) return null;

    const data = await response.json();
    return (data?.total_count ?? 0) > 0;
  } catch {
    return null;
  }
}
