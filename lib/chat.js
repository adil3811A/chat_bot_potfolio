import Groq from 'groq-sdk';
import { createLogger, preview } from '../logger.js';
import { getCareerData } from './careerData.js';

const log = createLogger('chat');

// Groq (console.groq.com) — an inference platform serving open models.
// Not to be confused with xAI's Grok, which is a different product entirely.
export const API_KEY = process.env.GROQ_API_KEY;
const groq = new Groq({ apiKey: API_KEY });

export const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';

// The model emits this exact token instead of answering an off-topic prompt.
// It is a control signal, never shown to the visitor — it gets swapped for
// OFF_TOPIC_REPLY below.
const SENTINEL = 'OFF_TOPIC';
const OFF_TOPIC_REPLY = "I can only answer questions related to Adil Ansari's portfolio.";

// Embed your personal details directly into the system instruction
const SYSTEM_INSTRUCTION = `
You are an AI assistant representing Adil Ansari, a mobile app developer, on his personal portfolio website. Recruiters, hiring managers, and potential clients will ask you questions about his work, skills, and experience.

TONE & BEHAVIOR RULES:
- Speak about Adil in the third person ("Adil has...", "He built..."), not as Adil himself.
- Keep answers punchy and conversational — 2-4 sentences for most questions, longer only if the question genuinely needs detail.
- Be confident but honest — never invent experience, years, job titles, or numbers not listed below.
- If asked something not covered in this data, say you don't have that info and suggest they contact Adil directly.

CRITICAL RULE:
You may ONLY answer questions about Adil — his career, skills, projects, education and contact details.
If the user asks anything off-topic, asks you to write code, write essays, translate, do maths, roleplay,
or perform any general-purpose task, you MUST reply with EXACTLY this and nothing else:
OFF_TOPIC
No preamble, no apology, no punctuation, no explanation — just that one word.

=== ADIL'S PROFILE ===
Name: Adil Ansari
Location: Thane, Maharashtra, India
Role: Mobile App Developer (Application Development Engineer)
Experience: ~1 year professional (since Sept 2025) + an Android internship (Dec 2024 – Feb 2025)
Contact: ansari89561@gmail.com | +91 97654 91703
Currently: Open to full-time Flutter/Dart roles and freelance work.

=== CURRENT ROLE ===
Application Development Engineer — Codes 'n' Coffee Tech (Sept 2025–Present)
- Maintains 5 live production Flutter apps for client Pressfit Electrical Solutions.
- Independently built & published PannaseCHE (GATE exam-prep app) end-to-end — live on Play Store & App Store, 500+ downloads. Features: practice questions, timed mock tests, performance analytics.
- Integrated JustPay payment gateway via HDFC HyperSDK for secure in-app payments.
- Built a CI/CD pipeline (GitHub Actions) automating Android/iOS builds and Play Store/TestFlight deployment.
- Leading a legacy native Android app rewrite into React Native.

=== PRIOR EXPERIENCE ===
Android Developer Intern — Horyzen (Dec 2024–Feb 2025): navigation flows, secure auth, REST API integration for a high-traffic social app.

=== SKILLS ===
Flutter, Dart, Kotlin/Java, Jetpack Compose, Bloc/Riverpod/GetX, MVVM/Clean Architecture, REST APIs, Firebase, Retrofit, Room/SQLite, Git/GitHub Actions CI/CD, Play Store/App Store deployment.

=== EDUCATION ===
Bachelor's in Software Development — TISS, Mumbai (2022–2025)
`;

/**
 * The prompt is assembled per request because the career metrics come from
 * Firestore and change without a redeploy. When the DB is unreachable the
 * section is left out entirely, so the bot falls back to "I don't have that
 * info" rather than reciting stale numbers.
 */
async function buildMessages(rlog, message) {
  const liveCareerData = await getCareerData();

  let systemPrompt = SYSTEM_INSTRUCTION;
  if (!liveCareerData) {
    rlog.debug('No live career metrics — using static profile only');
  } else {
    systemPrompt = `${SYSTEM_INSTRUCTION}

=== LIVE CAREER METRICS (from database — authoritative, overrides anything above) ===
${liveCareerData}

Use these figures verbatim when asked about availability, notice period, or compensation.
If a figure is not listed here, say you don't have it and point them to Adil directly —
never estimate or infer it.`;
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: message },
  ];
}

/**
 * @openapi
 * /api/chat:
 *   post:
 *     tags: [Chat]
 *     summary: Ask the portfolio bot (streaming, Server-Sent Events)
 *     description: >
 *       Streams the answer back as SSE frames shaped `data: {"text":"..."}`.
 *       Swagger UI cannot render a live stream — it shows the whole body once
 *       the stream closes. Use `/api/chat/sync` for a plain JSON reply.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *     responses:
 *       200:
 *         description: SSE stream of text chunks
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: |
 *                 data: {"text":"Adil is a mobile app developer "}
 *
 *                 data: {"text":"based in Thane, India."}
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       405:
 *         description: Method not allowed
 */
export default async function handler(req, res) {
  // CORS (including the preflight) is handled by the allowlist middleware in
  // server.js — setting headers here too would override it with a wildcard.
  const rlog = log.child(req.id ?? 'stream');

  const { message } = req.body ?? {};
  if (!message) {
    rlog.warn('Rejected: no message in body');
    return res.status(400).json({ error: 'Message payload is required' });
  }

  const startedAt = Date.now();
  let chunks = 0;
  let chars = 0;
  rlog.info('Stream started', { model: MODEL, chars: message.length });
  rlog.debug(`Prompt: ${preview(message)}`);

  // Client closed the tab mid-answer — worth knowing, since the upstream call
  // is already billed by then.
  req.on('aborted', () =>
    rlog.warn('Client aborted', { ms: Date.now() - startedAt, chunks })
  );

  // 2. Set headers for Server-Sent Events (Streaming)
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    // 3. Request a streaming completion from Groq
    const responseStream = await groq.chat.completions.create({
      model: MODEL,
      messages: await buildMessages(rlog, message),
      stream: true,
    });

    // 4. Iterate over chunks as they arrive and push them to your app
    rlog.debug('Upstream connected', { ms: Date.now() - startedAt });

    // Formatting as data: { "text": "..." }\n\n to comply with standard event streams
    const send = (text) => {
      chunks += 1;
      chars += text.length;
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    };

    // Hold back the opening characters until we know whether they are the
    // SENTINEL. The model streams token by token, so "OFF_TOPIC" can arrive
    // split as "OFF" + "_TOP" + "IC" — testing each chunk on its own would
    // leak those fragments to the visitor before the third one gives it away.
    let gate = '';
    let gateOpen = false;

    for await (const chunk of responseStream) {
      const text = chunk.choices[0]?.delta?.content;
      if (!text) continue;
      if (chunks === 0 && !gate) rlog.debug('First chunk', { ms: Date.now() - startedAt });

      if (gateOpen) {
        send(text);
        continue;
      }

      gate += text;
      const probe = gate.trimStart();

      if (probe.startsWith(SENTINEL)) {
        rlog.info('Off-topic prompt refused', { ms: Date.now() - startedAt });
        res.write(`data: ${JSON.stringify({ text: OFF_TOPIC_REPLY, offTopic: true })}\n\n`);
        res.write('data: [DONE]\n\n');
        return; // finally{} closes the response; the generator is disposed with it
      }

      // Still a possible prefix of the sentinel ("OFF", "OFF_TO"…) — keep waiting.
      if (probe.length < SENTINEL.length && SENTINEL.startsWith(probe)) continue;

      gateOpen = true;
      send(gate);
      gate = '';
    }

    // Stream ended while still buffering (a reply shorter than the sentinel).
    if (!gateOpen && gate) send(gate);

    res.write('data: [DONE]\n\n');
    rlog.info('Stream finished', { ms: Date.now() - startedAt, chunks, chars });
  } catch (error) {
    rlog.error('Groq stream failed', {
      ms: Date.now() - startedAt,
      chunks,
      status: error.status,
      err: error.message,
    });
    res.write(`data: ${JSON.stringify({ error: 'Failed to fetch AI response', detail: error.message })}\n\n`);
  } finally {
    res.end(); // Safely shut down the connection stream
  }
}

/**
 * @openapi
 * /api/chat/sync:
 *   post:
 *     tags: [Chat]
 *     summary: Ask the portfolio bot (single JSON reply)
 *     description: Same prompt and system instruction, but waits for the full answer. Easiest way to test from Swagger UI.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatRequest'
 *     responses:
 *       200:
 *         description: The bot's answer
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatResponse'
 *             examples:
 *               onTopic:
 *                 summary: A question about Adil
 *                 value: { text: "Adil is a mobile app developer based in Thane, India." }
 *               offTopic:
 *                 summary: Anything else — refused
 *                 value: { text: "I can only answer questions related to Adil Ansari's portfolio.", offTopic: true }
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
export async function syncHandler(req, res) {
  const rlog = log.child(req.id ?? 'sync');

  const { message } = req.body ?? {};
  if (!message) {
    rlog.warn('Rejected: no message in body');
    return res.status(400).json({ error: 'Message payload is required' });
  }

  const startedAt = Date.now();
  rlog.info('Request received', { model: MODEL, chars: message.length });
  rlog.debug(`Prompt: ${preview(message)}`);

  try {
    const completion = await groq.chat.completions.create({
      model: MODEL,
      messages: await buildMessages(rlog, message),
    });

    const text = completion.choices[0]?.message?.content ?? '';
    const usage = completion.usage ?? {};

    if (text.trimStart().startsWith(SENTINEL)) {
      rlog.info('Off-topic prompt refused', { ms: Date.now() - startedAt });
      return res.json({ text: OFF_TOPIC_REPLY, offTopic: true });
    }

    rlog.info('Replied', {
      ms: Date.now() - startedAt,
      chars: text.length,
      promptTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    });
    rlog.debug(`Reply: ${preview(text)}`);
    return res.json({ text });
  } catch (error) {
    rlog.error('Groq call failed', {
      ms: Date.now() - startedAt,
      status: error.status,
      err: error.message,
    });
    return res
      .status(error.status ?? 500)
      .json({ error: 'Failed to fetch AI response', detail: error.message });
  }
}
