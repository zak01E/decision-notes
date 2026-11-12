// Masking of sensitive data before notes leave the device.
// Pure functions, no Firebase here, so they can be tested with `node --test`.
//
// Two layers:
//  1. Rules (always): e-mails, phone numbers, URLs, IBANs, card-like numbers, money amounts.
//  2. Names found by the on-device model (people, companies, projects), passed in as `entities`.
// Every value is replaced by a placeholder such as [PERSON_1]. The table that maps
// placeholders back to real values never leaves the browser.

const RULES = [
  // Order matters: longer, more specific patterns first.
  { kind: "EMAIL", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "URL", re: /\bhttps?:\/\/[^\s)>\]]+/g },
  { kind: "IBAN", re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g },
  { kind: "CARD", re: /\b(?:\d[ -]?){13,16}\b/g },
  {
    kind: "AMOUNT",
    re: /(?:[$€£]\s?\d[\d\s.,]*\d(?:\s?(?:k|K|m|M|bn|million|billion)\b)?)|(?:[$€£]\s?\d)|(?:\b\d[\d\s.,]*\s?(?:k|K|m|M)?\s?(?:€|EUR|USD|GBP|dollars|euros)(?=\W|$))/g,
  },
  // International (+33 6 12 34 56 78), national (06 12 34 56 78) and US ((555) 123-4567) formats.
  { kind: "PHONE", re: /(?:\+\d{1,3}[\s.-]?|\b0)\d{1,4}(?:[\s.-]?\d{1,4}){2,6}\b|\(\d{3}\)\s?\d{3}-\d{4}\b/g },
];

const ENTITY_KINDS = { people: "PERSON", organizations: "ORG", projects: "PROJECT", other: "SECRET" };

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Phone rule is greedy: only keep matches with at least 8 digits and no date look. */
function keepMatch(kind, value) {
  if (kind === "PHONE") {
    const digits = value.replace(/\D/g, "");
    if (digits.length < 8) return false;
    if (/^\d{4}[-./]\d{2}[-./]\d{2}$/.test(value.trim())) return false;
  }
  if (kind === "CARD" && value.replace(/\D/g, "").length < 13) return false;
  return value.trim().length > 0;
}

/** Creates an empty mapping table. */
export function newVault() {
  return { byValue: new Map(), byToken: new Map(), counters: {} };
}

function tokenFor(vault, kind, value) {
  const key = value.trim();
  const known = vault.byValue.get(key.toLowerCase());
  if (known) return known;
  vault.counters[kind] = (vault.counters[kind] || 0) + 1;
  const token = `[${kind}_${vault.counters[kind]}]`;
  vault.byValue.set(key.toLowerCase(), token);
  vault.byToken.set(token, key);
  return token;
}

/**
 * Masks `text`. `entities` is { people: [], organizations: [], projects: [], other: [] }
 * (any key may be missing). Returns { text, vault } where vault is reused if given.
 */
export function redact(text, entities = {}, vault = newVault()) {
  let out = text;

  // Names first (longest first, so "Amina Diallo" wins over "Amina").
  const names = [];
  for (const [group, kind] of Object.entries(ENTITY_KINDS)) {
    for (const raw of entities[group] || []) {
      const name = String(raw || "").trim();
      if (name.length >= 2) names.push({ kind, name });
    }
  }
  names.sort((a, b) => b.name.length - a.name.length);
  for (const { kind, name } of names) {
    const re = new RegExp(`(?<![\\w\\[])${escapeRe(name)}(?![\\w\\]])`, "gi");
    out = out.replace(re, (m) => tokenFor(vault, kind, m));
  }

  for (const { kind, re } of RULES) {
    out = out.replace(re, (m) => (keepMatch(kind, m) ? tokenFor(vault, kind, m) : m));
  }
  return { text: out, vault };
}

/** Puts the real values back into any string, array or object returned by the model. */
export function restore(value, vault) {
  if (typeof value === "string") {
    return value.replace(/\[[A-Z]+_\d+\]/g, (t) => vault.byToken.get(t) ?? t);
  }
  if (Array.isArray(value)) return value.map((v) => restore(v, vault));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v, vault)]));
  }
  return value;
}

/** Rows for the "what stayed on this device" table. */
export function vaultRows(vault) {
  return [...vault.byToken.entries()].map(([token, value]) => ({ token, value }));
}

/** Splits long notes on blank lines / line breaks into chunks of at most `maxWords` words. */
export function splitNotes(text, maxWords) {
  const parts = text.split(/\n(?=\s*\n)|\n(?=[-*•#])/);
  const chunks = [];
  let current = [];
  let count = 0;
  for (const part of parts) {
    const words = part.split(/\s+/).filter(Boolean).length;
    if (count + words > maxWords && current.length) {
      chunks.push(current.join("\n"));
      current = [];
      count = 0;
    }
    current.push(part);
    count += words;
  }
  if (current.length) chunks.push(current.join("\n"));
  return chunks;
}

export function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}
