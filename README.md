# Setu

**A multilingual decision and resolution layer for India.**

Setu turns an Indian-language or code-mixed support message into a structured, evidence-bound case that an operator can safely act on. It uses Sarvam-105B for multilingual understanding, then applies deterministic policy checks before routing or escalating the case.

This is a product prototype for a Sarvam AI SDE internship application. It is inspired by the idea behind decision-focused models such as TypeSafe AI's Jev, but Setu is not a new foundation model. It is a Sarvam-native product layer: natural language in, typed operational decision out.

## What the prototype demonstrates

- Indic-language and code-mixed chat replies
- Browser voice input in supported Chrome or Edge browsers
- Sarvam-105B live chat completion through a server-side API key
- Structured case extraction: issue, amount, date, location, reference ID, provider, impact, and requested action
- Typed decision output: route, human-review flag, confidence, and evidence-based reason
- Missing-field detection and one localized follow-up question
- Deterministic route-consistency guard so a model mismatch cannot silently send a case to the wrong team
- Live request pipeline trace
- Escalation for high urgency or low confidence
- Offline message queue with local fallback messaging
- Operations dashboard with language, category, latency, escalation, and case-readiness metrics
- In-memory sessions with TTL cleanup and a rate-limited Sarvam queue

## Product thesis

Multilingual AI is most valuable when it does more than generate a reply. Setu focuses on the operational gap after the conversation:

```text
messy voice or text
        -> multilingual understanding
        -> evidence-bound case
        -> missing-fact question
        -> typed routing decision
        -> human review or safe handoff
```

The system deliberately does not auto-resolve uncertain cases. It shows what was extracted, what is missing, and why a route was selected.

## Run locally

Requirements: Node.js 18 or newer.

```bash
npm install
copy .env.example .env
```

Add a Sarvam API key to `.env`:

```env
SARVAM_API_KEY=sk_your_key_here
SARVAM_MODEL=sarvam-105b
PORT=3000
SARVAM_RATE_LIMIT_PER_MIN=35
```

Start the app from the directory containing `package.json`:

```bash
npm start
```

Open:

- `http://localhost:3000/` for the multilingual chat experience
- `http://localhost:3000/dashboard.html` for the operator dashboard
- `http://localhost:3000/api/health` for runtime configuration

Without an API key, Setu runs in deterministic mock mode. Never commit `.env` or expose a real API key in a README, screenshot, Git history, or frontend code.

## Deploy on Render

Render is the recommended host because Setu uses one long-running Node process and a WebSocket endpoint at `/ws`. Vercel is designed primarily around serverless functions and is not the right default for this WebSocket architecture.

1. Push this repository to GitHub without `.env`.
2. In Render, choose **New > Blueprint** and select the repository.
3. Render detects `render.yaml`.
4. Set the `SARVAM_API_KEY` secret in the Render dashboard.
5. Deploy and open the generated URL.
6. Verify `/api/health` reports `mockMode: false` and `model: sarvam-105b`.

The included `render.yaml` defines:

- Node runtime
- `npm install` build
- `npm start` command
- `/api/health` health check
- `SARVAM_API_KEY` as an unsynced secret
- `sarvam-105b` as the live model

Render's free service may sleep when idle, so the first request after inactivity can be slow. For a judged demo, open the app shortly before presenting it.

## Architecture

```text
Browser chat
  | WebSocket /ws
  v
Express + WebSocket server
  |-- session store with TTL
  |-- token-bucket rate limiter
  |-- Sarvam reply call
  |-- Sarvam structured decision call
  |-- deterministic policy guard
  v
Resolution Brief + Ops dashboard
```

Important modules:

```text
server.js              Express app and WebSocket workflow
lib/sarvamClient.js    Sarvam client, retries, JSON mode, mock mode
lib/promptBuilder.js   Reply and typed decision contracts
lib/rateLimiter.js     Outbound request queue
lib/sessionStore.js    Session, case, escalation, and metrics state
public/index.html      Chat and Resolution Brief
public/dashboard.html  Operations dashboard
public/js/chat.js      WebSocket, offline queue, and voice interaction
public/js/dashboard.js Dashboard polling and visualizations
render.yaml            Render deployment definition
```

## Voice limitation

The current browser microphone uses the Web Speech API. It is free and requires no Sarvam speech quota, but browser support and microphone permission vary. Sarvam is currently used for chat reasoning and structured case decisions.

A future production version can replace browser recognition with Sarvam Saaras realtime speech-to-text for partial transcripts, automatic language detection, noisy audio handling, and domain keyterm prompting.

## Safety and limitations

- Session data is currently in memory and disappears when the process restarts.
- This is a prototype, not a production support or public-service system.
- Model output is validated and policy-checked, but it still requires evaluation on representative multilingual data.
- The local offline fallback is keyword-based and is clearly labeled as non-Sarvam output.
- Do not send real personal, financial, or government-identification data to a demo deployment.

## Evaluation plan

The next serious engineering step is a small labeled evaluation set containing Hindi, Hinglish, Tamil, Telugu, Bengali, Marathi, and English cases. Measure:

- Language identification accuracy
- Category and route accuracy
- Missing-field recall
- Human-review precision
- Structured-output validity
- Latency and rate-limit behavior

## Demo script

Use this case during a review:

> Mera UPI payment 2400 rupaye ka kat gaya lekin order confirm nahi hua. Reference UPI9281. Please refund it urgently.

Show that Setu:

1. Replies in the user's language.
2. Extracts the amount and reference ID without inventing facts.
3. Routes the issue to billing.
4. Detects that the payment date is missing.
5. Asks one Hindi follow-up question.
6. Marks the case for safe operator handling.
7. Updates the operations dashboard.

## License

No license has been selected yet. Add one before publishing the repository publicly.
