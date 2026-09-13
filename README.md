# Portfolio Chatbot API

A small Express API that powers an AI assistant on a personal portfolio site. Visitors ask
questions about the site owner; the bot answers from a fixed profile plus live career
metrics pulled from Firestore, and politely refuses anything off-topic.

Built for a static frontend (Firebase Hosting) talking to a separate backend (Vercel), but
it runs anywhere Node runs.

- **Model** — [Groq](https://console.groq.com) (free tier available)
- **Live data** — Firestore, so availability and compensation can change without a redeploy
- **Docs** — Swagger UI at `/docs`, served from CDN
- **Streaming** — Server-Sent Events, plus a plain-JSON route for easy testing

---

## Quick start

```bash
git clone https://github.com/adil3811A/chat_bot_potfolio.git
cd chat_bot_potfolio
npm install
cp .env.example .env      # then fill in GROQ_API_KEY
npm run dev
```

Open <http://localhost:3000/docs> and try `POST /api/chat/sync`.

The only required variable is `GROQ_API_KEY`. Everything else has a working default, and
Firestore is optional — without it the bot answers from the static profile alone.

---

## Endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/chat` | Ask a question — streams the answer as Server-Sent Events |
| `POST` | `/api/chat/sync` | Same, but waits and returns one JSON object. Easiest to test |
| `GET` | `/health` | Liveness check; reports whether the API key was picked up |
| `GET` | `/docs` | Swagger UI |
| `GET` | `/openapi.json` | The raw OpenAPI 3.0 spec |

Both chat routes take the same body:

```json
{ "message": "What has Adil built recently?" }
```

### `POST /api/chat/sync`

```json
{ "text": "Adil recently shipped PannaseCHE, a GATE exam-prep app..." }
```

Off-topic questions come back with a flag, so the frontend can style refusals differently:

```json
{ "text": "I can only answer questions related to Adil Ansari's portfolio.", "offTopic": true }
```

### `POST /api/chat` (streaming)

Standard SSE frames, terminated by `[DONE]`:

```
data: {"text":"Adil is a mobile app developer "}

data: {"text":"based in Thane, India."}

data: [DONE]
```

Swagger UI cannot render a live stream — it buffers the whole body until the connection
closes. Use `/api/chat/sync` when testing from the docs page.

### Errors

| Status | Meaning |
| --- | --- |
| `400` | `message` missing or empty |
| `403` | Request origin is not in the allowlist |
| `500` | Upstream model call failed |

Error bodies include a `detail` field carrying the upstream message. Strip it before a
serious production deployment — it exposes provider internals.

---

## Configuration

All configuration is environment variables. Copy `.env.example` to `.env` to start.

### Required

| Variable | Description |
| --- | --- |
| `GROQ_API_KEY` | From <https://console.groq.com/keys> |

### Optional

| Variable | Default | Description |
| --- | --- | --- |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Must be a model your key can access — see note below |
| `PORT` | `3000` | Local port |
| `LOG_LEVEL` | `info` | `debug` also logs prompts and replies |
| `ALLOWED_ORIGINS` | see below | Comma-separated origins, or `*` for all |
| `NODE_ENV` | — | `production` drops the dev-only self-origins |

> **Check your model list first.** Groq accounts differ, and a model that exists for one key
> returns `404 model_not_found` for another. List yours before setting `GROQ_MODEL`:
>
> ```bash
> curl -s https://api.groq.com/openai/v1/models \
>   -H "Authorization: Bearer $GROQ_API_KEY" | grep '"id"'
> ```

### Firestore (optional)

Skip this entirely and the bot still works — it just won't know your current availability.

| Variable | Default | Description |
| --- | --- | --- |
| `GOOGLE_APPLICATION_CREDENTIALS` | — | Path to the service-account JSON (local dev) |
| `FIREBASE_SERVICE_ACCOUNT` | — | The same JSON as a one-line string (serverless) |
| `FIREBASE_PROJECT_ID` | — | Your Firebase project id |
| `FIRESTORE_COLLECTION` | `portfolio` | Collection holding the doc |
| `FIRESTORE_DOCUMENT` | `career_details` | Document id |
| `CAREER_CACHE_TTL_MS` | `300000` | Cache lifetime (5 min) — Firestore is billed per read |

---

## CORS

Browser origins are allowlisted. Set `ALLOWED_ORIGINS` as a comma-separated list:

```
ALLOWED_ORIGINS=https://your-site.web.app,https://your-site.firebaseapp.com,http://localhost:8080
```

Unset, it falls back to the defaults in `server.js`. Set it to `*` to allow every origin —
useful while developing a local frontend against a deployed backend. The server logs a
warning on every boot while that is on:

```
WARN [server] CORS is OPEN to all origins (ALLOWED_ORIGINS=*) — do not leave this on
```

Two things worth knowing:

- Requests **without** an `Origin` header (curl, Postman, server-to-server) are always
  allowed. They aren't bound by the same-origin policy, so blocking them achieves nothing —
  the header is trivially forged. CORS restrains browsers, not attackers.
- Disallowed origins get a `403` **before** the model is called, so a blocked page can't
  spend your quota.

---

## Live career metrics

Create a document at `portfolio/career_details` in Firestore. Every field is optional:

| Field | Example |
| --- | --- |
| `status` | `"Actively looking for job"` |
| `noticePeriod` | `"30 days"` |
| `currentCTC` | `"2.5 lpa"` |
| `expectedCTC` | `"5-6 lpa"` |
| `openTo` | `"Full-time Flutter roles, freelance"` |
| `updatedAt` | Firestore timestamp |

Only fields that are present get injected into the prompt. A missing field makes the bot say
it doesn't know and point the visitor at your contact details, rather than inventing a value.

> **Think before adding `currentCTC`.** This is a public chatbot — anyone who can open your
> site can ask for it, including your current employer and recruiters you're negotiating
> with. Leave the field out of the document and it is never disclosed.

Where credentials come from, in order: `FIREBASE_SERVICE_ACCOUNT` → `GOOGLE_APPLICATION_CREDENTIALS`
→ the runtime's own service account. If none resolve, the server logs a warning and carries on
without live data — a database outage never takes the chat endpoint down.

**Never commit the service-account JSON.** It grants full project access. The bundled
`.gitignore` already excludes `service-account*.json`, `*-firebase-adminsdk-*.json`, and
`serviceAccountKey.json`.

---

## Staying on topic

The system prompt instructs the model to reply with the exact token `OFF_TOPIC` for anything
outside the portfolio — general questions, code requests, essays, translation. The server
swaps that token for a friendly refusal before the visitor ever sees it.

The streaming route buffers the opening characters until it knows whether they are the
sentinel. Models emit text token by token, so `OFF_TOPIC` can arrive split as `"OFF"` +
`"_TOP"` + `"IC"` — testing each chunk on its own would leak those fragments to the page
before the third one gives it away.

To change the persona, edit `SYSTEM_INSTRUCTION` in `lib/chat.js`.

---

## Project layout

```
api/index.js       Vercel entry point — re-exports the Express app
server.js          App: CORS, logging, routes, Swagger. Listens only when run directly
lib/chat.js        Chat handlers, system prompt, OFF_TOPIC gate
lib/careerData.js  Firestore fetch, formatting, caching
logger.js          Leveled logger with per-request ids
swagger.js         OpenAPI spec, assembled from JSDoc blocks
docs.js            Swagger UI page, assets from CDN with SRI hashes
vercel.json        Routes every path to the Express app
```

Requests are tagged with an 8-character id, returned as `X-Request-Id` and printed on every
log line they produce — so a failing call can be traced from the browser to the model:

```
14:07:01 INFO  [http]  a1b2c3d4 POST /api/chat/sync 200 444 - 812ms
14:07:01 INFO  [chat:a1b2c3d4] Replied ms=806 chars=433 promptTokens=574 totalTokens=1047
```

---

## Deploying to Vercel

```bash
npm i -g vercel
vercel
```

Set the environment variables in **Settings → Environment Variables** — `.env` is not
deployed. Use `FIREBASE_SERVICE_ACCOUNT` rather than `GOOGLE_APPLICATION_CREDENTIALS`, since
there is no filesystem to point at.

### Two traps that look like CORS errors

Both produce "CORS error" in the browser console while having nothing to do with CORS. In
both cases the response never reaches your code, so no CORS header is ever set.

**1. Preview deployments are password-protected.** Any hostname containing
`-git-<branch>-<team>` is a preview and is guarded by Vercel Authentication by default:

```
OPTIONS https://your-app-git-main-you.vercel.app/api/chat
→ 302  location: https://vercel.com/sso-api?url=…
```

Point your frontend at the **production** hostname (the short one), or turn off
Settings → Deployment Protection.

**2. Handlers must live outside `api/`.** Any file in `api/` becomes its own serverless
function and takes precedence over the rewrite, bypassing every middleware in `server.js` —
including CORS. That is why the handlers live in `lib/` and `api/` holds only the entry
point. Keep it that way.

### Debugging a CORS error

Read the **status code** first, not the console message:

| Status | Real cause |
| --- | --- |
| `401` / `302` to a login page | Deployment protection |
| `308` / `301` | URL problem — often a double slash from joining a base URL ending in `/` |
| `404` | Wrong path, or the model name is invalid |
| `500` | The function crashed — CORS is irrelevant |
| `200` but still blocked | Genuinely a CORS configuration issue |

Then reproduce with curl, which ignores CORS entirely:

```bash
curl -i -X OPTIONS 'https://your-api.vercel.app/api/chat' \
  -H 'Origin: https://your-site.web.app' \
  -H 'Access-Control-Request-Method: POST'
```

Expect `204` and an `access-control-allow-origin` line. If `X-Request-Id` is missing from a
response, it came from the platform edge, not your code — stop debugging your code.

---

## Calling it from a frontend

Non-streaming:

```js
const res = await fetch('https://your-api.vercel.app/api/chat/sync', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'What are his skills?' }),
});
const { text, offTopic } = await res.json();
```

Streaming:

```js
const res = await fetch('https://your-api.vercel.app/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: 'What are his skills?' }),
});

const reader = res.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  for (const line of decoder.decode(value).split('\n\n')) {
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice(6);
    if (payload === '[DONE]') return;
    const { text } = JSON.parse(payload);
    if (text) appendToBubble(text);   // your render function
  }
}
```

Build the URL without a trailing slash on the base — `base + '/api/chat'` where `base` ends
in `/` produces `//api/chat`, which Vercel answers with a `308` redirect that has no CORS
headers.

---

## Known limitations

- **No conversation memory.** Each request sends only the current message, so the bot cannot
  refer back to an earlier turn. Add a `history` array to the request and pass it through to
  `buildMessages` in `lib/chat.js` if you need it.
- **No rate limiting.** The endpoint is public and unauthenticated — anyone who views source
  on your site can call it and spend your quota. Add per-IP limiting before relying on it.
- **Free tiers are small.** Groq's free tier caps requests per minute; the limit surfaces as a
  generic error rather than a friendly "busy, try again".
- **`npm audit`** reports moderate advisories reaching `uuid` through `@google-cloud/storage`,
  a transitive dependency of `firebase-admin` that this code path does not use.

---

## Licence

ISC
