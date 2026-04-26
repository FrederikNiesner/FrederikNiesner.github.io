/**
 * fred-ai Gemini proxy — Cloudflare Worker
 * Forwards requests to Gemini API to bypass CORS (browser can't call Gemini directly).
 * Store GEMINI_API_KEY as a secret (dashboard or wrangler secret put).
 *
 * System instruction + facts: KV binding FRED_CONTEXT_KV, key fred_context_md.
 * The browser must not control system_instruction (it is stripped and replaced here).
 *
 * Optional: bind KV as RATE_LIMIT_KV (see worker/README) for daily caps.
 */

const GEMINI_MODEL_DEFAULT = 'gemini-2.5-flash';
/** Models the proxy may call; client may send { model } (stripped before forwarding to Gemini). */
const ALLOWED_GEMINI_MODELS = new Set([GEMINI_MODEL_DEFAULT]);

/** KV key for full system instruction text (markdown). */
const CONTEXT_KV_KEY = 'fred_context_md';

const MAX_BODY_BYTES = 96 * 1024;
const MAX_REQUESTS_GLOBAL_PER_DAY = 400;
const MAX_REQUESTS_PER_IP_PER_DAY = 40;

/** Max chat turns stored in the client; older turns dropped before the API call. */
const MAX_CONTENT_MESSAGES = 20;
/** Longest single user/model text segment (defense-in-depth; client enforces the same). */
const MAX_TEXT_CHARS_PER_PART = 12_000;

const GEMINI_MAX_OUTPUT_TOKENS = 1024;
const GEMINI_TEMPERATURE = 0.45;
const GEMINI_TOP_P = 0.95;

const DEFAULT_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
];

const ALLOWED_ORIGINS = new Set(['https://www.frederikniesner.com', 'https://frederikniesner.com']);

/** In-memory cache to reduce KV reads (~5 min). */
let contextKvCache = { text: '', exp: 0 };
const CONTEXT_CACHE_MS = 5 * 60 * 1000;

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

/**
 * Load canonical system instruction (markdown) from KV.
 * @param {{ FRED_CONTEXT_KV?: KVNamespace; GEMINI_API_KEY?: string; RATE_LIMIT_KV?: KVNamespace }} env
 */
async function loadSystemInstructionText(env) {
  const kv = env.FRED_CONTEXT_KV;
  if (!kv) {
    throw new Error(
      'FRED_CONTEXT_KV is not bound. Add [[kv_namespaces]] for FRED_CONTEXT_KV in wrangler.toml and redeploy (see worker/README).'
    );
  }
  const now = Date.now();
  if (contextKvCache.text && now < contextKvCache.exp) {
    return contextKvCache.text;
  }
  const text = await kv.get(CONTEXT_KV_KEY, 'text');
  if (text == null || String(text).trim() === '') {
    throw new Error(
      `KV key "${CONTEXT_KV_KEY}" is empty. Upload: npx wrangler kv key put ${CONTEXT_KV_KEY} --path=../fred-context.local.md --binding=FRED_CONTEXT_KV (from worker/).`
    );
  }
  contextKvCache = { text: String(text), exp: now + CONTEXT_CACHE_MS };
  return contextKvCache.text;
}

/**
 * Accepts only `user` / `model` text turns; no tools, no inline data. Strips and rebuilds
 * a minimal request body so the client cannot override generationConfig, tools, or safety.
 * @param {unknown} raw
 * @returns {{ ok: true, contents: object[] } | { ok: false, error: string }}
 */
function sanitizeContentsForGemini(raw) {
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'Request must include a "contents" array' };
  }
  const windowed = raw.length > MAX_CONTENT_MESSAGES ? raw.slice(-MAX_CONTENT_MESSAGES) : raw;
  const out = [];
  for (let i = 0; i < windowed.length; i += 1) {
    const item = windowed[i];
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Invalid message in "contents"' };
    }
    const { role, parts } = item;
    if (role !== 'user' && role !== 'model') {
      return { ok: false, error: 'Each message must have role "user" or "model"' };
    }
    if (!Array.isArray(parts) || parts.length === 0) {
      return { ok: false, error: 'Each message must have a non-empty "parts" array' };
    }
    const newParts = [];
    for (const p of parts) {
      if (!p || typeof p !== 'object') {
        return { ok: false, error: 'Invalid part in a message' };
      }
      if (p.functionCall != null || p.functionResponse != null) {
        return { ok: false, error: 'Function calling is not supported' };
      }
      if (p.executableCode != null || p.codeExecutionResult != null) {
        return { ok: false, error: 'Code execution in chat is not supported' };
      }
      if (p.inlineData != null) {
        return { ok: false, error: 'Image or file attachments are not supported' };
      }
      if (p.text == null) {
        return { ok: false, error: 'Only text message parts are supported' };
      }
      let t = String(p.text);
      if (t.length > MAX_TEXT_CHARS_PER_PART) {
        t = t.slice(0, MAX_TEXT_CHARS_PER_PART);
      }
      if (t.length === 0) {
        return { ok: false, error: 'Text parts may not be empty' };
      }
      newParts.push({ text: t });
    }
    if (newParts.length === 0) {
      return { ok: false, error: 'Message has no text parts' };
    }
    out.push({ role, parts: newParts });
  }
  if (out.length === 0) {
    return { ok: false, error: 'No messages in "contents"' };
  }
  return { ok: true, contents: out };
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
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return new Response(JSON.stringify({ error: 'Request body must be a JSON object' }), {
          status: 400,
          headers: jsonHeaders(request),
        });
      }

      const requested = typeof body.model === 'string' ? body.model.trim() : '';
      const model = ALLOWED_GEMINI_MODELS.has(requested) ? requested : GEMINI_MODEL_DEFAULT;

      const rawContents = body.contents;
      const sanitized = sanitizeContentsForGemini(rawContents);
      if (!sanitized.ok) {
        return new Response(JSON.stringify({ error: sanitized.error || 'Invalid contents' }), {
          status: 400,
          headers: jsonHeaders(request),
        });
      }

      let systemText;
      try {
        systemText = await loadSystemInstructionText(env);
      } catch (ctxErr) {
        return new Response(JSON.stringify({ error: ctxErr.message || 'Context not available' }), {
          status: 503,
          headers: jsonHeaders(request),
        });
      }

      const geminiRequest = {
        contents: sanitized.contents,
        system_instruction: { parts: [{ text: systemText }] },
        generationConfig: {
          temperature: GEMINI_TEMPERATURE,
          topP: GEMINI_TOP_P,
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
        },
        safetySettings: DEFAULT_SAFETY_SETTINGS,
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiRequest),
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
