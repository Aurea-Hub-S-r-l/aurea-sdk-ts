/**
 * Names and phrases no reader of docs.aureahub.com may meet (UX finish, owner's rules 01/11/2026 and D13):
 *   - a partner's or provider's name — the docs say "the bank ramp", "the card program", "the payment provider";
 *   - "compliant", "MiCA-ready", "digital banking", a yield figure, Aurea holding a customer's funds;
 *   - a support address other than help@aureahub.com;
 *   - internal jargon: release names (C24), "Product A/B", an SDK that is not published.
 *
 * Scanned: everything a reader can reach — app.js whole (it ships whole: strings, comments, hidden pages),
 * index.html, and any extra text the build generates (the Postman collection).
 *
 * ALLOWED holds what a reader must be able to match verbatim although a forbidden word sits inside it, each with its
 * reason; the list only shrinks. Since UX finish devx2 the API answers a neutral twin of every partner-named field and
 * value (bankRampStatus, eurAccountIban, typeNeutral…), names the Lending and card routes neutrally (/v1/lending,
 * /v1/cards) and builds the cards' sign-in message itself: the docs name only those, and no contract name is left.
 */
import fs from "node:fs";
import path from "node:path";

export const FORBIDDEN = [
  { why: "a partner's or provider's name", pattern: /noah|monerium|jenzy|gnosis\s?pay|gnosispay|\bli\.?fi\b|stripe|mollie|\bdfns\b|currencycloud|\bCircle\b|treezor|\bveem\b|transak|\bondo\b|xstocks?|sumsub|web3auth|fireblocks|\bazure\b|monavate|gelato|\baave\b|\bbper\b|firebase|\bEntra\b|\bMaple\b/gi },
  { why: "a regulatory claim", pattern: /\bcompliant\b|\bMiCA\b|MiCA[- ]ready|digital[- ]banking/g },
  { why: "a yield figure", pattern: /\b\d+(?:[.,]\d+)?\s?%\s?(?:APY|APR|yield|interest|a year|per year|per annum|annual)/gi },
  { why: "Aurea holding customers' funds", pattern: /\bAurea\s+(?:holds|keeps|safeguards|custodies)\s+(?:your|the|their|customers'?|users'?)\s+(?:funds|money|balances?|deposits?)/gi },
  // UX finish devx2 (coordinator, 01/11/2026): the platform holds a custodial wallet's key for the tenant.
  { why: "Aurea holding keys (say: the platform holds the key for your tenant)", pattern: /\bAurea\s+holds\b|\bkeys?\s+Aurea\s+holds?\b|\b[Hh]eld by Aurea\b/g },
  { why: "a support address other than help@aureahub.com", pattern: /\b(?!help@)[a-z0-9._%+-]+@aureahub\.com\b/gi },
  { why: "internal jargon", pattern: /\bProduct [AB]\b|\bfrom C\d{2}\b|\b(?:the )?official SDKs?\b/g },
];

/** Exact texts allowed where a forbidden word sits inside them, with why. */
export const ALLOWED = [
  // Inline SVG of the icon set (lower-case `circle` elements are not the word).
  { text: "<circle ", why: "an SVG element" },
];

/** The findings in one text: "file:line why: «match»". */
export function findingsIn(text, file) {
  let scrubbed = text;
  for (const { text: allowed } of ALLOWED) scrubbed = scrubbed.split(allowed).join(" ".repeat(allowed.length));
  const findings = [];
  for (const { why, pattern } of FORBIDDEN) {
    for (const match of scrubbed.matchAll(pattern)) {
      const line = scrubbed.slice(0, match.index).split("\n").length;
      findings.push(`${file}:${line} ${why}: «${match[0]}»`);
    }
  }
  return findings;
}

/** The findings in the files a reader can reach, under `root`. */
export function forbiddenFindings(root, files = ["app.js", "index.html"]) {
  return files.flatMap((file) => findingsIn(fs.readFileSync(path.join(root, file), "utf8"), file));
}
