import { Socket } from "node:net";
import { connect as tlsConnect, TLSSocket } from "node:tls";

export type SmtpVerdict = "accepted" | "rejected" | "catch-all" | "greylisted" | "error";

export interface SmtpResult {
  verdict: SmtpVerdict;
  code: number | null;
  banner: string;
}

const USER_UNKNOWN_PATTERNS = [
  "5.1.1",
  "user unknown",
  "does not exist",
  "no such user",
  "mailbox not found",
  "recipient rejected",
  "invalid recipient",
  "unknown user",
  "user not found",
  "account does not exist",
  "no mailbox",
  "undeliverable",
  "addressee unknown",
];

function isUserUnknownResponse(line: string): boolean {
  const lower = line.toLowerCase();
  return USER_UNKNOWN_PATTERNS.some((p) => lower.includes(p));
}

type Phase =
  | "banner"
  | "ehlo"
  | "starttls"
  | "ehlo2"
  | "mail"
  | "rcpt-real"
  | "rcpt-fake"
  | "quit"
  | "done";

function smtpSession(
  host: string,
  port: number,
  email: string,
  domain: string,
  timeoutMs: number,
): Promise<SmtpResult> {
  return new Promise((resolve) => {
    let sock: Socket | TLSSocket = new Socket();
    let phase: Phase = "banner";
    let buf = "";
    let bannerText = "";
    let realCode: number | null = null;
    let realLine = "";
    let fakeCode: number | null = null;
    let serverSupportsStarttls = false;
    let ehloLines: string[] = [];

    // Use a highly random fake address to detect catch-all servers
    const fakeLocal = `xvrf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}-nonexist`;

    const finish = (verdict: SmtpVerdict, code: number | null = null) => {
      if (phase === "done") return;
      phase = "done";
      clearTimeout(timer);
      sock.destroy();
      resolve({ verdict, code, banner: bannerText });
    };

    const timer = setTimeout(() => finish("error"), timeoutMs);
    sock.setTimeout(timeoutMs);

    function handleLine(line: string) {
      const code = parseInt(line.slice(0, 3), 10);
      if (isNaN(code)) return;
      const isMultiline = line.length > 3 && line[3] === "-";

      if (isMultiline) {
        if (phase === "ehlo" || phase === "ehlo2") {
          ehloLines.push(line);
          if (line.toUpperCase().includes("STARTTLS")) {
            serverSupportsStarttls = true;
          }
        }
        return;
      }

      // Final line of response
      if (phase === "ehlo" || phase === "ehlo2") {
        ehloLines.push(line);
        if (line.toUpperCase().includes("STARTTLS")) {
          serverSupportsStarttls = true;
        }
      }

      switch (phase) {
        case "banner":
          bannerText = line.slice(4);
          if (code !== 220) { finish("error", code); return; }
          phase = "ehlo";
          ehloLines = [];
          sock.write("EHLO verify.local\r\n");
          break;

        case "ehlo":
          if (code !== 250) { finish("error", code); return; }
          if (serverSupportsStarttls) {
            phase = "starttls";
            sock.write("STARTTLS\r\n");
          } else {
            phase = "mail";
            sock.write("MAIL FROM:<noreply@verify.local>\r\n");
          }
          break;

        case "starttls":
          if (code !== 220) {
            phase = "mail";
            sock.write("MAIL FROM:<noreply@verify.local>\r\n");
            return;
          }
          upgradeToTls();
          break;

        case "ehlo2":
          if (code !== 250) { finish("error", code); return; }
          phase = "mail";
          sock.write("MAIL FROM:<noreply@verify.local>\r\n");
          break;

        case "mail":
          if (code < 200 || code >= 300) { finish("error", code); return; }
          phase = "rcpt-real";
          sock.write(`RCPT TO:<${email}>\r\n`);
          break;

        case "rcpt-real":
          realCode = code;
          realLine = line;
          phase = "rcpt-fake";
          sock.write(`RCPT TO:<${fakeLocal}@${domain}>\r\n`);
          break;

        case "rcpt-fake":
          fakeCode = code;
          phase = "quit";
          sock.write("QUIT\r\n");
          interpretAndFinish();
          break;

        case "quit":
          break;
      }
    }

    function upgradeToTls() {
      const plainSock = sock as Socket;
      const tlsSock = tlsConnect({
        socket: plainSock,
        host,
        rejectUnauthorized: false,
      });

      tlsSock.setTimeout(timeoutMs);
      tlsSock.on("timeout", () => finish("error"));
      tlsSock.on("error", () => finish("error"));
      tlsSock.on("close", () => {
        if (phase !== "done") finish("error");
      });

      tlsSock.on("secureConnect", () => {
        phase = "ehlo2";
        ehloLines = [];
        serverSupportsStarttls = false;
        buf = "";
        tlsSock.write("EHLO verify.local\r\n");
      });

      tlsSock.on("data", onData);
      sock = tlsSock;
    }

    function onData(chunk: Buffer) {
      buf += chunk.toString();
      const lines = buf.split("\r\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (line.length >= 3) handleLine(line);
      }
    }

    sock.on("timeout", () => finish("error"));
    sock.on("error", () => finish("error"));
    sock.on("close", () => {
      if (phase !== "done") finish("error");
    });
    sock.on("data", onData);

    function interpretAndFinish() {
      if (realCode === null || fakeCode === null) {
        finish("error");
        return;
      }

      const realOk = realCode >= 200 && realCode < 300;
      const realTmp = realCode >= 400 && realCode < 500;
      const realBad = realCode >= 500;
      const fakeOk = fakeCode >= 200 && fakeCode < 300;

      if (realTmp) {
        finish("greylisted", realCode);
        return;
      }
      if (realOk && fakeOk) {
        finish("catch-all", realCode);
        return;
      }
      if (realOk && !fakeOk) {
        finish("accepted", realCode);
        return;
      }
      if (realBad) {
        if (isUserUnknownResponse(realLine)) {
          finish("rejected", realCode);
        } else {
          finish("error", realCode);
        }
        return;
      }
      finish("error", realCode);
    }

    sock.connect(port, host);
  });
}

const GREYLIST_RETRY_DELAY_MS = 5_000;

export async function verifySmtp(
  email: string,
  domain: string,
  mxHosts: string[],
  timeoutMs: number,
): Promise<SmtpResult> {
  for (const host of mxHosts.slice(0, 2)) {
    try {
      const result = await smtpSession(host, 25, email, domain, timeoutMs);
      if (result.verdict === "greylisted") {
        await new Promise((r) => setTimeout(r, GREYLIST_RETRY_DELAY_MS));
        const retry = await smtpSession(host, 25, email, domain, timeoutMs);
        if (retry.verdict !== "error" && retry.verdict !== "greylisted") return retry;
        return result;
      }
      if (result.verdict !== "error") return result;
    } catch {
      continue;
    }
  }
  return { verdict: "error", code: null, banner: "" };
}
