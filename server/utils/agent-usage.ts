interface AgentBucket {
  emailsVerified: number;
  requests: number;
  resetsAt: number;
}

const agentBuckets = new Map<string, AgentBucket>();

function nextMidnightUTC(): number {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).getTime();
}

function getBucket(agentUid: string): AgentBucket {
  const now = Date.now();
  let bucket = agentBuckets.get(agentUid);
  if (!bucket || bucket.resetsAt <= now) {
    bucket = { emailsVerified: 0, requests: 0, resetsAt: nextMidnightUTC() };
    agentBuckets.set(agentUid, bucket);
  }
  return bucket;
}

export function recordAgentUsage(agentUid: string, emailCount: number): void {
  const bucket = getBucket(agentUid);
  bucket.emailsVerified += emailCount;
  bucket.requests++;
}

export function getAgentUsage(agentUid: string): { emailsVerified: number; requests: number; resetsAt: number } {
  return { ...getBucket(agentUid) };
}

setInterval(() => {
  const now = Date.now();
  for (const [uid, bucket] of agentBuckets) {
    if (bucket.resetsAt <= now) agentBuckets.delete(uid);
  }
}, 60_000).unref();
