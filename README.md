# Decision Notes

Paste your meeting notes, get back the decisions, the tasks and the open questions.
Built for teams whose meetings are confidential (HR, legal, client work, health): the model runs inside Chrome (Gemini Nano) when it can,
and when the cloud is needed, names, e-mails, phone numbers and amounts are masked on your computer before anything is sent.
The app always shows where the work was done, why, and exactly what left your computer.

Live: https://decision-notes.web.app

## What it does

- Pulls out decisions (with the reason and the owner when the notes give them), action items and open questions.
- Keeps a log of past decisions in your browser. When new notes contradict an old decision, it says so.
- Three modes:
  - **Private**: on-device only. Nothing is sent anywhere. Long notes are read in parts on the device.
  - **Auto**: the app decides, and says why (see below).
  - **Cloud**: always Gemini in the cloud, masked by default.
- **Masking before the cloud.** Gemini Nano lists the people, companies and project names in the notes; rules catch e-mails, phone numbers, amounts, links and IBANs. Each value becomes a placeholder (`[PERSON_1]`, `[AMOUNT_2]`), the cloud model answers with placeholders, and the real values are put back in the browser. A panel shows the exact text that was sent and the table that stayed local. An "Always hide" list covers client and project names.
- Every result shows where it was processed (🔒 this device or ☁️ cloud), how long it took, and the reason for that choice.
- Results can be corrected in place, exported as Markdown, and action items with a readable deadline ("Friday", "30 Nov") exported to a calendar (.ics).
- Installable and usable offline (service worker): with Gemini Nano, the whole app works in airplane mode.

## How Auto decides

| Situation | Where it runs |
|---|---|
| Offline, local model ready | On this device (long notes in parts) |
| Short notes (≤ 900 words), local model ready | On this device, nothing leaves the computer |
| Long notes, local model ready | Nano finds the names on the device, notes are masked, then sent to Gemini in the cloud |
| No local model | Rule-based masking on the device, then the cloud |

The same masking is applied to the contradiction check against past decisions.

## Built during #BuildHybridAI (from 11 Nov 2026)

A first version existed before the contest: extraction of decisions, tasks and questions, the local decision log with contradiction check, and the three modes chosen by hand.
Added during the submission period:
- on-device name finding with Gemini Nano and masking before every cloud call, with placeholders restored locally (`src/redact.js`);
- the "What left this computer" panel and the "Always hide" list;
- automatic routing with a plain-language reason (`src/route.js`) and chunked on-device reading of long notes;
- editable results, Markdown and calendar export (`src/export.js`), log search;
- offline support (manifest + service worker);
- a test suite (`npm test`).

## How it works

Built on [Firebase AI Logic](https://firebase.google.com/docs/ai-logic) hybrid inference (`firebase/ai`):

- `getGenerativeModel` with `InferenceMode.ONLY_ON_DEVICE`, `PREFER_ON_DEVICE` or `ONLY_IN_CLOUD`.
- The same JSON schema is used on both sides (`responseSchema` in the cloud, `responseConstraint` on device), so the UI doesn't care which model answered.
- `response.inferenceSource` drives the badge.
- Cloud calls are protected by App Check (reCAPTCHA Enterprise).

All the AI calls are in [`src/ai.js`](src/ai.js); masking, routing and export are plain functions with tests in `test/`. The UI is plain HTML/JS with Vite, no framework.

## Run it locally

You need Node 20+ and a Firebase project with Firebase AI Logic (Gemini Developer API) turned on.

```bash
npm install
cp .env.example .env   # fill in your Firebase web config
npm run dev
npm test               # masking, routing and export tests
```

For on-device mode, use Chrome on a machine that meets the [built-in AI hardware requirements](https://developer.chrome.com/docs/ai/get-started), then click "Prepare on-device AI" once.

App Check: set `VITE_RECAPTCHA_ENTERPRISE_KEY`, and for localhost register a debug token in the Firebase console and put it in `VITE_APPCHECK_DEBUG_TOKEN`. The debug token is only used by the dev server, never in a build.

## Deploy

```bash
npm run build
npx firebase deploy --only hosting
```

## License

MIT
