/**
 * fred-ai Gemini proxy — Cloudflare Worker
 * Forwards requests to Gemini API to bypass CORS (browser can't call Gemini directly).
 * Store GEMINI_API_KEY as a secret (dashboard or wrangler secret put).
 *
 * Optional: bind KV as RATE_LIMIT_KV (see worker/README) for daily caps.
 */

const GEMINI_MODEL_DEFAULT = 'gemini-2.5-flash';
/** Models the proxy may call; client may send { model } (stripped before forwarding to Gemini). */
const ALLOWED_GEMINI_MODELS = new Set([GEMINI_MODEL_DEFAULT]);

const MAX_BODY_BYTES = 96 * 1024;
const MAX_REQUESTS_GLOBAL_PER_DAY = 400;
const MAX_REQUESTS_PER_IP_PER_DAY = 40;

const ALLOWED_ORIGINS = new Set(['https://www.frederikniesner.com', 'https://frederikniesner.com']);

function corsOriginFor(request) {
  const o = request.headers.get('Origin');
  if (!o) return 'https://www.frederikniesner.com';
  if (ALLOWED_ORIGINS.has(o)) return o;
  return null;
}

function jsonHeaders(request, extra = {}) {
  const origin = corsOriginFor(request);
  if (!origin) return { 'Content-Type': 'application/json' };
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extra,
  };
}

/** @returns {Promise<Response|null>} error Response or null if OK */
async function enforceRateLimit(env, request) {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return null;

  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const gKey = `g:${day}`;
  const iKey = `i:${day}:${ip}`;

  const [gRaw, iRaw] = await Promise.all([kv.get(gKey), kv.get(iKey)]);
  const g = parseInt(gRaw || '0', 10);
  const i = parseInt(iRaw || '0', 10);

  if (g >= MAX_REQUESTS_GLOBAL_PER_DAY || i >= MAX_REQUESTS_PER_IP_PER_DAY) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again tomorrow.' }), {
      status: 429,
      headers: jsonHeaders(request),
    });
  }

  const ttl = 60 * 60 * 48;
  await Promise.all([kv.put(gKey, String(g + 1), { expirationTtl: ttl }), kv.put(iKey, String(i + 1), { expirationTtl: ttl })]);

  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      const origin = corsOriginFor(request);
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: jsonHeaders(request),
      });
    }

    const o = request.headers.get('Origin');
    if (o && !ALLOWED_ORIGINS.has(o)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const limited = await enforceRateLimit(env, request);
    if (limited) return limited;

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), {
        status: 500,
        headers: jsonHeaders(request),
      });
    }

    const cl = request.headers.get('Content-Length');
    if (cl != null && cl !== '') {
      const n = Number(cl);
      if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
        return new Response(JSON.stringify({ error: 'Request body too large' }), {
          status: 413,
          headers: jsonHeaders(request),
        });
      }
    }

    try {
      const buf = await request.arrayBuffer();
      if (buf.byteLength > MAX_BODY_BYTES) {
        return new Response(JSON.stringify({ error: 'Request body too large' }), {
          status: 413,
          headers: jsonHeaders(request),
        });
      }
      const body = JSON.parse(new TextDecoder().decode(buf));

      const requested = typeof body.model === 'string' ? body.model.trim() : '';
      const model = ALLOWED_GEMINI_MODELS.has(requested) ? requested : GEMINI_MODEL_DEFAULT;
      delete body.model;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      return new Response(JSON.stringify(data), {
        status: res.status,
        headers: jsonHeaders(request),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || 'Proxy error' }), {
        status: 500,
        headers: jsonHeaders(request),
      });
    }
  },
};
