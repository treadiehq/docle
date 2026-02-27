import vestauth from "vestauth";

export default defineEventHandler(async (event) => {
  const signature = getRequestHeader(event, "signature");
  const signatureInput = getRequestHeader(event, "signature-input");
  const signatureAgent = getRequestHeader(event, "signature-agent");

  if (!signature || !signatureInput || !signatureAgent) return;

  const proto = getRequestHeader(event, "x-forwarded-proto") || "https";
  const host = getRequestHeader(event, "host") || "";
  const url = `${proto}://${host}${event.path}`;

  try {
    const agent = await vestauth.tool.verify(event.method, url, getHeaders(event));
    event.context.agent = agent;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "signature verification failed";
    throw createError({ statusCode: 401, statusMessage: `Agent auth failed: ${message}` });
  }
});
