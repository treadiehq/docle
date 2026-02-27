import { reportBounce, checkBounceReportRate } from "~~/server/utils/bounce-db";
import { isValidSyntax } from "~~/server/utils/email";

export default defineEventHandler(async (event) => {
  const ip =
    getRequestHeader(event, "x-forwarded-for")?.split(",")[0]?.trim() ||
    getRequestHeader(event, "x-real-ip") ||
    "unknown";

  if (!checkBounceReportRate(ip)) {
    throw createError({ statusCode: 429, statusMessage: "Too many bounce reports. Try again later." });
  }

  const body = await readBody<{ email: string }>(event);
  if (!body?.email || typeof body.email !== "string") {
    throw createError({ statusCode: 400, statusMessage: "email is required" });
  }

  const email = body.email.trim().toLowerCase();
  if (!isValidSyntax(email)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid email address" });
  }

  reportBounce(email, ip);

  return { ok: true };
});
