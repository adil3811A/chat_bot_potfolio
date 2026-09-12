import 'dotenv/config'; // must run before anything reads process.env

import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { randomUUID } from 'node:crypto';

import chatHandler, { syncHandler } from './api/chat.js';
import { swaggerSpec } from './swagger.js';
import { createLogger } from './logger.js';

const log = createLogger('server');
const http = createLogger('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Tag every request so its log lines can be tied together, and echo the id
// back in a header to make a failing Swagger call easy to find in the console.
app.use((req, res, next) => {
  req.id = randomUUID().slice(0, 8);
  res.setHeader('X-Request-Id', req.id);
  next();
});

// HTTP access log. Swagger UI pulls in ~40 static assets per page load, so
// those are skipped to keep the console readable.
morgan.token('id', (req) => req.id);
app.use(
  morgan(':id :method :url :status :res[content-length] - :response-time ms', {
    skip: (req) => req.path.startsWith('/docs') && req.path !== '/docs/',
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
  res.json({ status: 'ok', hasApiKey: Boolean(process.env.GEMINI_API_KEY) })
);

// Routes
app.post('/api/chat', chatHandler);
app.options('/api/chat', chatHandler);
app.post('/api/chat/sync', syncHandler);

// Swagger UI + raw spec
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Portfolio Chatbot API',
}));
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
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    logLevel: process.env.LOG_LEVEL || 'info',
    apiKey: process.env.GEMINI_API_KEY ? 'set' : 'MISSING',
  });
  if (!process.env.GEMINI_API_KEY) {
    log.warn('GEMINI_API_KEY is not set — calls to Gemini will fail');
  }
});

process.on('unhandledRejection', (reason) =>
  log.error('Unhandled promise rejection', { reason: String(reason) })
);
