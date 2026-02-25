import { resolveTxt } from "node:dns/promises";

export interface DomainHealth {
  hasSPF: boolean;
  hasDMARC: boolean;
}

export async function checkDomainHealth(
  domain: string,
  timeoutMs: number,
): Promise<DomainHealth> {
  const withTimeout = <T>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DNS timeout")), timeoutMs),
      ),
    ]);

  const [spfResult, dmarcResult] = await Promise.allSettled([
    withTimeout(resolveTxt(domain)),
    withTimeout(resolveTxt(`_dmarc.${domain}`)),
  ]);

  let hasSPF = false;
  if (spfResult.status === "fulfilled") {
    hasSPF = spfResult.value.some((chunks) =>
      chunks.join("").trimStart().startsWith("v=spf1"),
    );
  }

  let hasDMARC = false;
  if (dmarcResult.status === "fulfilled") {
    hasDMARC = dmarcResult.value.some((chunks) =>
      chunks.join("").trimStart().startsWith("v=DMARC1"),
    );
  }

  return { hasSPF, hasDMARC };
}
