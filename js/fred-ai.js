/**
 * fred-ai — Personal AI assistant powered by Gemini 2.5 Flash
 * System instruction + facts are loaded in the Cloudflare Worker from KV (not from the browser).
 * This module maintains conversation history and calls the Worker only — never put a Gemini API key here.
 *
 * Proxy URL: set PROXY_URL_DEFAULT below, or override with
 * localStorage key frederikniesner-ai-proxy-url (https only), or window.__FRED_AI_PROXY_URL__ before this script loads.
 */

const PROXY_URL_DEFAULT = 'https://fred-ai-proxy.frederik-niesner.workers.dev';

const conversationHistory = [];

function resolveProxyUrl() {
  if (typeof window !== 'undefined' && window.__FRED_AI_PROXY_URL__) {
    const w = String(window.__FRED_AI_PROXY_URL__).trim();
    if (/^https:\/\//i.test(w)) return w;
  }
  try {
    const u = localStorage.getItem('frederikniesner-ai-proxy-url');
    if (u) {
      const t = String(u).trim();
      if (/^https:\/\//i.test(t)) return t;
    }
  } catch (e) {
    /* ignore */
  }
  return PROXY_URL_DEFAULT;
}

function proxyReady() {
  const u = resolveProxyUrl();
  return Boolean(u && !/FILL-IN/i.test(u));
}

function buildContents(userQuestion) {
  const contents = [];
  for (const msg of conversationHistory) {
    contents.push({
      role: msg.role,
      parts: [{ text: msg.text }],
    });
  }
  contents.push({
    role: 'user',
    parts: [{ text: userQuestion }],
  });
  return contents;
}

function getSelectedModel() {
  const sel = document.getElementById('ai-model');
  const v = sel && sel.value ? String(sel.value).trim() : '';
  return v || 'gemini-2.5-flash';
}

function parseGeminiResponse(res, raw) {
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    const snippet = raw && raw.slice ? raw.slice(0, 120).replace(/\s+/g, ' ') : '';
    throw new Error(snippet ? 'Bad response from assistant.' : 'Could not read assistant response.');
  }
  if (!res.ok) {
    const msg =
      (data &&
        data.error &&
        (typeof data.error === 'string' ? data.error : data.error.message)) ||
      `Request failed${res.status ? ` (${res.status})` : ''}`;
    throw new Error(msg);
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (text == null || String(text).trim() === '') {
    throw new Error('The assistant returned an empty reply.');
  }
  return String(text);
}

async function askGemini(userQuestion) {
  const proxyUrl = resolveProxyUrl();
  const body = {
    model: getSelectedModel(),
    contents: buildContents(userQuestion),
  };

  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  return parseGeminiResponse(res, raw);
}

function appendMessage(role, text, isLoading = false, isError = false) {
  const container = document.getElementById('ai-conversation');
  if (!container) return null;

  const div = document.createElement('div');
  div.className = `ai-message ai-message-${role}${isLoading ? ' ai-loading' : ''}${isError ? ' ai-message-error' : ''}`;
  div.textContent = text || 'Thinking...';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function setLoading(loading) {
  const input = document.getElementById('ai-input');
  const submit = document.getElementById('ai-submit');
  const modelSel = document.getElementById('ai-model');
  if (input) input.disabled = loading;
  if (submit) submit.disabled = loading;
  if (modelSel) modelSel.disabled = loading;
}

function showModelError(loadingEl, err) {
  const detail = err && err.message ? String(err.message) : 'Unknown error';
  const msg = `Sorry, something went wrong. ${detail}`;
  if (loadingEl) {
    loadingEl.textContent = msg;
    loadingEl.classList.remove('ai-loading');
    loadingEl.classList.add('ai-message-error');
  } else {
    appendMessage('model', msg, false, true);
  }
}

async function handleSubmit(e) {
  e.preventDefault();
  e.stopPropagation();
  const input = document.getElementById('ai-input');
  const container = document.getElementById('ai-conversation');
  if (!input || !container) return;

  const question = (input.value || '').trim();
  if (!question) return;

  if (!proxyReady()) {
    conversationHistory.push({ role: 'user', text: question });
    appendMessage('user', question);
    const stub = appendMessage('model', 'Thinking...', true);
    showModelError(
      stub,
      new Error(
        'Assistant is not configured yet: set PROXY_URL_DEFAULT in js/fred-ai.js or localStorage key frederikniesner-ai-proxy-url (see worker/README).'
      )
    );
    input.value = '';
    container.scrollTop = container.scrollHeight;
    return;
  }

  input.value = '';
  conversationHistory.push({ role: 'user', text: question });
  appendMessage('user', question);

  const loadingEl = appendMessage('model', 'Thinking...', true);
  setLoading(true);

  try {
    const answer = await askGemini(question);
    conversationHistory.push({ role: 'model', text: answer });
    if (loadingEl) {
      loadingEl.textContent = answer;
      loadingEl.classList.remove('ai-loading');
      loadingEl.classList.remove('ai-message-error');
    }
    if (typeof gtag === 'function') gtag('event', 'ai_reply_success');
  } catch (err) {
    showModelError(loadingEl, err);
  } finally {
    setLoading(false);
    container.scrollTop = container.scrollHeight;
  }
}

function init() {
  const form = document.getElementById('ai-form');
  const submit = document.getElementById('ai-submit');

  if (submit) {
    submit.addEventListener('click', (e) => {
      e.preventDefault();
      handleSubmit(e);
    });
  }
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      handleSubmit(e);
    });
  }
  const input = document.getElementById('ai-input');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      e.preventDefault();
      handleSubmit(e);
    });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
