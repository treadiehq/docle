import type { VerifyStatus, SmtpVerdict } from "~~/types/verify";
import disposableDomains from "disposable-email-domains";

const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

const ROLE_LOCAL_PARTS = new Set([
  "info", "sales", "support", "hello", "admin", "billing",
  "contact", "team", "security", "abuse", "noc",
]);

const DISPOSABLE_SET: Set<string> = new Set(disposableDomains as string[]);

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase().replace(/^mailto:/, "");
}

export function parseEmail(email: string): { local: string; domain: string } | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return { local: email.slice(0, at), domain: email.slice(at + 1) };
}

export function isValidSyntax(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 254;
}

export function getRiskFlags(local: string, domain: string): string[] {
  const flags: string[] = [];
  if (ROLE_LOCAL_PARTS.has(local)) flags.push("Role-based address");
  if (DISPOSABLE_SET.has(domain)) flags.push("Disposable domain");
  return flags;
}

const MAJOR_PROVIDERS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.co.jp", "yahoo.fr", "yahoo.de", "yahoo.it", "yahoo.es", "yahoo.ca", "yahoo.com.au", "yahoo.com.br", "yahoo.co.in",
  "ymail.com", "rocketmail.com",
  "outlook.com", "hotmail.com", "hotmail.co.uk", "hotmail.fr", "hotmail.de", "hotmail.it", "hotmail.es",
  "live.com", "live.co.uk", "live.fr", "live.de",
  "msn.com",
  "icloud.com", "me.com", "mac.com",
  "protonmail.com", "proton.me", "pm.me",
  "aol.com",
  "zoho.com", "zohomail.com",
  "mail.com",
  "gmx.com", "gmx.de", "gmx.net",
  "fastmail.com", "fastmail.fm",
  "tutanota.com", "tuta.io",
  "yandex.com", "yandex.ru",
]);

export function isMajorProvider(domain: string): boolean {
  return MAJOR_PROVIDERS.has(domain.toLowerCase());
}

export interface ProviderSignals {
  microsoftExists?: boolean | null;
  hasGravatar?: boolean | null;
  hasGitHub?: boolean | null;
  hasPgpKey?: boolean | null;
  isMajorProvider?: boolean;
}

export interface IntelSignals {
  websiteAlive?: boolean | null;
  isParked?: boolean;
  domainAgeDays?: number | null;
  blacklisted?: boolean | null;
  looksHuman?: boolean;
  patternFlags?: string[];
}

export function computeStatus(
  syntaxOk: boolean,
  domain: string | null,
  mx: boolean | null,
  smtp: SmtpVerdict | null,
  riskFlags: string[],
  providers?: ProviderSignals,
): VerifyStatus {
  if (!syntaxOk || !domain) return "Invalid";
  if (mx === null) return "Unknown";
  if (!mx) return "Invalid";

  if (smtp === "rejected" && providers?.microsoftExists !== true) return "Invalid";

  if (providers?.microsoftExists === false) return "Invalid";
  if (providers?.microsoftExists === true && riskFlags.length === 0) return "Valid";

  if (smtp === "catch-all") return "Risky";
  if (smtp === "greylisted") return "Risky";
  if (riskFlags.length > 0) return "Risky";

  if (smtp === "accepted") return "Valid";

  if (providers?.hasGravatar === true) return "Valid";
  if (providers?.hasGitHub === true) return "Valid";
  if (providers?.hasPgpKey === true) return "Valid";

  if (providers?.isMajorProvider && (smtp === "error" || smtp === null)) return "Valid";

  return "Unknown";
}

export function computeConfidence(
  syntaxOk: boolean,
  mx: boolean | null,
  smtp: SmtpVerdict | null,
  riskFlags: string[],
  implicitMx: boolean,
  domainHealth?: { hasSPF: boolean; hasDMARC: boolean },
  providers?: ProviderSignals,
  intel?: IntelSignals,
): number {
  if (!syntaxOk) return 0;
  if (mx === null) return 20;
  if (!mx) return 5;

  let score: number;

  switch (smtp) {
    case "accepted":
      score = 97;
      break;
    case "rejected":
      score = 3;
      break;
    case "catch-all":
      score = 60;
      break;
    case "greylisted":
      score = 45;
      break;
    case "error":
    case null:
      score = providers?.isMajorProvider ? 78 : 40;
      break;
    default:
      score = 30;
  }

  if (providers?.microsoftExists === true) score = Math.max(score, 95);
  if (providers?.microsoftExists === false) score = Math.min(score, 5);
  if (providers?.hasGravatar === true) score = Math.max(score, 85);
  if (providers?.hasGitHub === true) score = Math.max(score, 90);
  if (providers?.hasPgpKey === true) score = Math.max(score, 88);

  if (implicitMx && score > 50) score -= 15;

  if (domainHealth) {
    if (domainHealth.hasSPF && domainHealth.hasDMARC) score += 5;
    else if (!domainHealth.hasSPF && !domainHealth.hasDMARC) score -= 10;
  }

  if (intel) {
    if (intel.websiteAlive === false) score -= 10;
    if (intel.isParked) score -= 15;
    if (intel.blacklisted) score -= 20;
    if (intel.domainAgeDays != null && intel.domainAgeDays < 30) score -= 15;
    if (intel.looksHuman === false) score -= 10;
    if (intel.patternFlags && intel.patternFlags.length > 0) score -= 5;
  }

  for (const flag of riskFlags) {
    if (flag === "Disposable domain") score = Math.min(score, 25);
    if (flag === "Role-based address") score -= 10;
  }

  return Math.max(0, Math.min(100, score));
}
