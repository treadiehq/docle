import type { VerifyResult } from "~~/types/verify";

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function resultsToCsv(results: VerifyResult[]): string {
  const header = "Email,Domain,MX,Mailbox,Status,Confidence,Notes";
  const rows = results.map((r) =>
    [
      escapeCsv(r.email),
      escapeCsv(r.domain),
      r.mx === null ? "unknown" : r.mx ? "yes" : "no",
      r.smtp ?? "skipped",
      escapeCsv(r.status),
      String(r.confidence ?? ""),
      escapeCsv(r.notes.join("; ")),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}

export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
