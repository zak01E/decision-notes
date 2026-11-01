import "./style.css";
import {
  cloudConfigured,
  deviceAvailability,
  extractFromNotes,
  findConflicts,
  prepareDeviceModel,
} from "./ai.js";

const $ = (id) => document.getElementById(id);
const LOG_KEY = "decision-notes-log";

const SAMPLE = `Platform sync - 3 Nov
Present: Amina, Tom, Lucie, Raj

- Billing service: we agreed to stay on PostgreSQL. Reporting needs joins and the MongoDB migration would cost about 3 sprints.
- Tom will write the backup runbook before Friday.
- Mobile login: decided to drop SMS codes and use passkeys, SMS costs too much and is phished a lot. Lucie owns the rollout.
- Raj to check with legal whether we can keep logs for 90 days.
- Still unclear: do we support Safari 16 or not?`;

let lastDecisions = [];

function readLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY)) || [];
  } catch {
    return [];
  }
}

function writeLog(entries) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(entries));
  } catch {
    // Storage can be unavailable (private window); the app keeps working without a log.
  }
}

function li(text, sub) {
  const item = document.createElement("li");
  item.textContent = text;
  if (sub) {
    const small = document.createElement("small");
    small.textContent = sub;
    item.append(small);
  }
  return item;
}

function fill(list, items, render) {
  list.replaceChildren(...(items.length ? items.map(render) : [li("Nothing found.")]));
}

function renderLog() {
  const entries = readLog();
  fill($("log"), entries, (d) => li(d.title, [d.rationale, d.date].filter(Boolean).join(" · ")));
}

function showEngine(source, ms) {
  const badge = $("engine");
  const onDevice = source === "on_device";
  badge.textContent = onDevice ? `🔒 Processed on this device · ${ms} ms` : `☁️ Processed in the cloud · ${ms} ms`;
  badge.className = `badge ${onDevice ? "local" : "cloud"}`;
  badge.hidden = false;
}

function showError(err) {
  const box = $("error");
  let msg = err?.message || String(err);
  if ($("mode").value === "private") {
    msg += " — Private mode needs Chrome's built-in AI. Click \"Prepare on-device AI\" first, or switch to Auto.";
  } else if (!cloudConfigured) {
    msg += " — Cloud mode needs a Firebase config (.env).";
  }
  box.textContent = msg;
  box.hidden = false;
}

async function updateDeviceStatus() {
  const state = await deviceAvailability();
  const text = {
    available: "On-device AI is ready on this computer.",
    downloadable: "On-device AI can be downloaded (about once, a few minutes).",
    downloading: "On-device AI is downloading...",
    unsupported: "This browser has no built-in AI. Auto mode will use the cloud.",
    unavailable: "This computer can't run the on-device model. Auto mode will use the cloud.",
  }[state] || `On-device AI: ${state}`;
  $("device-status").textContent = text + (cloudConfigured ? "" : " (Cloud not configured.)");
}

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

$("sample").addEventListener("click", () => ($("notes").value = SAMPLE));

$("extract").addEventListener("click", async () => {
  const notes = $("notes").value.trim();
  if (!notes) return;
  const button = $("extract");
  button.disabled = true;
  button.textContent = "Reading notes...";
  $("error").hidden = true;
  $("conflicts-card").hidden = true;
  try {
    const mode = $("mode").value;
    const { data, source, ms } = await extractFromNotes(notes, mode);
    showEngine(source, ms);
    lastDecisions = data.decisions || [];
    fill($("decisions"), lastDecisions, (d) => li(d.title, [d.rationale, d.owner].filter(Boolean).join(" · ")));
    fill($("actions"), data.action_items || [], (a) => li(a.task, [a.owner, a.due].filter(Boolean).join(" · ")));
    fill($("questions"), data.open_questions || [], (q) => li(q));
    $("results").hidden = false;

    const past = readLog();
    if (past.length && lastDecisions.length) {
      const check = await findConflicts(lastDecisions, past, mode);
      const conflicts = check.data.conflicts || [];
      if (conflicts.length) {
        fill($("conflicts"), conflicts, (c) => li(`${c.new_decision} ↔ ${c.past_decision}`, c.explanation));
        $("conflicts-card").hidden = false;
      }
    }
  } catch (err) {
    showError(err);
  } finally {
    button.disabled = false;
    button.textContent = "Extract decisions";
  }
});

$("save").addEventListener("click", () => {
  const date = new Date().toISOString().slice(0, 10);
  writeLog([...readLog(), ...lastDecisions.map((d) => ({ ...d, date }))]);
  renderLog();
});

$("clear-log").addEventListener("click", () => {
  writeLog([]);
  renderLog();
});

updateDeviceStatus();
renderLog();
