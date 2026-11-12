// Export of extracted results: Markdown (for a ticket, an e-mail, a wiki) and .ics (calendar).
// Pure functions, tested in test/export.test.js.

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Turns a deadline written in notes ("Friday", "before 30 Nov", "2026-12-04", "tomorrow")
 * into a date, relative to `today`. Returns null when it can't tell.
 */
export function parseDue(text, today = new Date()) {
  if (!text) return null;
  const t = text.toLowerCase();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3]);

  if (/\btomorrow\b/.test(t)) return new Date(base.getTime() + 864e5);
  if (/\btoday\b|\beod\b|end of day/.test(t)) return base;
  if (/next week/.test(t)) return new Date(base.getTime() + 7 * 864e5);

  const dayMonth = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?/);
  const monthDay = t.match(/\b([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s+(\d{4}))?/);
  for (const [m, dayIdx, monIdx, yearIdx] of [
    [dayMonth, 1, 2, 3],
    [monthDay, 2, 1, 3],
  ]) {
    if (!m) continue;
    const month = MONTHS.indexOf(m[monIdx]);
    if (month < 0) continue;
    let year = m[yearIdx] ? +m[yearIdx] : base.getFullYear();
    let d = new Date(year, month, +m[dayIdx]);
    if (!m[yearIdx] && d < base) d = new Date(year + 1, month, +m[dayIdx]);
    return d;
  }

  for (let i = 0; i < 7; i++) {
    if (t.includes(WEEKDAYS[i])) {
      let diff = (i - base.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      if (/next\s+\w+day/.test(t)) diff += diff < 7 ? 7 : 0;
      return new Date(base.getTime() + diff * 864e5);
    }
  }
  return null;
}

export function toMarkdown({ title, date, decisions, action_items, open_questions }) {
  const lines = [`# ${title || "Meeting notes"}${date ? ` (${date})` : ""}`, ""];
  lines.push("## Decisions");
  for (const d of decisions) {
    const extra = [d.rationale && `why: ${d.rationale}`, d.owner && `owner: ${d.owner}`].filter(Boolean).join("; ");
    lines.push(`- ${d.title}${extra ? ` (${extra})` : ""}`);
  }
  if (!decisions.length) lines.push("- None");
  lines.push("", "## Action items");
  for (const a of action_items) {
    const extra = [a.owner, a.due && `due ${a.due}`].filter(Boolean).join(", ");
    lines.push(`- [ ] ${a.task}${extra ? ` (${extra})` : ""}`);
  }
  if (!action_items.length) lines.push("- None");
  lines.push("", "## Open questions");
  for (const q of open_questions) lines.push(`- ${q}`);
  if (!open_questions.length) lines.push("- None");
  return lines.join("\n") + "\n";
}

const icsDate = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
const icsText = (s) => String(s).replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");

/** All-day calendar events for the action items whose deadline could be read. */
export function toIcs(actionItems, today = new Date()) {
  const events = [];
  const skipped = [];
  const stamp = today.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  actionItems.forEach((a, i) => {
    const due = parseDue(a.due, today);
    if (!due) return skipped.push(a);
    const end = new Date(due.getTime() + 864e5);
    events.push(
      [
        "BEGIN:VEVENT",
        `UID:decision-notes-${stamp}-${i}@decision-notes.web.app`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${icsDate(due)}`,
        `DTEND;VALUE=DATE:${icsDate(end)}`,
        `SUMMARY:${icsText(a.task)}`,
        a.owner ? `DESCRIPTION:${icsText(`Owner: ${a.owner}. Deadline as written: ${a.due}`)}` : `DESCRIPTION:${icsText(`Deadline as written: ${a.due}`)}`,
        "END:VEVENT",
      ].join("\r\n")
    );
  });
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Decision Notes//EN", ...events, "END:VCALENDAR"].join("\r\n");
  return { ics, count: events.length, skipped };
}
