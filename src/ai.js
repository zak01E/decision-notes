// Hybrid AI layer: Gemini Nano in Chrome when possible, Gemini in the cloud otherwise.
// Built on Firebase AI Logic (firebase/ai).

import { initializeApp } from "firebase/app";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from "firebase/ai";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

// Firebase config comes from .env (see .env.example). Without it, only the
// on-device path can work, which is enough for the "Private" mode.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "missing",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "missing",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "missing",
};
export const cloudConfigured = firebaseConfig.apiKey !== "missing";

const app = initializeApp(firebaseConfig);

// App Check proves cloud requests come from this app. On localhost a debug
// token is used instead (printed in the console, registered in Firebase).
const appCheckKey = import.meta.env.VITE_RECAPTCHA_ENTERPRISE_KEY;
if (cloudConfigured && appCheckKey) {
  // import.meta.env.DEV is false in production builds, so the token never ships.
  if (import.meta.env.DEV) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = import.meta.env.VITE_APPCHECK_DEBUG_TOKEN || true;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(appCheckKey),
    isTokenAutoRefreshEnabled: true,
  });
}

const ai = getAI(app, { backend: new GoogleAIBackend() });

// What we want back from a set of meeting notes.
const notesSchema = Schema.object({
  properties: {
    decisions: Schema.array({
      items: Schema.object({
        properties: {
          title: Schema.string({ description: "What was decided, in one short sentence" }),
          rationale: Schema.string({ description: "Why, if the notes say so" }),
          owner: Schema.string({ description: "Who decided or owns it, if mentioned" }),
        },
        optionalProperties: ["rationale", "owner"],
      }),
    }),
    action_items: Schema.array({
      items: Schema.object({
        properties: {
          task: Schema.string(),
          owner: Schema.string(),
          due: Schema.string({ description: "Deadline as written in the notes" }),
        },
        optionalProperties: ["owner", "due"],
      }),
    }),
    open_questions: Schema.array({ items: Schema.string() }),
  },
});

// Used to compare new decisions with the ones already in the log.
const conflictSchema = Schema.object({
  properties: {
    conflicts: Schema.array({
      items: Schema.object({
        properties: {
          new_decision: Schema.string(),
          past_decision: Schema.string(),
          explanation: Schema.string(),
        },
      }),
    }),
  },
});

// Names the on-device model should hide before anything goes to the cloud.
const sensitiveSchema = Schema.object({
  properties: {
    people: Schema.array({ items: Schema.string(), description: "Names of people, as written" }),
    organizations: Schema.array({ items: Schema.string(), description: "Companies, clients, partners, teams" }),
    projects: Schema.array({ items: Schema.string(), description: "Internal project or product code names" }),
    other: Schema.array({ items: Schema.string(), description: "Other confidential values: addresses, ids, salaries" }),
  },
});

const MODES = {
  private: InferenceMode.ONLY_ON_DEVICE,
  auto: InferenceMode.PREFER_ON_DEVICE,
  cloud: InferenceMode.ONLY_IN_CLOUD,
};

function modelFor(mode, schema) {
  return getGenerativeModel(ai, {
    mode: MODES[mode],
    inCloudParams: {
      model: "gemini-3.5-flash-lite",
      generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    },
    onDeviceParams: { promptOptions: { responseConstraint: schema } },
  });
}

/** Whether Chrome's built-in model exists on this machine ("available", "downloadable", ...). */
export async function deviceAvailability() {
  if (!("LanguageModel" in self)) return "unsupported";
  try {
    return await self.LanguageModel.availability();
  } catch {
    return "unsupported";
  }
}

/** Downloads/initialises Gemini Nano. Must follow a user gesture (button click). */
export async function prepareDeviceModel(onProgress) {
  await modelFor("auto", notesSchema).initializeDeviceModel(onProgress);
}

async function run(mode, schema, prompt) {
  const started = performance.now();
  const result = await modelFor(mode, schema).generateContent(prompt);
  const response = result.response;
  return {
    data: JSON.parse(response.text()),
    source: response.inferenceSource || (mode === "cloud" ? "in_cloud" : "on_device"),
    ms: Math.round(performance.now() - started),
  };
}

const EXTRACT_PROMPT =
  "You read meeting notes and extract structured information.\n" +
  "Only report what the notes actually say; never invent owners, dates or reasons.\n" +
  "A decision is something the group agreed or chose. An action item is a task someone will do.\n" +
  "Placeholders such as [PERSON_1] or [AMOUNT_2] stand for hidden values: copy them exactly as written.\n\n" +
  "Meeting notes:\n";

/** One extraction call. `mode` is "private" (device), "cloud" or "auto". */
export function extractFromNotes(notes, mode) {
  return run(mode, notesSchema, EXTRACT_PROMPT + notes);
}

/**
 * On-device extraction of long notes: the local model has a small context window,
 * so the notes are read in chunks and the results are merged.
 */
export async function extractInChunks(chunks, onChunk) {
  const merged = { decisions: [], action_items: [], open_questions: [] };
  let ms = 0;
  for (let i = 0; i < chunks.length; i++) {
    onChunk?.(i + 1, chunks.length);
    const part = await extractFromNotes(chunks[i], "private");
    ms += part.ms;
    for (const key of Object.keys(merged)) merged[key].push(...(part.data[key] || []));
  }
  return { data: merged, source: "on_device", ms };
}

/** Asks the on-device model which names in the notes are sensitive. Never calls the cloud. */
export async function findSensitive(chunks) {
  const found = { people: [], organizations: [], projects: [], other: [] };
  let ms = 0;
  for (const chunk of chunks) {
    const prompt =
      "List every person name, company or client name, internal project name, and other confidential value " +
      "(street address, employee id, salary) that appears in these notes. Copy each one exactly as written. " +
      "Do not list job titles, dates or generic words.\n\nNotes:\n" + chunk;
    const r = await run("private", sensitiveSchema, prompt);
    ms += r.ms;
    for (const key of Object.keys(found)) found[key].push(...(r.data[key] || []));
  }
  return { entities: found, ms };
}

export function findConflicts(newDecisions, pastDecisions, mode) {
  const prompt =
    "Compare NEW decisions with PAST decisions of the same team.\n" +
    "List only real contradictions (the new decision reverses or goes against a past one).\n" +
    "Return an empty list if there are none. Copy placeholders such as [PERSON_1] exactly.\n\n" +
    "PAST decisions:\n" + pastDecisions.map((d) => `- ${d.title}${d.rationale ? ` (because ${d.rationale})` : ""}`).join("\n") +
    "\n\nNEW decisions:\n" + newDecisions.map((d) => `- ${d.title}`).join("\n");
  return run(mode, conflictSchema, prompt);
}
