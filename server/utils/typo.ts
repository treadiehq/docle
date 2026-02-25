const TYPO_MAP: Record<string, string> = {
  // Gmail
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmal.com": "gmail.com",
  "gmaill.com": "gmail.com",
  "gmil.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmali.com": "gmail.com",
  "gnail.com": "gmail.com",
  "gmail.co": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.om": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cim": "gmail.com",
  "gmaul.com": "gmail.com",
  "gmael.com": "gmail.com",
  "gemail.com": "gmail.com",

  // Yahoo
  "yaho.com": "yahoo.com",
  "yahooo.com": "yahoo.com",
  "yhoo.com": "yahoo.com",
  "yhaoo.com": "yahoo.com",
  "yahoo.co": "yahoo.com",
  "yahoo.cm": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "yaoo.com": "yahoo.com",

  // Outlook
  "outlok.com": "outlook.com",
  "outllok.com": "outlook.com",
  "outloook.com": "outlook.com",
  "outlool.com": "outlook.com",
  "outlook.co": "outlook.com",
  "outlook.cm": "outlook.com",
  "outlook.con": "outlook.com",
  "outook.com": "outlook.com",
  "outtlook.com": "outlook.com",

  // Hotmail
  "hotmal.com": "hotmail.com",
  "hotmial.com": "hotmail.com",
  "hotmaill.com": "hotmail.com",
  "hotmil.com": "hotmail.com",
  "hotmail.co": "hotmail.com",
  "hotmail.cm": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "homail.com": "hotmail.com",
  "htomail.com": "hotmail.com",
  "hotamil.com": "hotmail.com",

  // iCloud
  "iclould.com": "icloud.com",
  "icloud.co": "icloud.com",
  "icloud.cm": "icloud.com",
  "icloud.con": "icloud.com",
  "icolud.com": "icloud.com",
  "icoud.com": "icloud.com",

  // AOL
  "aol.co": "aol.com",
  "aol.cm": "aol.com",
  "aol.con": "aol.com",
  "aool.com": "aol.com",

  // ProtonMail
  "protonmal.com": "protonmail.com",
  "protonmail.co": "protonmail.com",
  "protonmail.con": "protonmail.com",
  "protonmial.com": "protonmail.com",

  // Live
  "live.co": "live.com",
  "live.cm": "live.com",
  "live.con": "live.com",
  "lve.com": "live.com",
};

export function detectTypo(
  domain: string,
): { correctedDomain: string } | null {
  const corrected = TYPO_MAP[domain];
  if (!corrected) return null;
  return { correctedDomain: corrected };
}
