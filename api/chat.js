import { GoogleGenAI } from '@google/genai';
import { createLogger, preview } from '../logger.js';

const log = createLogger('chat');

// Initialize the Google Gen AI client (reads GEMINI_API_KEY from environment)
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

// Embed your personal details directly into the system instruction
const SYSTEM_INSTRUCTION = `
You are an AI assistant representing Adil Ansari, a mobile app developer, on his personal portfolio website. Recruiters, hiring managers, and potential clients will ask you questions about his work, skills, and experience.

TONE & BEHAVIOR RULES:
- Speak about Adil in the third person ("Adil has...", "He built..."), not as Adil himself.
- Keep answers punchy and conversational — 2-4 sentences for most questions, longer only if the question genuinely needs detail.
- Be confident but honest — never invent experience, years, job titles, or numbers not listed below.
- If asked something not covered in this data, say you don't have that info and suggest they contact Adil directly.
- If asked an unrelated/off-topic question, politely redirect back to Adil's career.

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

const generationConfig = { systemInstruction: SYSTEM_INSTRUCTION };

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
  // 1. Enable CORS so your Jaspr static site can call this endpoint
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  // Client closed the tab mid-answer — worth knowing, since the Gemini call
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
    // 3. Request a streaming response from Gemini 2.5 Flash
    const responseStream = await ai.models.generateContentStream({
      model: MODEL,
      contents: message,
      config: generationConfig,
    });

    // 4. Iterate over chunks as they arrive from Google and push them to your app
    rlog.debug('Upstream connected', { ms: Date.now() - startedAt });

    for await (const chunk of responseStream) {
      if (chunk.text) {
        if (chunks === 0) rlog.debug('First chunk', { ms: Date.now() - startedAt });
        chunks += 1;
        chars += chunk.text.length;
        // Formatting as data: { "text": "..." }\n\n to comply with standard event streams
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    rlog.info('Stream finished', { ms: Date.now() - startedAt, chunks, chars });
  } catch (error) {
    rlog.error('Gemini stream failed', {
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
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: message,
      config: generationConfig,
    });
    const usage = response.usageMetadata ?? {};
    rlog.info('Replied', {
      ms: Date.now() - startedAt,
      chars: response.text?.length ?? 0,
      promptTokens: usage.promptTokenCount,
      outputTokens: usage.candidatesTokenCount,
      totalTokens: usage.totalTokenCount,
    });
    rlog.debug(`Reply: ${preview(response.text ?? '')}`);
    return res.json({ text: response.text });
  } catch (error) {
    rlog.error('Gemini call failed', {
      ms: Date.now() - startedAt,
      status: error.status,
      err: error.message,
    });
    return res
      .status(error.status ?? 500)
      .json({ error: 'Failed to fetch AI response', detail: error.message });
  }
}
