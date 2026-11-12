import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDue, toMarkdown, toIcs } from "../src/export.js";

const wed = new Date(2026, 10, 11); // Wednesday 11 Nov 2026
const ymd = (d) => d && `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

test("parseDue reads common ways of writing a deadline", () => {
  assert.equal(ymd(parseDue("before Friday", wed)), "2026-11-13");
  assert.equal(ymd(parseDue("Wednesday", wed)), "2026-11-18");
  assert.equal(ymd(parseDue("tomorrow", wed)), "2026-11-12");
  assert.equal(ymd(parseDue("by 30 Nov", wed)), "2026-11-30");
  assert.equal(ymd(parseDue("Dec 4", wed)), "2026-12-4");
  assert.equal(ymd(parseDue("3 Jan", wed)), "2027-1-3");
  assert.equal(ymd(parseDue("2026-12-15", wed)), "2026-12-15");
  assert.equal(parseDue("when possible", wed), null);
  assert.equal(parseDue("", wed), null);
});

test("markdown lists every section, with owners and due dates", () => {
  const md = toMarkdown({
    title: "Platform sync",
    date: "2026-11-11",
    decisions: [{ title: "Stay on PostgreSQL", rationale: "joins", owner: "Tom" }],
    action_items: [{ task: "Write runbook", owner: "Tom", due: "Friday" }],
    open_questions: [],
  });
  assert.match(md, /# Platform sync \(2026-11-11\)/);
  assert.match(md, /- Stay on PostgreSQL \(why: joins; owner: Tom\)/);
  assert.match(md, /- \[ \] Write runbook \(Tom, due Friday\)/);
  assert.match(md, /## Open questions\n- None/);
});

test("ics has one event per readable deadline and reports the others", () => {
  const { ics, count, skipped } = toIcs(
    [
      { task: "Write runbook; check backups", owner: "Tom", due: "Friday" },
      { task: "Ask legal", owner: "Raj" },
    ],
    wed
  );
  assert.equal(count, 1);
  assert.equal(skipped.length, 1);
  assert.match(ics, /DTSTART;VALUE=DATE:20261113/);
  assert.match(ics, /SUMMARY:Write runbook\\; check backups/);
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
});
