/**
 * Analyzes email local parts for patterns that indicate real vs fake addresses.
 * Uses entropy scoring and common business email pattern matching.
 */

export interface PatternAnalysis {
  entropy: number;
  looksHuman: boolean;
  matchesPattern: string | null;
  flags: string[];
}

const BUSINESS_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "firstname.lastname", re: /^[a-z]{2,15}\.[a-z]{2,20}$/ },
  { name: "firstnamelastname", re: /^[a-z]{2,15}[a-z]{2,20}$/ },
  { name: "f.lastname", re: /^[a-z]\.[a-z]{2,20}$/ },
  { name: "firstname.l", re: /^[a-z]{2,15}\.[a-z]$/ },
  { name: "flastname", re: /^[a-z][a-z]{2,20}$/ },
  { name: "firstname_lastname", re: /^[a-z]{2,15}_[a-z]{2,20}$/ },
  { name: "firstname-lastname", re: /^[a-z]{2,15}-[a-z]{2,20}$/ },
  { name: "firstnamelNNN", re: /^[a-z]{2,15}[a-z]?\d{1,4}$/ },
];

function shannonEntropy(s: string): number {
  if (s.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const c of s) {
    freq.set(c, (freq.get(c) || 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return Math.round(entropy * 100) / 100;
}

export function analyzeLocalPart(local: string): PatternAnalysis {
  const flags: string[] = [];
  const entropy = shannonEntropy(local);

  // High entropy (>3.5) with length >10 suggests auto-generated
  if (entropy > 3.5 && local.length > 10) {
    flags.push("Looks auto-generated");
  }

  // Very short local parts are suspicious unless they're initials
  if (local.length <= 2 && !/^[a-z]{1,2}$/.test(local)) {
    flags.push("Unusually short local part");
  }

  // Excessive numbers
  const digitRatio = (local.match(/\d/g)?.length ?? 0) / local.length;
  if (digitRatio > 0.5 && local.length > 5) {
    flags.push("Mostly numeric local part");
  }

  // Check for known business patterns
  let matchesPattern: string | null = null;
  for (const { name, re } of BUSINESS_PATTERNS) {
    if (re.test(local)) {
      matchesPattern = name;
      break;
    }
  }

  const looksHuman =
    matchesPattern !== null ||
    (entropy < 3.5 && local.length >= 3 && local.length <= 30 && digitRatio < 0.4);

  return { entropy, looksHuman, matchesPattern, flags };
}

/**
 * Detect the dominant local part pattern in a set of emails for the same domain.
 * If one email doesn't match the dominant pattern, it's suspicious.
 */
export function detectBulkAnomalies(
  emails: Array<{ local: string; domain: string }>,
): Map<string, string[]> {
  const anomalies = new Map<string, string[]>();

  // Group by domain
  const byDomain = new Map<string, string[]>();
  for (const { local, domain } of emails) {
    const list = byDomain.get(domain) || [];
    list.push(local);
    byDomain.set(domain, list);
  }

  for (const [domain, locals] of byDomain) {
    if (locals.length < 3) continue;

    // Find dominant pattern
    const patternCounts = new Map<string, number>();
    for (const local of locals) {
      const analysis = analyzeLocalPart(local);
      const key = analysis.matchesPattern || "other";
      patternCounts.set(key, (patternCounts.get(key) || 0) + 1);
    }

    let dominantPattern = "other";
    let maxCount = 0;
    for (const [pattern, count] of patternCounts) {
      if (count > maxCount) {
        dominantPattern = pattern;
        maxCount = count;
      }
    }

    if (dominantPattern === "other" || maxCount < 3) continue;

    const threshold = maxCount / locals.length;
    if (threshold < 0.5) continue;

    for (const local of locals) {
      const analysis = analyzeLocalPart(local);
      const key = analysis.matchesPattern || "other";
      if (key !== dominantPattern) {
        const email = `${local}@${domain}`;
        const flags = anomalies.get(email) || [];
        flags.push(
          `Doesn't match the ${dominantPattern} pattern used by ${maxCount}/${locals.length} emails at ${domain}`,
        );
        anomalies.set(email, flags);
      }
    }
  }

  return anomalies;
}
