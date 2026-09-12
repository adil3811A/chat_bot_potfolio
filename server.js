import 'dotenv/config'; // must run before anything reads process.env

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { randomUUID } from 'node:crypto';

import chatHandler, { syncHandler, MODEL, API_KEY } from './api/chat.js';
import { swaggerSpec } from './swagger.js';
import { docsHtml, SWAGGER_UI_VERSION } from './docs.js';
import { createLogger } from './logger.js';

const log = createLogger('server');
const http = createLogger('http');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Only these origins may call the API from a browser. Override in .env with a
// comma-separated ALLOWED_ORIGINS list.
const CONFIGURED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim().replace(/\/$/, '')).filter(Boolean)
  : [
      'https://adil-ansari-portfolio-web.web.app',
      'https://adil-ansari-portfolio-web.firebaseapp.com',
      // 'http://localhost:8000',
    ];

// Swagger UI is served from this same server, and browsers send an Origin
// header even on same-origin POSTs — so "Try it out" needs its own origin
// allowed. Dev only; never added in production.
const SELF_ORIGINS = IS_PROD ? [] : [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
const ALLOWED_ORIGINS = [...new Set([...CONFIGURED_ORIGINS, ...SELF_ORIGINS])];

const isAllowed = (origin) => ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''));

app.use(
  cors({
    origin(origin, callback) {
      // No Origin header = not a browser (curl, Postman, server-to-server).
      // Those aren't bound by the same-origin policy at all, so CORS cannot
      // restrict them; add a shared secret if the endpoint needs real gating.
      if (!origin) return callback(null, true);
      callback(null, isAllowed(origin));
    },
    methods: ['POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
    maxAge: 86400, // cache the preflight for a day
  })
);
app.use(express.json());

// Tag every request so its log lines can be tied together, and echo the id
// back in a header to make a failing Swagger call easy to find in the console.
app.use((req, res, next) => {
  req.id = randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  next();
});

// HTTP access log. Swagger UI's own assets come from the CDN, so nothing
// needs filtering here any more.
morgan.token('id', (req) => req.id);
app.use(
  morgan(':id :method :url :status :res[content-length] - :response-time ms', {
    stream: { write: (line) => http.info(line.trim()) },
  })
);

/**
 * @openapi
 * /health:
 *   get:
 *     tags: [Chat]
 *     summary: Liveness check
 *     responses:
 *       200:
 *         description: Server is up
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status: { type: string, example: ok }
 *                 hasApiKey: { type: boolean, example: true }
 */
app.get('/health', (_req, res) =>
  res.json({ status: 'ok', hasApiKey: Boolean(API_KEY) })
);

// A browser would discard a disallowed response anyway, but the request would
// still have hit the model and burned tokens first — so block it up front.
app.use('/api', (req, res, next) => {
  const origin = req.get('origin');
  if (origin && !isAllowed(origin)) {
    log.warn('Blocked request from disallowed origin', { id: req.id, origin, path: req.path });
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  next();
});

// Routes
app.post('/api/chat', chatHandler);
app.post('/api/chat/sync', syncHandler);

// Swagger UI (assets from CDN) + the raw spec it fetches
app.get('/docs', (_req, res) =>
  res.type('html').send(docsHtml({ title: 'Portfolio Chatbot API', specUrl: '/openapi.json' }))
);
app.get('/openapi.json', (_req, res) => res.json(swaggerSpec));

app.get('/', (_req, res) => res.redirect('/docs'));

// Catch-all error handler — without this Express swallows async throws silently.
app.use((err, req, res, _next) => {
  log.error('Unhandled request error', { id: req.id, path: req.path, err: err.message });
  if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  log.info(`API     → http://localhost:${PORT}`);
  log.info(`Swagger → http://localhost:${PORT}/docs`);
  log.info('Config', {
    model: MODEL,
    logLevel: process.env.LOG_LEVEL || 'info',
    apiKey: API_KEY ? 'set' : 'MISSING',
    swaggerUi: SWAGGER_UI_VERSION,
  });
  log.info('Allowed origins', { origins: ALLOWED_ORIGINS.join(' ') });
  if (!API_KEY) {
    log.warn('GROQ_API_KEY is not set — model calls will fail');
  }
});

process.on('unhandledRejection', (reason) =>
  log.error('Unhandled promise rejection', { reason: String(reason) })
);
