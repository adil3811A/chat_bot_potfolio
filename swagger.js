import swaggerJsdoc from 'swagger-jsdoc';

const PORT = process.env.PORT || 3000;

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Portfolio Chatbot API',
      version: '1.0.0',
      description:
        'Groq-backed chat endpoint for Adil Ansari\'s portfolio site. ' +
        'Use **/api/chat/sync** to test from this page — **/api/chat** streams SSE, ' +
        'which Swagger UI buffers until the stream ends.',
    },
    servers: [{ url: `http://localhost:${PORT}`, description: 'Local dev' }],
    tags: [{ name: 'Chat', description: 'Portfolio assistant' }],
    components: {
      schemas: {
        ChatRequest: {
          type: 'object',
          required: ['message'],
          properties: {
            message: {
              type: 'string',
              description: 'The visitor\'s question.',
              example: 'What has Adil built recently?',
            },
          },
        },
        ChatResponse: {
          type: 'object',
          properties: {
            text: { type: 'string', example: 'Adil recently shipped PannaseCHE, a GATE exam-prep app...' },
            offTopic: {
              type: 'boolean',
              description: 'Present and true when the question was outside Adil\'s portfolio and was refused.',
              example: true,
            },
          },
        },
        Error: {
          type: 'object',
          properties: { error: { type: 'string' } },
        },
      },
      responses: {
        BadRequest: {
          description: 'Missing or empty `message`',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: 'Message payload is required' },
            },
          },
        },
        ServerError: {
          description: 'Upstream model call failed',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
              example: { error: 'Failed to fetch AI response' },
            },
          },
        },
      },
    },
  },
  // Scan the route files for @openapi JSDoc blocks
  apis: ['./api/*.js', './server.js'],
});
