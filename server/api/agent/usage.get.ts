import { getAgentUsage } from "~~/server/utils/agent-usage";

export default defineEventHandler((event) => {
  const agent = event.context.agent;
  if (!agent?.uid) {
    throw createError({ statusCode: 401, statusMessage: "Vestauth signature required" });
  }

  const config = useRuntimeConfig();
  const usage = getAgentUsage(agent.uid);
  const dailyCap = config.rateLimitAgentDailyEmailCap as number;

  return {
    agent: { uid: agent.uid },
    usage: {
      emailsVerified: usage.emailsVerified,
      requests: usage.requests,
      dailyLimit: dailyCap,
      remaining: Math.max(0, dailyCap - usage.emailsVerified),
      resetsAt: new Date(usage.resetsAt).toISOString(),
    },
  };
});
