/**
 * Reverse MX Intelligence — detect which email provider hosts a domain
 * by analyzing its MX record hostnames. This unlocks provider-specific
 * account checks (Google, Microsoft, Zoho, etc.) for custom domains.
 */

export type MxProvider =
  | "google"
  | "microsoft"
  | "apple"
  | "zoho"
  | "protonmail"
  | "fastmail"
  | "yandex"
  | "mimecast"
  | "barracuda"
  | "rackspace"
  | null;

interface MxPattern {
  provider: MxProvider;
  patterns: string[];
}

const MX_PATTERNS: MxPattern[] = [
  {
    provider: "google",
    patterns: [
      ".google.com",
      ".googlemail.com",
      "smtp.google.com",
      "aspmx.l.google.com",
      "gmail-smtp-in.l.google.com",
    ],
  },
  {
    provider: "microsoft",
    patterns: [
      ".mail.protection.outlook.com",
      ".mail.eo.outlook.com",
      ".pamx1.hotmail.com",
      ".mx.microsoft",
      ".olc.protection.outlook.com",
    ],
  },
  {
    provider: "apple",
    patterns: [
      ".mail.icloud.com",
      ".apple.com",
    ],
  },
  {
    provider: "zoho",
    patterns: [
      ".zoho.com",
      ".zoho.eu",
      ".zoho.in",
      ".zohomail.com",
    ],
  },
  {
    provider: "protonmail",
    patterns: [
      ".protonmail.ch",
      ".proton.ch",
      "mail.protonmail.ch",
      "mailsec.protonmail.ch",
    ],
  },
  {
    provider: "fastmail",
    patterns: [
      ".fastmail.com",
      ".messagingengine.com",
    ],
  },
  {
    provider: "yandex",
    patterns: [
      ".yandex.net",
      ".yandex.ru",
      "mx.yandex.net",
    ],
  },
  {
    provider: "mimecast",
    patterns: [
      ".mimecast.com",
    ],
  },
  {
    provider: "barracuda",
    patterns: [
      ".barracudanetworks.com",
      ".ess.barracuda.com",
    ],
  },
  {
    provider: "rackspace",
    patterns: [
      ".emailsrvr.com",
    ],
  },
];

/**
 * Detect which email provider hosts this domain based on MX hostnames.
 * Returns the provider identifier or null if unknown.
 */
export function detectMxProvider(mxHosts: string[]): MxProvider {
  for (const host of mxHosts) {
    const lower = host.toLowerCase();
    for (const { provider, patterns } of MX_PATTERNS) {
      for (const pattern of patterns) {
        if (lower.endsWith(pattern) || lower === pattern.replace(/^\./, "")) {
          return provider;
        }
      }
    }
  }
  return null;
}

/**
 * Check if the MX provider supports account existence checks.
 */
export function providerSupportsAccountCheck(provider: MxProvider): boolean {
  return provider === "google" || provider === "microsoft";
}
