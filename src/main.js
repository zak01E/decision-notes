import "./style.css";
import {
  cloudConfigured,
  deviceAvailability,
  extractFromNotes,
  extractInChunks,
  findConflicts,
  findSensitive,
  prepareDeviceModel,
} from "./ai.js";
import { newVault, redact, restore, splitNotes, vaultRows, wordCount } from "./redact.js";
import { LOCAL_CHUNK_WORDS, planRoute } from "./route.js";
import { toIcs, toMarkdown } from "./export.js";

const $ = (id) => document.getElementById(id);
const LOG_KEY = "decision-notes-log";
const HIDE_KEY = "decision-notes-always-hide";

const SAMPLE = `Platform sync - 3 Nov
Present: Amina Diallo, Tom Becker, Lucie Martin, Raj Patel (Northwind Bank)

- Billing service: we agreed to stay on PostgreSQL. Reporting needs joins and the MongoDB migration would cost about 3 sprints (roughly €45,000).
- Tom will write the backup runbook before Friday.
- Mobile login: decided to drop SMS codes and use passkeys, SMS costs too much and is phished a lot. Lucie owns the rollout.
- Raj to check with legal (legal@northwind-bank.com) whether we can keep logs for 90 days.
- Northwind wants the pilot extended; Amina will call their CTO on +44 20 7946 0958 by 30 Nov.
- Still unclear: do we support Safari 16 or not?`;

// Current results, edited in place by the user before saving or exporting.
let current = null;
let device = "unsupported";

// ---------------------------------------------------------------- storage
function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable (private window); the app keeps working without it.
  }
}
const readLog = () => load(LOG_KEY, []);

function alwaysHide() {
  return $("always-hide")
    .value.split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------- rendering
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, attrs);
  node.append(...children.filter((c) => c != null));
  return node;
}

/** An editable text bound to obj[field]. */
function editable(obj, field, placeholder, cls = "") {
  const span = el("span", { className: `edit ${cls}`, contentEditable: "plaintext-only", spellcheck: false });
  span.textContent = obj[field] || "";
  span.dataset.placeholder = placeholder;
  span.addEventListener("input", () => {
    obj[field] = span.textContent.trim();
  });
  return span;
}

function removeButton(list, item) {
  return el("button", {
    className: "remove",
    title: "Remove",
    textContent: "×",
    onclick: () => {
      list.splice(list.indexOf(item), 1);
      renderResults();
    },
  });
}

function renderResults() {
  const { decisions, action_items: actions, open_questions: questions } = current;
  const empty = () => el("li", { className: "muted", textContent: "Nothing found." });

  $("decisions").replaceChildren(
    ...(decisions.length
      ? decisions.map((d) =>
          el(
            "li",
            {},
            editable(d, "title", "Decision"),
            removeButton(decisions, d),
            el("small", {}, "why: ", editable(d, "rationale", "not stated"), " · owner: ", editable(d, "owner", "nobody"))
          )
        )
      : [empty()])
  );
  $("actions").replaceChildren(
    ...(actions.length
      ? actions.map((a) =>
          el(
            "li",
            {},
            editable(a, "task", "Task"),
            removeButton(actions, a),
            el("small", {}, "owner: ", editable(a, "owner", "nobody"), " · due: ", editable(a, "due", "no date"))
          )
        )
      : [empty()])
  );
  // Questions are plain strings: wrap them so they can be edited like the rest.
  const qObjs = questions.map((q) => ({ q }));
  $("questions").replaceChildren(
    ...(qObjs.length
      ? qObjs.map((o, i) => {
          const span = editable(o, "q", "Question");
          span.addEventListener("input", () => (questions[i] = o.q));
          return el("li", {}, span, removeButton(questions, questions[i]));
        })
      : [empty()])
  );
  $("results").hidden = false;
}

function renderLog() {
  const query = $("log-search").value.trim().toLowerCase();
  const entries = readLog()
    .map((d, i) => ({ ...d, i }))
    .reverse()
    .filter((d) => !query || [d.title, d.rationale, d.owner, d.date].join(" ").toLowerCase().includes(query));
  $("log").replaceChildren(
    ...(entries.length
      ? entries.map((d) =>
          el("li", {}, d.title, el("small", { textContent: [d.rationale, d.owner, d.date].filter(Boolean).join(" · ") }))
        )
      : [el("li", { className: "muted", textContent: query ? "No match." : "No decisions saved yet." })])
  );
}

function showEngine(source, ms, masked) {
  const badge = $("engine");
  const onDevice = source === "on_device";
  badge.textContent = onDevice
    ? `🔒 Processed on this device · ${(ms / 1000).toFixed(1)} s`
    : `☁️ Processed in the cloud${masked ? ", masked" : ""} · ${(ms / 1000).toFixed(1)} s`;
  badge.className = `badge ${onDevice ? "local" : "cloud"}`;
  badge.hidden = false;
}

function showReason(text) {
  $("reason").textContent = text;
  $("reason").hidden = !text;
}

function showError(err) {
  $("error").textContent = err?.message || String(err);
  $("error").hidden = false;
}

function showSent(text, vault) {
  $("sent-text").textContent = text;
  $("vault").replaceChildren(
    ...vaultRows(vault).map(({ token, value }) => el("tr", {}, el("td", { textContent: token }), el("td", { textContent: value })))
  );
  if (!vault.byToken.size) $("vault").append(el("tr", {}, el("td", { colSpan: 2, className: "muted", textContent: "Nothing to mask was found." })));
  $("sent-card").hidden = false;
}

async function updateDeviceStatus() {
  device = await deviceAvailability();
  const text = {
    available: "On-device AI is ready on this computer.",
    downloadable: "On-device AI can be downloaded once (a few minutes). Click \"Prepare on-device AI\".",
    downloading: "On-device AI is downloading...",
    unsupported: "This browser has no built-in AI. Auto mode masks sensitive values, then uses the cloud.",
    unavailable: "This computer can't run the on-device model. Auto mode masks sensitive values, then uses the cloud.",
  }[device] || `On-device AI: ${device}`;
  $("device-status").textContent = text + (cloudConfigured ? "" : " (Cloud not configured.)");
  $("prepare").hidden = device === "available" || device === "unsupported" || device === "unavailable";
}

function updateNet() {
  const online = navigator.onLine;
  $("net").textContent = online ? "Online" : "Offline";
  $("net").className = `pill ${online ? "" : "off"}`;
}

function updateModeUi() {
  $("mask-row").hidden = $("mode").value !== "cloud";
}

function updateWords() {
  const n = wordCount($("notes").value);
  $("words").textContent = n ? `${n.toLocaleString("en-US")} words · ` : "";
}

// ---------------------------------------------------------------- main flow
/** Masks a list of decisions with the same vault, for the cloud conflict check. */
function maskDecisions(list, entities, vault) {
  return list.map((d) => ({
    title: redact(d.title || "", entities, vault).text,
    rationale: d.rationale ? redact(d.rationale, entities, vault).text : undefined,
  }));
}

async function extract() {
  const notes = $("notes").value.trim();
  if (!notes) return;
  const button = $("extract");
  button.disabled = true;
  ["error", "conflicts-card", "sent-card", "engine"].forEach((id) => ($(id).hidden = true));
  $("export-status").textContent = "";
  const say = (t) => (button.textContent = t);

  try {
    const plan = planRoute({
      mode: $("mode").value,
      words: wordCount(notes),
      device,
      online: navigator.onLine,
      cloudConfigured,
      mask: $("mask").checked,
    });
    showReason(plan.reason);
    if (!plan.engine) throw new Error(plan.reason);

    let result;
    let entities = { other: alwaysHide() };
    let vault = null;

    if (plan.engine === "device") {
      say("Reading notes on this device...");
      result = await extractFromNotes(notes, "private");
    } else if (plan.engine === "device-chunks") {
      const chunks = splitNotes(notes, LOCAL_CHUNK_WORDS);
      result = await extractInChunks(chunks, (i, n) => say(`Reading part ${i} of ${n} on this device...`));
    } else if (plan.mask) {
      if (plan.findNamesOnDevice) {
        say("Finding names on this device...");
        try {
          const found = await findSensitive(splitNotes(notes, LOCAL_CHUNK_WORDS));
          entities = { ...found.entities, other: [...found.entities.other, ...entities.other] };
        } catch (err) {
          // Keep going with rules only, and say so.
          showReason(`${plan.reason} (The local model could not list names: ${err.message}. Rules only.)`);
        }
      }
      const masked = redact(notes, entities);
      vault = masked.vault;
      say("Sending masked notes to the cloud...");
      const raw = await extractFromNotes(masked.text, "cloud");
      result = { ...raw, data: restore(raw.data, vault) };
      showSent(masked.text, vault);
    } else {
      say("Sending notes to the cloud...");
      result = await extractFromNotes(notes, "cloud");
    }

    showEngine(result.source, result.ms, !!vault);
    current = {
      decisions: result.data.decisions || [],
      action_items: result.data.action_items || [],
      open_questions: result.data.open_questions || [],
    };
    renderResults();

    // Contradictions with the saved log, processed the same way as the notes.
    const past = readLog();
    if (past.length && current.decisions.length) {
      say("Checking against past decisions...");
      let check;
      if (plan.engine === "cloud" && vault) {
        const raw = await findConflicts(maskDecisions(current.decisions, entities, vault), maskDecisions(past, entities, vault), "cloud");
        check = { ...raw, data: restore(raw.data, vault) };
        showSent($("sent-text").textContent, vault); // the table may have grown
      } else {
        check = await findConflicts(current.decisions, past, plan.engine === "cloud" ? "cloud" : "private");
      }
      const conflicts = check.data.conflicts || [];
      if (conflicts.length) {
        $("conflicts").replaceChildren(
          ...conflicts.map((c) => el("li", {}, `${c.new_decision} ↔ ${c.past_decision}`, el("small", { textContent: c.explanation })))
        );
        $("conflicts-card").hidden = false;
      }
    }
  } catch (err) {
    showError(err);
  } finally {
    button.disabled = false;
    button.textContent = "Extract decisions";
  }
}

// ---------------------------------------------------------------- export
function download(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const today = () => new Date().toISOString().slice(0, 10);
const markdown = () => toMarkdown({ title: $("notes").value.trim().split("\n")[0].slice(0, 80), date: today(), ...current });

// ---------------------------------------------------------------- events
$("prepare").addEventListener("click", async () => {
  const bar = $("download");
  bar.hidden = false;
  try {
    await prepareDeviceModel((v) => (bar.value = v));
  } catch (err) {
    showError(err);
  } finally {
    bar.hidden = true;
    updateDeviceStatus();
  }
});

$("sample").addEventListener("click", () => {
  $("notes").value = SAMPLE;
  updateWords();
});
$("notes").addEventListener("input", updateWords);
$("mode").addEventListener("change", updateModeUi);
$("always-hide").addEventListener("input", () => store(HIDE_KEY, $("always-hide").value));
$("extract").addEventListener("click", extract);

$("save").addEventListener("click", () => {
  const date = today();
  const fresh = current.decisions.filter((d) => d.title).map((d) => ({ ...d, date }));
  store(LOG_KEY, [...readLog(), ...fresh]);
  renderLog();
  $("export-status").textContent = `${fresh.length} decision(s) added to the log.`;
});

$("copy-md").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(markdown());
    $("export-status").textContent = "Copied as Markdown.";
  } catch {
    download("decisions.md", "text/markdown", markdown());
  }
});
$("dl-md").addEventListener("click", () => download(`decisions-${today()}.md`, "text/markdown", markdown()));
$("dl-ics").addEventListener("click", () => {
  const { ics, count, skipped } = toIcs(current.action_items);
  if (!count) {
    $("export-status").textContent = "No task has a deadline I can read (try dates like \"Friday\" or \"30 Nov\").";
    return;
  }
  download(`tasks-${today()}.ics`, "text/calendar", ics);
  $("export-status").textContent =
    `${count} task(s) exported.` + (skipped.length ? ` ${skipped.length} without a readable deadline were left out.` : "");
});

$("clear-log").addEventListener("click", () => {
  if (!confirm("Delete every decision saved in this browser?")) return;
  store(LOG_KEY, []);
  renderLog();
});
$("log-search").addEventListener("input", renderLog);

window.addEventListener("online", updateNet);
window.addEventListener("offline", updateNet);

$("always-hide").value = load(HIDE_KEY, "");
updateNet();
updateModeUi();
updateDeviceStatus();
renderLog();

// Offline support: cache the app shell so it opens without a network (production build only).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
