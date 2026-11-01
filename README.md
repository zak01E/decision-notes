# Decision Notes

Paste your meeting notes, get back the decisions, the tasks and the open questions.
By default the notes stay on your computer: the model runs inside Chrome (Gemini Nano).
If your machine can't run it, the app can fall back to Gemini in the cloud, and it always tells you which one answered.

Live: https://decision-notes.web.app

## What it does

- Pulls out decisions (with the reason and the owner when the notes give them), action items and open questions.
- Keeps a log of past decisions in your browser. When new notes contradict an old decision, it says so.
- Three modes:
  - **Private**: on-device only. Nothing is sent anywhere. Fails if Chrome can't run the local model.
  - **Auto**: on-device when available, cloud otherwise.
  - **Cloud**: always Gemini in the cloud.
- Every result shows where it was processed (🔒 this device or ☁️ cloud) and how long it took.

## How it works

Built on [Firebase AI Logic](https://firebase.google.com/docs/ai-logic) hybrid inference (`firebase/ai`):

- `getGenerativeModel` with `InferenceMode.ONLY_ON_DEVICE`, `PREFER_ON_DEVICE` or `ONLY_IN_CLOUD`.
- The same JSON schema is used on both sides (`responseSchema` in the cloud, `responseConstraint` on device), so the UI doesn't care which model answered.
- `response.inferenceSource` drives the badge.
- Cloud calls are protected by App Check (reCAPTCHA Enterprise).

All the AI code is in [`src/ai.js`](src/ai.js). The UI is plain HTML/JS with Vite, no framework.

## Run it locally

You need Node 20+ and a Firebase project with Firebase AI Logic (Gemini Developer API) turned on.

```bash
npm install
cp .env.example .env   # fill in your Firebase web config
npm run dev
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
