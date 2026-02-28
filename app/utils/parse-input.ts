export function parseEmailInput(raw: string): string[] {
  const emailPattern = /<?([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>?/g;

  const emails: string[] = [];
  for (const match of raw.matchAll(emailPattern)) {
    const email = match[1]?.trim().toLowerCase().replace(/^mailto:/, "") ?? "";
    if (email.length > 0) emails.push(email);
  }

  return [...new Set(emails)];
}
