import { getApps, initializeApp, applicationDefault, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createLogger } from '../logger.js';

const log = createLogger('career');

// portfolio/career_details — the doc holding the metrics that change often
// enough not to belong in a hardcoded prompt.
const COLLECTION = process.env.FIRESTORE_COLLECTION || 'portfolio';
const DOCUMENT = process.env.FIRESTORE_DOCUMENT || 'career_details';

// Firestore is billed per read and adds latency to every single chat message,
// so the doc is cached and refreshed at most this often.
const CACHE_TTL_MS = Number(process.env.CAREER_CACHE_TTL_MS ?? 5 * 60 * 1000);

let db = null;
let initFailed = false;

/**
 * Credentials, in order of preference:
 *   1. FIREBASE_SERVICE_ACCOUNT — the service-account JSON as a single string.
 *      Use this on Vercel, where there is no filesystem to drop a key file on.
 *   2. GOOGLE_APPLICATION_CREDENTIALS — path to that JSON file (local dev).
 *   3. The runtime's own service account (Cloud Run / Firebase Functions),
 *      where applicationDefault() resolves with nothing configured.
 */
function resolveCredential() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    return { credential: cert(JSON.parse(inline)), source: 'FIREBASE_SERVICE_ACCOUNT' };
  }
  return {
    credential: applicationDefault(),
    source: process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? 'GOOGLE_APPLICATION_CREDENTIALS'
      : 'runtime default',
  };
}

/**
 * Connect to Firestore on first use. A failure here is logged once and is then
 * permanent for the process — the chat endpoint keeps working, just without
 * live metrics.
 */
function getDb() {
  if (db || initFailed) return db;
  try {
    // NB: the legacy `admin.apps` namespace is undefined under ESM in
    // firebase-admin v14 — getApps() is the supported check.
    if (getApps().length === 0) {
      const { credential, source } = resolveCredential();
      initializeApp({ credential, projectId: process.env.FIREBASE_PROJECT_ID || undefined });
      log.debug('Firebase app initialised', { credentials: source });
    }
    db = getFirestore();
    log.info('Firestore connected', { doc: `${COLLECTION}/${DOCUMENT}` });
  } catch (error) {
    initFailed = true;
    log.warn('Firestore unavailable — answering without live career metrics', {
      err: error.message,
    });
  }
  return db;
}

let cache = { value: null, expiresAt: 0 };
let inFlight = null; // collapses concurrent refreshes into one read

export function formatCareerData(data) {
  // Only emit lines the document actually carries. A missing field should make
  // the bot say it doesn't know, not state a default as though it were fact.
  const rows = [
    ['Current Employment Status', data.status],
    ['Notice Period', data.noticePeriod],
    ['Current CTC', data.currentCTC],
    ['Expected CTC', data.expectedCTC],
    ['Open To', data.openTo],
    ['Last Updated', data.updatedAt?.toDate?.().toISOString().slice(0, 10)],
  ].filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '');

  if (rows.length === 0) return null;
  return rows.map(([label, value]) => `- ${label}: ${value}`).join('\n');
}

async function fetchFresh() {
  const firestore = getDb();
  if (!firestore) return null;

  const started = Date.now();
  try {
    const doc = await firestore.collection(COLLECTION).doc(DOCUMENT).get();
    if (!doc.exists) {
      log.warn('Career doc missing', { doc: `${COLLECTION}/${DOCUMENT}` });
      return null;
    }
    const block = formatCareerData(doc.data() ?? {});
    log.info('Career metrics refreshed', { ms: Date.now() - started, fields: block ? block.split('\n').length : 0 });
    return block;
  } catch (error) {
    // Never let a database problem take down the chat endpoint.
    log.error('Career fetch failed — serving without live metrics', {
      ms: Date.now() - started,
      err: error.message,
    });
    return null;
  }
}

/**
 * Cached career metrics, formatted for the prompt. Returns null when Firestore
 * is unreachable, unconfigured, or the doc is empty — callers should simply
 * omit the section in that case.
 */
export async function getCareerData() {
  if (Date.now() < cache.expiresAt) return cache.value;
  if (inFlight) return inFlight;

  inFlight = fetchFresh()
    .then((value) => {
      // Cache misses too, so an outage doesn't mean a Firestore call per message.
      cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Drop the cache so the next request re-reads Firestore. */
export function invalidateCareerCache() {
  cache = { value: null, expiresAt: 0 };
  log.info('Career cache invalidated');
}
