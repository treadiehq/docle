export type VerifyStatus = "Valid" | "Invalid" | "Risky" | "Unknown";

export type SmtpVerdict = "accepted" | "rejected" | "catch-all" | "greylisted" | "error";

export interface ProviderChecks {
  microsoft?: boolean | null;
  gravatar?: boolean | null;
  github?: boolean | null;
  pgp?: boolean | null;
  google?: boolean | null;
  apple?: boolean | null;
  hibp?: boolean | null;
}

export interface DomainIntelSummary {
  websiteAlive?: boolean | null;
  isParked?: boolean;
  domainAgeDays?: number | null;
  blacklisted?: boolean | null;
}

export interface VerifyResult {
  email: string;
  domain: string;
  mx: boolean | null;
  smtp: SmtpVerdict | null;
  status: VerifyStatus;
  confidence: number;
  notes: string[];
  suggestedEmail?: string;
  providerChecks?: ProviderChecks;
  domainIntel?: DomainIntelSummary;
}

export interface VerifyRequest {
  emails: string[];
}

export interface VerifyResponse {
  results: VerifyResult[];
  agent?: {
    uid: string;
    usage: {
      emailsVerified: number;
      requests: number;
      dailyLimit: number;
      remaining: number;
    };
  };
}
