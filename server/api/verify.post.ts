import pLimit from "p-limit";
import type { VerifyRequest, VerifyResponse, VerifyResult } from "~~/types/verify";
import {
  normalizeEmail,
  parseEmail,
  isValidSyntax,
  getRiskFlags,
  computeStatus,
  computeConfidence,
  isMajorProvider,
} from "~~/server/utils/email";
import { lookupMx, type MxLookupResult } from "~~/server/utils/dns-cache";
import { verifySmtp } from "~~/server/utils/smtp";
import {
  checkRequestRate,
  checkDailyEmailCap,
  recordEmailsUsed,
  checkGlobalCap,
  recordGlobalEmails,
  acquireConcurrency,
  releaseConcurrency,
} from "~~/server/utils/rate-limit";
import { checkDomainHealth, type DomainHealth } from "~~/server/utils/domain-health";
import { detectTypo } from "~~/server/utils/typo";
import { checkMicrosoftAccount, isMicrosoftDomain } from "~~/server/utils/microsoft-check";
import { checkGravatar } from "~~/server/utils/gravatar-check";
import { getDomainIntel, type DomainIntel } from "~~/server/utils/domain-intel";
import { analyzeLocalPart, detectBulkAnomalies } from "~~/server/utils/pattern-analysis";
import { checkGitHub } from "~~/server/utils/github-check";
import { checkPgpKey } from "~~/server/utils/pgp-check";
import { checkGoogleAccount, isGoogleDomain } from "~~/server/utils/google-check";
import { checkAppleAccount, isAppleDomain } from "~~/server/utils/apple-check";
import { checkHIBP } from "~~/server/utils/hibp-check";
import type { ProviderChecks, DomainIntelSummary } from "~~/types/verify";
import type { ProviderSignals, IntelSignals } from "~~/server/utils/email";

export default defineEventHandler(async (event): Promise<VerifyResponse> => {
  const config = useRuntimeConfig();

  const ip =
    getRequestHeader(event, "x-forwarded-for")?.split(",")[0]?.trim() ||
    getRequestHeader(event, "x-real-ip") ||
    "unknown";

  // 1. Per-IP request rate
  const rateCheck = checkRequestRate(ip, config.rateLimitRequestsPerMinute as number);
  if (!rateCheck.allowed) {
    setResponseHeader(event, "Retry-After", String(Math.ceil((rateCheck.retryAfterMs ?? 60_000) / 1000)));
    throw createError({ statusCode: 429, statusMessage: rateCheck.reason });
  }

  // 2. Concurrency guard
  const concCheck = acquireConcurrency(ip, config.rateLimitMaxConcurrent as number);
  if (!concCheck.allowed) {
    throw createError({ statusCode: 429, statusMessage: concCheck.reason });
  }

  try {

  const body = await readBody<VerifyRequest>(event);
  if (!body?.emails || !Array.isArray(body.emails)) {
    throw createError({ statusCode: 400, statusMessage: "emails[] required" });
  }
  if (body.emails.length > (config.maxEmailsPerRequest as number)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Max ${config.maxEmailsPerRequest} emails per request`,
    });
  }

  // 3. Per-IP daily email cap
  const dailyCheck = checkDailyEmailCap(ip, body.emails.length, config.rateLimitDailyEmailCap as number);
  if (!dailyCheck.allowed) {
    setResponseHeader(event, "Retry-After", String(Math.ceil((dailyCheck.retryAfterMs ?? 86_400_000) / 1000)));
    throw createError({ statusCode: 429, statusMessage: dailyCheck.reason });
  }
  const emailsToProcess = body.emails.slice(0, dailyCheck.allowedCount);

  // 4. Global daily ceiling
  const globalCheck = checkGlobalCap(emailsToProcess.length, config.rateLimitGlobalDailyCap as number);
  if (!globalCheck.allowed) {
    throw createError({ statusCode: 503, statusMessage: globalCheck.reason });
  }

  const limit = pLimit(config.dnsConcurrency as number);
  const smtpTimeoutMs = (config.smtpTimeoutMs as number) || 10_000;

  const domainMxMap = new Map<string, Promise<MxLookupResult | null>>();
  const domainHealthMap = new Map<string, Promise<DomainHealth>>();
  const domainIntelMap = new Map<string, Promise<DomainIntel>>();

  function getMx(domain: string): Promise<MxLookupResult | null> {
    let pending = domainMxMap.get(domain);
    if (!pending) {
      pending = limit(() =>
        lookupMx(
          domain,
          config.dnsTimeoutMs as number,
          config.dnsCacheTtlMs as number,
        ),
      );
      domainMxMap.set(domain, pending);
    }
    return pending;
  }

  function getHealth(domain: string): Promise<DomainHealth> {
    let pending = domainHealthMap.get(domain);
    if (!pending) {
      pending = limit(() =>
        checkDomainHealth(domain, config.dnsTimeoutMs as number),
      );
      domainHealthMap.set(domain, pending);
    }
    return pending;
  }

  function getIntel(domain: string, mxHosts: string[]): Promise<DomainIntel> {
    let pending = domainIntelMap.get(domain);
    if (!pending) {
      pending = limit(() => getDomainIntel(domain, mxHosts));
      domainIntelMap.set(domain, pending);
    }
    return pending;
  }

  // Pre-parse emails for bulk anomaly detection
  const parsedEmails = emailsToProcess.map((raw) => {
    const email = normalizeEmail(raw);
    const parsed = parseEmail(email);
    return { email, local: parsed?.local ?? "", domain: parsed?.domain ?? "" };
  });
  const bulkAnomalies = parsedEmails.length >= 3
    ? detectBulkAnomalies(parsedEmails)
    : new Map<string, string[]>();

  const results: VerifyResult[] = await Promise.all(
    emailsToProcess.map(async (raw) => {
      const email = normalizeEmail(raw);
      const syntaxOk = isValidSyntax(email);
      const parsed = parseEmail(email);
      const domain = parsed?.domain ?? "";
      const local = parsed?.local ?? "";

      let mx: boolean | null = null;
      let mxHosts: string[] = [];
      let implicitMx = false;
      let smtp: VerifyResult["smtp"] = null;
      let domainHealth: DomainHealth | undefined;
      const providerChecks: ProviderChecks = {};
      const notes: string[] = [];

      if (!syntaxOk) {
        notes.push("Invalid syntax");
      } else if (!domain) {
        notes.push("Missing domain");
      } else {
        const [mxResult, health] = await Promise.all([
          getMx(domain),
          getHealth(domain),
        ]);
        domainHealth = health;

        if (mxResult === null) {
          mx = null;
          notes.push("DNS lookup failed");
        } else {
          mx = mxResult.hasMx;
          mxHosts = mxResult.hosts;
          implicitMx = mxResult.viaImplicitMx;
          if (!mx) notes.push("No MX or A records found");
          if (implicitMx) notes.push("No MX records, using A-record fallback");
        }

        if (mx && mxHosts.length > 0) {
          const smtpResult = await limit(() =>
            verifySmtp(email, domain, mxHosts, smtpTimeoutMs),
          );
          smtp = smtpResult.verdict;

          if (smtp === "rejected") notes.push("Mailbox does not exist (SMTP rejected)");
          if (smtp === "accepted") notes.push("Mail server accepted this address");
          if (smtp === "catch-all") notes.push("Server accepts all addresses (catch-all) — mailbox may not actually exist");
          if (smtp === "greylisted") notes.push("Server deferred (greylisted/temp block)");
          if (smtp === "error") notes.push("SMTP verification inconclusive");
        }

        // Detect provider-specific domains
        const isMsHosted = isMicrosoftDomain(domain) ||
          mxHosts.some((h) => h.endsWith(".mail.protection.outlook.com"));
        const isGoogleHosted = isGoogleDomain(domain, mxHosts);
        const isAppleHosted = isAppleDomain(domain);

        // Provider-specific checks (run when SMTP is inconclusive or for extra confirmation)
        const smtpInconclusive = smtp === "error" || smtp === null;
        const runMicrosoft = isMsHosted && (smtpInconclusive || smtp === "rejected");
        const runGoogle = isGoogleHosted && (smtpInconclusive || smtp === "rejected");
        const runApple = isAppleHosted && (smtpInconclusive || smtp === "rejected");
        const runGravatar = smtpInconclusive;
        const isSingleMode = emailsToProcess.length === 1;
        const runGitHub = isSingleMode && smtpInconclusive;
        const runPgp = smtpInconclusive;
        const hibpKey = (config.hibpApiKey as string) || undefined;
        const runHIBP = smtpInconclusive && !!hibpKey;

        const [msResult, googleResult, appleResult, gravatarResult, githubResult, pgpResult, hibpResult] = await Promise.all([
          runMicrosoft ? limit(() => checkMicrosoftAccount(email)) : Promise.resolve(null),
          runGoogle ? checkGoogleAccount(email) : Promise.resolve(null),
          runApple ? checkAppleAccount(email) : Promise.resolve(null),
          runGravatar ? limit(() => checkGravatar(email)) : Promise.resolve(null),
          runGitHub ? checkGitHub(email) : Promise.resolve(null),
          runPgp ? limit(() => checkPgpKey(email)) : Promise.resolve(null),
          runHIBP ? checkHIBP(email, hibpKey) : Promise.resolve(null),
        ]);

        if (msResult && !msResult.throttled) {
          providerChecks.microsoft = msResult.exists;
          if (msResult.exists === true) notes.push("Account verified with provider");
          if (msResult.exists === false) notes.push("Account not found at provider");
        }

        if (googleResult !== null) {
          providerChecks.google = googleResult;
          if (googleResult === true) notes.push("Account verified with provider");
          if (googleResult === false) notes.push("Account not found at provider");
        }

        if (appleResult !== null) {
          providerChecks.apple = appleResult;
          if (appleResult === true) notes.push("Account verified with provider");
          if (appleResult === false) notes.push("Account not found at provider");
        }

        if (gravatarResult !== null) {
          providerChecks.gravatar = gravatarResult;
          if (gravatarResult === true) notes.push("Public profile found for this email");
        }

        if (githubResult !== null) {
          providerChecks.github = githubResult;
          if (githubResult === true) notes.push("Public activity found for this email");
        }

        if (pgpResult !== null) {
          providerChecks.pgp = pgpResult;
          if (pgpResult === true) notes.push("Public key found for this email");
        }

        if (hibpResult !== null) {
          providerChecks.hibp = hibpResult.breached;
          if (hibpResult.breached) notes.push("Email found in known data breaches (confirms real address)");
        }

        if (domain && isMajorProvider(domain) && (smtp === "error" || smtp === null)
          && googleResult === null && appleResult === null) {
          notes.push("Major email provider — direct mailbox verification blocked by policy");
        }

        if (domainHealth && !domainHealth.hasSPF && !domainHealth.hasDMARC) {
          notes.push("Domain has no email authentication records (SPF/DMARC)");
        }
      }

      // Domain intelligence (website, age, blacklists)
      let domainIntelResult: DomainIntel | undefined;
      let domainIntel: DomainIntelSummary | undefined;
      if (syntaxOk && domain && mx) {
        domainIntelResult = await getIntel(domain, mxHosts);
        domainIntel = {
          websiteAlive: domainIntelResult.websiteAlive,
          isParked: domainIntelResult.isParked,
          domainAgeDays: domainIntelResult.domainAgeDays,
          blacklisted: domainIntelResult.blacklisted,
        };

        if (domainIntelResult.websiteAlive === false) notes.push("Domain website is not reachable");
        if (domainIntelResult.isParked) notes.push("Domain appears to be parked or for sale");
        if (domainIntelResult.domainAgeDays !== null && domainIntelResult.domainAgeDays < 30) {
          notes.push(`Domain registered ${domainIntelResult.domainAgeDays} days ago (very new)`);
        }
        if (domainIntelResult.blacklisted) {
          notes.push(`Mail server blacklisted (${domainIntelResult.blacklistHits.join(", ")})`);
        }
      }

      // Local part pattern analysis
      const pattern = syntaxOk && local ? analyzeLocalPart(local) : null;
      if (pattern) {
        notes.push(...pattern.flags);
      }

      // Bulk anomaly flags
      const anomalyFlags = bulkAnomalies.get(email);
      if (anomalyFlags) {
        notes.push(...anomalyFlags);
      }

      const riskFlags = syntaxOk && domain ? getRiskFlags(local, domain) : [];
      notes.push(...riskFlags);

      let suggestedEmail: string | undefined;
      if (syntaxOk && domain) {
        const typo = detectTypo(domain);
        if (typo) {
          suggestedEmail = `${local}@${typo.correctedDomain}`;
          notes.push(`Did you mean ${typo.correctedDomain}?`);
        }
      }

      const providers: ProviderSignals = {
        microsoftExists: providerChecks.microsoft,
        googleExists: providerChecks.google,
        appleExists: providerChecks.apple,
        hasGravatar: providerChecks.gravatar,
        hasGitHub: providerChecks.github,
        hasPgpKey: providerChecks.pgp,
        hibpBreached: providerChecks.hibp,
        isMajorProvider: domain ? isMajorProvider(domain) : false,
      };

      const intel: IntelSignals = {
        websiteAlive: domainIntelResult?.websiteAlive,
        isParked: domainIntelResult?.isParked,
        domainAgeDays: domainIntelResult?.domainAgeDays,
        blacklisted: domainIntelResult?.blacklisted,
        looksHuman: pattern?.looksHuman,
        patternFlags: pattern?.flags,
      };

      const status = computeStatus(syntaxOk, domain || null, mx, smtp, riskFlags, providers);
      const confidence = computeConfidence(syntaxOk, mx, smtp, riskFlags, implicitMx, domainHealth, providers, intel);

      return { email, domain, mx, smtp, status, confidence, notes, suggestedEmail, providerChecks, domainIntel };
    }),
  );

  recordEmailsUsed(ip, results.length);
  recordGlobalEmails(results.length);

  return { results };

  } finally {
    releaseConcurrency(ip);
  }
});
