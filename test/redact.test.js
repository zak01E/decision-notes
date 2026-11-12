import { test } from "node:test";
import assert from "node:assert/strict";
import { redact, restore, splitNotes, vaultRows } from "../src/redact.js";

test("rules mask e-mails, phones, amounts and URLs", () => {
  const { text, vault } = redact(
    "Mail amina@acme.io or call +33 6 12 34 56 78. Budget 45 000 € approved, see https://intra.acme.io/x"
  );
  assert.ok(!text.includes("amina@acme.io"));
  assert.ok(!text.includes("12 34 56 78"));
  assert.ok(!text.includes("45 000"));
  assert.ok(!text.includes("intra.acme.io"));
  assert.match(text, /\[EMAIL_1\]/);
  assert.match(text, /\[AMOUNT_1\]/);
  assert.equal(vaultRows(vault).length, 4);
});

test("dates and sprint counts are not taken for phone numbers", () => {
  const { text } = redact("Ship on 2026-11-30, it costs about 3 sprints, room 204.");
  assert.equal(text, "Ship on 2026-11-30, it costs about 3 sprints, room 204.");
});

test("names from the on-device model are masked, longest first, case-insensitive", () => {
  const { text } = redact("Amina Diallo met Acme. amina will tell ACME.", {
    people: ["Amina Diallo", "Amina"],
    organizations: ["Acme"],
  });
  assert.equal(text, "[PERSON_1] met [ORG_1]. [PERSON_2] will tell [ORG_1].");
});

test("restore puts values back in nested model output", () => {
  const { vault } = redact("Tom pays $3,000 to amina@acme.io", { people: ["Tom"] });
  const out = restore(
    { decisions: [{ title: "[PERSON_1] pays [AMOUNT_1]", owner: "[PERSON_1]" }], open_questions: ["mail [EMAIL_1]?"] },
    vault
  );
  assert.deepEqual(out, {
    decisions: [{ title: "Tom pays $3,000", owner: "Tom" }],
    open_questions: ["mail amina@acme.io?"],
  });
});

test("same value keeps the same placeholder across calls with a shared vault", () => {
  const first = redact("Lucie owns it", { people: ["Lucie"] });
  const second = redact("Ask Lucie", { people: ["Lucie"] }, first.vault);
  assert.equal(second.text, "Ask [PERSON_1]");
});

test("splitNotes keeps chunks under the word limit", () => {
  const notes = Array.from({ length: 30 }, (_, i) => `- item ${i} has five words`).join("\n");
  const chunks = splitNotes(notes, 40);
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok(c.split(/\s+/).filter(Boolean).length <= 40);
  assert.equal(chunks.join("\n"), notes);
});
