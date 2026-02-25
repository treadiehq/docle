export function parseEmailInput(raw: string): string[] {
  const emails = raw
    .split(/[\n,;\s]+/)
    .map((s) => s.trim().toLowerCase().replace(/^mailto:/, ""))
    .filter((s) => s.length > 0);

  return [...new Set(emails)];
}
