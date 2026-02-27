<script setup lang="ts">
import type { VerifyResult, VerifyResponse, VerifyStatus } from "~~/types/verify";
import { parseEmailInput } from "~/utils/parse-input";
import { resultsToCsv, downloadCsv } from "~/utils/csv";

const BATCH_SIZE = 500;

type Tab = "single" | "bulk";
const activeTab = ref<Tab>("single");

// --- Single mode ---
const singleEmail = ref("");
const singleResult = ref<VerifyResult | null>(null);
const singleLoading = ref(false);
const singleError = ref("");
const singleStep = ref("");
let stepTimer: ReturnType<typeof setInterval> | null = null;

const verifySteps = [
  "Checking syntax…",
  "Looking up DNS records…",
  "Querying MX servers…",
  "Probing mailbox via SMTP…",
  "Checking domain health (SPF/DMARC)…",
  "Running provider checks…",
  "Analyzing domain intelligence…",
  "Finalizing confidence score…",
];

function startStepCycle() {
  let idx = 0;
  singleStep.value = verifySteps[0];
  stepTimer = setInterval(() => {
    idx++;
    if (idx < verifySteps.length) {
      singleStep.value = verifySteps[idx];
    }
  }, 1800);
}

function stopStepCycle() {
  if (stepTimer) clearInterval(stepTimer);
  stepTimer = null;
  singleStep.value = "";
}

async function verifySingle() {
  singleError.value = "";
  singleResult.value = null;
  const email = singleEmail.value.trim();
  if (!email) return;
  singleLoading.value = true;
  startStepCycle();
  try {
    const data = await $fetch<VerifyResponse>("/api/verify", {
      method: "POST",
      body: { emails: [email] },
    });
    singleResult.value = data.results[0] ?? null;
  } catch (e: any) {
    singleError.value = e?.data?.statusMessage || e?.message || "Request failed";
  } finally {
    stopStepCycle();
    singleLoading.value = false;
  }
}

// --- Bulk mode ---
const bulkInput = ref("");
const bulkResults = ref<VerifyResult[]>([]);
const bulkLoading = ref(false);
const bulkError = ref("");
const bulkProgress = ref(0);
const bulkTotal = ref(0);

const bulkSummary = computed(() => {
  const counts: Record<VerifyStatus, number> = { Valid: 0, Risky: 0, Invalid: 0, Unknown: 0 };
  for (const r of bulkResults.value) counts[r.status]++;
  return { total: bulkResults.value.length, ...counts };
});

async function verifyBulk() {
  bulkError.value = "";
  bulkResults.value = [];
  bulkProgress.value = 0;
  const emails = parseEmailInput(bulkInput.value);
  if (emails.length === 0) return;
  bulkTotal.value = emails.length;
  bulkLoading.value = true;
  try {
    for (let i = 0; i < emails.length; i += BATCH_SIZE) {
      const batch = emails.slice(i, i + BATCH_SIZE);
      try {
        const data = await $fetch<VerifyResponse>("/api/verify", {
          method: "POST",
          body: { emails: batch },
        });
        bulkResults.value.push(...data.results);
        bulkProgress.value = Math.min(bulkResults.value.length, emails.length);
      } catch (e: any) {
        const status = e?.response?.status || e?.statusCode;
        const msg = e?.data?.statusMessage || e?.message || "Request failed";
        if (status === 429) {
          bulkError.value = msg + (bulkResults.value.length > 0 ? ` (${bulkResults.value.length} emails verified before limit hit)` : "");
          break;
        }
        if (status === 503) {
          bulkError.value = msg;
          break;
        }
        throw e;
      }
    }
  } catch (e: any) {
    bulkError.value = e?.data?.statusMessage || e?.message || "Request failed";
  } finally {
    bulkLoading.value = false;
  }
}

function copyValid() {
  const list = bulkResults.value.filter((r) => r.status === "Valid").map((r) => r.email).join("\n");
  navigator.clipboard.writeText(list);
}

function downloadResults() {
  downloadCsv(resultsToCsv(bulkResults.value), "email-verify-results.csv");
}

function statusDot(status: VerifyStatus) {
  switch (status) {
    case "Valid":   return "bg-valid";
    case "Risky":   return "bg-risky";
    case "Invalid": return "bg-invalid";
    case "Unknown": return "bg-unknown";
  }
}

function statusColor(status: VerifyStatus) {
  switch (status) {
    case "Valid":   return "text-valid";
    case "Risky":   return "text-risky";
    case "Invalid": return "text-invalid";
    case "Unknown": return "text-unknown";
  }
}

function smtpLabel(r: VerifyResult) {
  const providerConfirmed = r.providerChecks?.google === true
    || r.providerChecks?.apple === true
    || r.providerChecks?.microsoft === true;
  const isMajor = r.notes?.some((n) => n.includes("Major email provider"));
  switch (r.smtp) {
    case "accepted":   return "Accepted";
    case "rejected":   return providerConfirmed ? "Verified" : "Rejected";
    case "catch-all":  return "Catch-all";
    case "greylisted": return "Greylisted";
    case "error":      return providerConfirmed ? "Verified" : isMajor ? "Blocked by provider" : "Inconclusive";
    default:           return providerConfirmed ? "Verified" : isMajor ? "Blocked by provider" : "—";
  }
}

function confidenceColor(score: number): string {
  if (score >= 80) return "text-valid";
  if (score >= 50) return "text-risky";
  if (score >= 25) return "text-unknown";
  return "text-invalid";
}

function confidenceBarColor(score: number): string {
  if (score >= 80) return "bg-valid";
  if (score >= 50) return "bg-risky";
  if (score >= 25) return "bg-unknown";
  return "bg-invalid";
}

function domainWarnings(r: VerifyResult): string {
  const parts: string[] = [];
  const di = r.domainIntel;
  if (!di) return "";
  if (di.websiteAlive === false) parts.push("the domain's website is not reachable");
  if (di.isParked) parts.push("the domain appears to be parked or for sale");
  if (di.domainAgeDays != null && di.domainAgeDays < 30) parts.push(`the domain was registered only ${di.domainAgeDays} days ago`);
  if (di.blacklisted) parts.push("the mail server is on a spam blacklist");
  if (parts.length === 0) return "";
  return ` Warning: ${parts.join(", ")}.`;
}

function explain(r: VerifyResult): string {
  const ms = r.providerChecks?.microsoft;
  const grav = r.providerChecks?.gravatar;
  const gh = r.providerChecks?.github;
  const pgp = r.providerChecks?.pgp;
  const goog = r.providerChecks?.google;
  const apple = r.providerChecks?.apple;
  const hibp = r.providerChecks?.hibp;
  const dw = domainWarnings(r);

  if (r.status === "Valid") {
    const providerConfirmed = goog === true || apple === true || ms === true;
    if (providerConfirmed) return `This account exists. We verified it across multiple signals and confirmed this mailbox is active on ${r.domain}. Safe to send.${dw}`;
    if (hibp === true && r.smtp !== "accepted") return `This email is very likely valid. We found multiple signals confirming a real account is associated with this address. The domain ${r.domain} has active mail servers.${dw}`;
    if ((gh === true || pgp === true || grav === true) && r.smtp !== "accepted") return `This email is likely valid. We found public activity linked to this address, confirming someone uses it. The domain ${r.domain} has mail servers configured.${dw}`;
    if (r.smtp !== "accepted" && r.notes?.some((n) => n.includes("Major email provider")))
      return `This email is on ${r.domain}, a major email provider with active mail servers. The address is properly formatted and the domain is trusted. Likely deliverable, though we can't confirm the specific mailbox without sending a real email.${dw}`;
    return `This email looks good. The domain ${r.domain} has mail servers, and the mail server accepted this address. Note: some servers accept all mail during the initial check but bounce later — delivery is very likely but not 100% guaranteed.${dw}`;
  }
  if (r.status === "Invalid") {
    if (!r.domain) return "This doesn't look like a valid email address.";
    if (r.mx === false) return `The domain ${r.domain} has no mail servers configured. Any email sent here will bounce.${dw}`;
    if (goog === false || apple === false || ms === false) return `This account does not exist. We verified against the provider and confirmed there is no mailbox for this address. Your email would bounce.`;
    if (r.smtp === "rejected") return `The domain ${r.domain} has mail servers, but the server said this specific mailbox does not exist. Your email would bounce.${dw}`;
    return `This email address has problems that would prevent delivery.${dw}`;
  }
  if (r.status === "Risky") {
    const reasons: string[] = [];
    if (r.smtp === "catch-all") reasons.push(`the server at ${r.domain} accepts mail for any address — even fake ones — so the mailbox may not actually exist and your email could bounce later`);
    if (r.smtp === "greylisted") reasons.push("the server temporarily deferred our check, which may mean it's suspicious of new senders");
    if (r.notes.includes("Role-based address")) reasons.push(`"${r.email.split("@")[0]}@" is a generic role address (like info@, admin@), which tend to have higher bounce rates and stricter spam filtering`);
    if (r.notes.includes("Disposable domain")) reasons.push(`${r.domain} is a known disposable/temporary email provider`);
    if (r.domainIntel?.isParked) reasons.push("the domain appears to be parked or for sale");
    if (r.domainIntel?.blacklisted) reasons.push("the mail server is on a spam blacklist");
    if (r.notes.some((n) => n.includes("Looks auto-generated"))) reasons.push("the local part looks auto-generated rather than a real person's name");
    if (reasons.length === 0) return "This email has some risk factors. Sending may work but isn't guaranteed.";
    return `This email is risky because ${reasons.join(", and ")}.`;
  }
  // Unknown
  if (r.smtp === "error" && r.mx) {
    let msg = `The domain ${r.domain} has mail servers, but the server blocked our verification attempt.`;
    const hasSocialProof = grav === true || gh === true || pgp === true;
    if (hasSocialProof) msg += ` However, we found public activity linked to this email, suggesting it's in active use.`;
    else msg += ` Many large providers (Gmail, Outlook, Yahoo) do this. We can't confirm whether this mailbox exists without actually sending an email.`;
    if (r.notes.some((n) => n.includes("no email authentication records"))) {
      msg += ` The domain has no SPF or DMARC records, which suggests it may not be actively managed for email.`;
    }
    return msg + dw;
  }
  if (r.mx === null) return `We couldn't look up the mail servers for ${r.domain} — the DNS query failed or timed out. Try again later.`;
  return "We couldn't determine whether this email is deliverable. The verification was inconclusive." + dw;
}

const isLoading = computed(() => singleLoading.value || bulkLoading.value);

const expandedRow = ref<number | null>(null);
function toggleRow(idx: number) {
  expandedRow.value = expandedRow.value === idx ? null : idx;
}

const features = [
  { num: "01", title: "MX Record Lookup", desc: "Resolves the domain's mail servers to confirm email infrastructure exists." },
  { num: "02", title: "Mailbox Verification", desc: "Connects via SMTP to check whether the specific mailbox accepts mail." },
  { num: "03", title: "Catch-all Detection", desc: "Identifies servers that accept any address, so you know when results are uncertain." },
  { num: "04", title: "Disposable Domains", desc: "Flags temporary email providers like Guerrilla Mail and Mailinator." },
  { num: "05", title: "Role Address Flags", desc: "Detects generic prefixes like info@, admin@, and support@ that often bounce." },
  { num: "06", title: "Bulk Processing", desc: "Verify up to 10,000 emails at once with parallel processing and CSV export." },
];

const faqItems = [
  { q: "What checks does this tool perform?", a: "We validate email syntax, resolve the domain's MX records, connect to the mail server via SMTP to verify the mailbox exists, and flag risk factors like disposable domains, catch-all servers, and role-based addresses." },
  { q: "Is my data stored or logged?", a: "No. All verification happens in real time and nothing is persisted. We don't store email addresses, results, or any personally identifiable information." },
  { q: "Why do some emails show as Unknown?", a: "Large providers like Gmail, Outlook, and Yahoo block SMTP verification probes. We can confirm the domain and MX records are valid, but can't verify the specific mailbox without actually sending an email." },
  { q: "What does Catch-all mean?", a: "A catch-all domain accepts mail for any address — even ones that don't exist. This means we can't confirm whether a specific mailbox is real, only that the domain will accept the message." },
  { q: "Can I verify emails in bulk?", a: "Yes. Switch to bulk mode and paste up to 10,000 emails at once. Results include a summary, per-email details, and CSV export." },
  { q: "Is there a rate limit?", a: "There is a soft limit of 30 requests per minute per IP to prevent abuse. Each request can contain up to 10,000 emails." },
];

const openFaq = ref<number | null>(null);
function toggleFaq(idx: number) {
  openFaq.value = openFaq.value === idx ? null : idx;
}
</script>

<template>
  <div class="relative min-h-screen flex-1 flex flex-col bg-surface text-zinc-100">
    <div class="pointer-events-none absolute inset-x-0 top-0 h-[600px] bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(120,119,198,0.1),transparent)]" />

    <div class="relative flex flex-1 flex-col w-full">

      <!-- ─── Nav ─── -->
      <nav class="mx-auto flex max-w-3xl items-center justify-between px-6 py-4 w-full">
        <span class="ttext-base font-semibold text-white flex items-center gap-2">
          <img src="/img/logo.png" alt="Docle" class="w-7 h-7" />
          <span class="text-white">Docle</span>
        </span>

        <a href="https://github.com/treadiehq/docle" target="_blank" rel="noopener" class="transition text-muted hover:text-white " aria-label="GitHub">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
        </a>
      </nav>

      <!-- ─── Hero ─── -->
      <section id="top" class="mx-auto max-w-2xl px-6 pt-28 pb-4 w-full">
        <div class="">
          <h1 class="text-[2.75rem] font-bold leading-[1.15] tracking-tight text-white">
            Verify any
            <span class="text-blue-300">email address</span>
            instantly
          </h1>
          <p class="mt-6 max-w-lg text-base leading-relaxed text-muted">
            Check if you can actually send to an email address without it bouncing or failing. No signup, no data stored.
          </p>
        </div>
      </section>

      <!-- ─── Code-style tool ─── -->
      <section id="verify" class="mx-auto max-w-2xl px-6 pt-12 pb-20 w-full">
        <div class="">
          <div class="overflow-hidden rounded-xl border border-border bg-elevated">

            <!-- Tabs -->
            <div class="flex items-center gap-1 border-b border-border px-1 pt-1">
              <button
                :class="[
                  'px-4 py-2 text-sm transition',
                  activeTab === 'single'
                    ? 'text-white'
                    : 'text-dim hover:text-muted',
                ]"
                @click="activeTab = 'single'"
              >
                single
              </button>
              <button
                :class="[
                  'px-4 py-2 text-sm transition',
                  activeTab === 'bulk'
                    ? 'text-white'
                    : 'text-dim hover:text-muted',
                ]"
                @click="activeTab = 'bulk'"
              >
                bulk
              </button>

              <div class="ml-auto flex items-center gap-2 pr-2">
                <button
                  v-if="activeTab === 'bulk' && bulkResults.length > 0"
                  class="rounded px-2 py-1 text-xs text-dim transition hover:text-muted"
                  @click="copyValid"
                >
                  copy valid
                </button>
                <button
                  v-if="activeTab === 'bulk' && bulkResults.length > 0"
                  class="rounded px-2 py-1 text-xs text-dim transition hover:text-muted"
                  @click="downloadResults"
                >
                  csv ↓
                </button>
              </div>
            </div>

            <!-- Single mode -->
            <div v-if="activeTab === 'single'">
              <div class="p-4">
                <form class="flex items-center gap-3 font-mono" @submit.prevent="verifySingle">
                  <span class="select-none text-sm text-dim">$</span>
                  <span class="text-sm text-zinc-400">verify</span>
                  <input
                    v-model="singleEmail"
                    type="text"
                    placeholder="user@example.com"
                    autofocus
                    class="min-w-0 flex-1 border-none bg-transparent text-sm text-blue-300 focus:ring-0 outline-none focus:border-none focus:outline-none placeholder:text-zinc-600 focus:outline-none"
                  />
                  <button
                    :disabled="singleLoading || !singleEmail.trim()"
                    class="shrink-0 text-dim transition hover:text-muted disabled:opacity-30"
                    type="submit"
                    :title="singleLoading ? 'Checking…' : 'Verify'"
                  >
                    <svg v-if="!singleLoading" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                  </button>
                </form>

                <p v-if="singleError" class="mt-3 font-mono text-xs text-invalid">{{ singleError }}</p>

                <p v-if="singleLoading && singleStep" class="mt-3 font-mono text-xs text-dim animate-pulse">
                  {{ singleStep }}
                </p>
              </div>

              <!-- Result output -->
              <div v-if="singleResult">
                <div class="border-t border-border" />
                <div class="space-y-4 p-4">
                  <div class="flex items-center gap-3">
                    <span :class="['inline-block h-2 w-2 rounded-full', statusDot(singleResult.status)]" />
                    <span class="break-all font-mono text-sm text-white">{{ singleResult.email }}</span>
                    <span :class="['ml-auto text-xs font-medium', statusColor(singleResult.status)]">
                      {{ singleResult.status }}
                    </span>
                  </div>

                  <div class="grid grid-cols-4 gap-y-3 text-xs">
                    <div>
                      <div class="text-dim">Domain</div>
                      <div class="mt-1 font-mono text-zinc-300">{{ singleResult.domain || "—" }}</div>
                    </div>
                    <div>
                      <div class="text-dim">MX records</div>
                      <div class="mt-1 font-mono text-zinc-300">
                        {{ singleResult.mx === null ? "Unknown" : singleResult.mx ? "Yes" : "No" }}
                      </div>
                    </div>
                    <div>
                      <div class="text-dim">Mailbox</div>
                      <div class="mt-1 font-mono text-zinc-300">{{ smtpLabel(singleResult) }}</div>
                    </div>
                    <div>
                      <div class="text-dim">Confidence</div>
                      <div class="mt-1 flex items-center gap-2">
                        <div class="h-1 w-14 overflow-hidden rounded-full bg-zinc-800">
                          <div
                            :class="['h-full rounded-full transition-all', confidenceBarColor(singleResult.confidence)]"
                            :style="{ width: `${singleResult.confidence}%` }"
                          />
                        </div>
                        <span :class="['font-mono font-medium', confidenceColor(singleResult.confidence)]">
                          {{ singleResult.confidence }}%
                        </span>
                      </div>
                    </div>
                  </div>

                  <p class="text-xs leading-relaxed text-muted">
                    {{ explain(singleResult) }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Bulk mode -->
            <div v-if="activeTab === 'bulk'">
              <div class="p-4">
                <div class="flex items-start gap-3 font-mono">
                  <span class="select-none text-sm text-dim">$</span>
                  <textarea
                    v-model="bulkInput"
                    rows="6"
                    placeholder="paste your email addresses here. Separate each address with a comma, space, or newline."
                    class="flex-1 resize-none border-none bg-transparent text-sm text-blue-300 placeholder:text-zinc-600 focus:outline-none"
                  />
                </div>
              </div>

              <div class="border-t border-border" />

              <div class="flex items-center justify-end gap-3 p-4">
                <span v-if="bulkLoading" class="font-mono text-xs text-dim animate-pulse">
                  verifying {{ bulkProgress }}/{{ bulkTotal }} emails…
                </span>
                <button
                  :disabled="bulkLoading || !bulkInput.trim()"
                  class="inline-flex items-center gap-2 rounded-full bg-white px-4 py-1.5 text-xs font-medium text-zinc-900 transition hover:bg-zinc-200 disabled:opacity-30"
                  @click="verifyBulk"
                >
                  {{ bulkLoading ? "verifying…" : "Verify" }}
                  <span class="text-[10px]">→</span>
                </button>
              </div>

              <p v-if="bulkError" class="px-4 pb-3 font-mono text-xs text-invalid">{{ bulkError }}</p>

              <div v-if="bulkResults.length > 0">
                <div class="border-t border-border" />
                <div class="flex flex-wrap items-center gap-2 px-4 py-3 text-[11px]">
                  <span class="text-muted">{{ bulkSummary.total }} total</span>
                  <span class="text-dim">·</span>
                  <span class="text-valid">{{ bulkSummary.Valid }} valid</span>
                  <span class="text-dim">·</span>
                  <span class="text-risky">{{ bulkSummary.Risky }} risky</span>
                  <span class="text-dim">·</span>
                  <span class="text-invalid">{{ bulkSummary.Invalid }} invalid</span>
                  <span class="text-dim">·</span>
                  <span class="text-unknown">{{ bulkSummary.Unknown }} unknown</span>
                </div>

                <div class="border-t border-border" />
                <div
                  v-for="(r, idx) in bulkResults"
                  :key="r.email"
                  :class="idx < bulkResults.length - 1 ? 'border-b border-border' : ''"
                >
                  <div
                    class="flex cursor-pointer items-center gap-3 px-4 py-2 font-mono text-xs transition hover:bg-white/[0.02]"
                    @click="toggleRow(idx)"
                  >
                    <span class="w-5 shrink-0 text-right text-dim">{{ idx + 1 }}</span>
                    <span :class="['inline-block h-1.5 w-1.5 shrink-0 rounded-full', statusDot(r.status)]" />
                    <span class="min-w-0 flex-1 break-all text-zinc-300">{{ r.email }}</span>
                    <span :class="['shrink-0 tabular-nums text-[11px]', confidenceColor(r.confidence)]">{{ r.confidence }}%</span>
                    <span class="shrink-0 text-dim">{{ smtpLabel(r) }}</span>
                    <span :class="['shrink-0 font-medium', statusColor(r.status)]">{{ r.status }}</span>
                  </div>
                  <div v-if="expandedRow === idx" class="pb-3 pl-13 pr-4 text-[11px] leading-relaxed text-muted">
                    {{ explain(r) }}
                    <span v-if="r.suggestedEmail" class="ml-1 text-amber-400">
                      Did you mean <span class="font-medium text-white">{{ r.suggestedEmail }}</span>?
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p class="mt-3 text-xs text-dim">
            No data stored. All checks happen in real time.
          </p>
        </div>
      </section>
      <!-- ─── Footer ─── -->
      <footer class="mx-auto mt-auto w-full max-w-3xl px-6 py-6">
        <div class="flex items-center justify-between">
          <span class="text-xs text-dim">&copy; {{new Date().getFullYear()}} Treadie, Inc.</span>
          <!-- <div class="flex items-center gap-5 text-xs text-dim">
            <a href="#" class="transition hover:text-muted">Terms</a>
            <a href="#" class="transition hover:text-muted">Privacy</a>
            <a href="#" class="transition hover:text-muted">Security</a>
            <a href="#" class="transition hover:text-muted">API Docs</a>
          </div> -->
          <div class="flex items-center gap-4 text-dim">
            <a href="https://github.com/treadiehq/docle" target="_blank" rel="noopener" class="transition hover:text-muted"">
              <svg viewBox="0 0 14 14" class="w-4 h-4" fill="currentColor"><path d="M7 .175c-3.872 0-7 3.128-7 7 0 3.084 2.013 5.71 4.79 6.65.35.066.482-.153.482-.328v-1.181c-1.947.415-2.363-.941-2.363-.941-.328-.81-.787-1.028-.787-1.028-.634-.438.044-.416.044-.416.7.044 1.071.722 1.071.722.635 1.072 1.641.766 2.035.59.066-.459.24-.765.437-.94-1.553-.175-3.193-.787-3.193-3.456 0-.766.262-1.378.721-1.881-.065-.175-.306-.897.066-1.86 0 0 .59-.197 1.925.722a6.754 6.754 0 0 1 1.75-.24c.59 0 1.203.087 1.75.24 1.335-.897 1.925-.722 1.925-.722.372.963.131 1.685.066 1.86.46.48.722 1.115.722 1.88 0 2.691-1.641 3.282-3.194 3.457.24.219.481.634.481 1.29v1.926c0 .197.131.415.481.328C11.988 12.884 14 10.259 14 7.175c0-3.872-3.128-7-7-7z" fill-rule="evenodd"/></svg>
            </a>
            <a href="https://discord.gg/KqdBcqRk5E" target="_blank" rel="noopener" class="transition hover:text-muted"">
              <svg viewBox="0 0 20 20" class="w-[20px] h-[20px]" fill="currentColor"><path d="M16.238 4.515a14.842 14.842 0 0 0-3.664-1.136.055.055 0 0 0-.059.027 10.35 10.35 0 0 0-.456.938 13.702 13.702 0 0 0-4.115 0 9.479 9.479 0 0 0-.464-.938.058.058 0 0 0-.058-.027c-1.266.218-2.497.6-3.664 1.136a.052.052 0 0 0-.024.02C1.4 8.023.76 11.424 1.074 14.782a.062.062 0 0 0 .024.042 14.923 14.923 0 0 0 4.494 2.272.058.058 0 0 0 .064-.02c.346-.473.654-.972.92-1.496a.057.057 0 0 0-.032-.08 9.83 9.83 0 0 1-1.404-.669.058.058 0 0 1-.006-.096c.094-.07.189-.144.279-.218a.056.056 0 0 1 .058-.008c2.946 1.345 6.135 1.345 9.046 0a.056.056 0 0 1 .059.007c.09.074.184.149.28.22a.058.058 0 0 1-.005.095 9.224 9.224 0 0 1-1.405.669.058.058 0 0 0-.031.08c.27.523.58 1.022.92 1.495a.056.056 0 0 0 .062.021 14.878 14.878 0 0 0 4.502-2.272.056.056 0 0 0 .024-.041c.375-3.883-.63-7.256-2.662-10.246a.046.046 0 0 0-.023-.021Zm-9.223 8.221c-.887 0-1.618-.814-1.618-1.814s.717-1.814 1.618-1.814c.908 0 1.632.821 1.618 1.814 0 1-.717 1.814-1.618 1.814Zm5.981 0c-.887 0-1.618-.814-1.618-1.814s.717-1.814 1.618-1.814c.908 0 1.632.821 1.618 1.814 0 1-.71 1.814-1.618 1.814Z"/></svg>
            </a>
            <a href="https://twitter.com/treadieinc" target="_blank" rel="noopener" aria-label="X formerly known as Twitter" class="transition hover:text-muted"">
              <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 22 20"><path d="M16.99 0H20.298L13.071 8.26L21.573 19.5H14.916L9.702 12.683L3.736 19.5H0.426L8.156 10.665L0 0H6.826L11.539 6.231L16.99 0ZM15.829 17.52H17.662L5.83 1.876H3.863L15.829 17.52Z"/></svg>
            </a>
            <!-- <a href="#" class="transition hover:text-muted" aria-label="GitHub">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            </a>
            <a href="#" class="transition hover:text-muted" aria-label="Discord">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
            </a>
            <a href="#" class="transition hover:text-muted" aria-label="X">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a> -->
          </div>
        </div>
      </footer>

    </div>
  </div>
</template>
