// Tiny leveled logger — timestamps, colors, and a per-request id so a single
// chat call can be traced across all the lines it emits.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const THRESHOLD = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

const COLORS = {
  debug: '\x1b[90m', // grey
  info: '\x1b[36m',  // cyan
  warn: '\x1b[33m',  // yellow
  error: '\x1b[31m', // red
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (color, text) => (useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text);

const stamp = () => new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm

// Render trailing key=value context, e.g. ms=412 chunks=7
function fields(obj) {
  if (!obj || Object.keys(obj).length === 0) return '';
  const parts = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === 'string' && v.includes(' ') ? JSON.stringify(v) : v}`);
  return parts.length ? ' ' + paint('dim', parts.join(' ')) : '';
}

function emit(level, scope, msg, ctx) {
  if (LEVELS[level] < THRESHOLD) return;
  const line = `${paint('dim', stamp())} ${paint(level, level.toUpperCase().padEnd(5))} ${paint('dim', `[${scope}]`)} ${msg}${fields(ctx)}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export function createLogger(scope = 'app') {
  return {
    debug: (msg, ctx) => emit('debug', scope, msg, ctx),
    info: (msg, ctx) => emit('info', scope, msg, ctx),
    warn: (msg, ctx) => emit('warn', scope, msg, ctx),
    error: (msg, ctx) => emit('error', scope, msg, ctx),
    // Narrow the scope, e.g. log.child('a1b2c3') → [chat:a1b2c3]
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

// Shorten a user prompt so logs stay one line each.
export const preview = (text, max = 80) => {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export default createLogger();
