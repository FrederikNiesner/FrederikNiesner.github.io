# fred-ai Gemini Proxy (Cloudflare Worker)

The Gemini API blocks direct browser requests (CORS). This Worker proxies requests so your site can call Gemini from the frontend.

It also **injects the system instruction**: the browser sends only `contents` (chat turns). The full prompt lives in **Workers KV** (`fred_context_md`) so it is not shipped in the public git bundle or read from GitHub Pages.

## Request limits (Worker)

The proxy does **not** pass through arbitrary Gemini fields. The browser may send `model` and `contents` (text only). The Worker enforces: **CORS** allowlist, optional **rate limits** (if KV is bound), **max body 96 KB**, at most **20** chat messages, **12 000** characters per text part, and server-defined **`generationConfig`** and **`safetySettings`**. A short **`SYSTEM_SCOPE_PREFIX`** is always prepended to the KV text (not overridable from the site) so profile-only and no-weather / no–real-time data rules always apply. Sync client defaults with [`worker/index.js`](../worker/index.js) (constants at top).

## AI context (required: Workers KV)

Without this, chat returns **503** (“context not available”).

1. **Create a KV namespace** (once):
   ```bash
   cd worker
   npx wrangler kv namespace create fred-ai-context
   ```
2. **Uncomment** the `FRED_CONTEXT_KV` block in [`wrangler.toml`](wrangler.toml) and set `id` to the value Wrangler printed.
3. **Redeploy** the Worker (`npm run deploy`).
4. **Upload** your private markdown (maintain [`fred-context.local.md`](../fred-context.local.md) on your machine; it is gitignored):
   ```bash
   cd worker
   npx wrangler kv key put fred_context_md --path=../fred-context.local.md --binding=FRED_CONTEXT_KV
   ```
   After edits, run step 4 again to refresh KV (or use `wrangler kv key put` with `--path` whenever you change the file).

You can use a **second** KV namespace for rate limits (see below); keep both `[[kv_namespaces]]` entries in `wrangler.toml`.

## Deploy (one-time setup)

**Important:** Run these commands in your terminal (not via Cursor) so you can answer the interactive prompt.

1. **Register workers.dev subdomain** (one-time, ~30 seconds):
   - Open: https://dash.cloudflare.com → Workers & Pages → Overview
   - Click "Set up" or "Register subdomain" for workers.dev
   - Choose a subdomain (e.g. `yourname`) → you'll get `yourname.workers.dev`

2. **Deploy the Worker**:
   ```bash
   cd worker
   npm install
   npm run deploy
   ```
   When prompted "Would you like to register a workers.dev subdomain now?" type **y** and Enter (if you haven't done step 1).

3. **Add your Gemini API key**:
   ```bash
   npm run secret
   ```
   Paste your Gemini API key when prompted.

4. **Copy your Worker URL** — after deploy you'll see:
   ```
   https://fred-ai-proxy.YOUR-SUBDOMAIN.workers.dev
   ```

5. **Point the site at the Worker** — either:
   - In [index.html](../index.html), set `PROXY_URL_DEFAULT` to `https://fred-ai-proxy.YOUR-SUBDOMAIN.workers.dev`, or
   - One-time in the browser DevTools console on your site:  
     `localStorage.setItem('frederikniesner-ai-proxy-url','https://fred-ai-proxy.YOUR-SUBDOMAIN.workers.dev')`

### Deploy without browser login (CI or script)

Export a Cloudflare API token with **Workers Scripts: Edit** (and account read), then:

```bash
export CLOUDFLARE_API_TOKEN=your_token
export CLOUDFLARE_ACCOUNT_ID=your_account_id
npm run deploy
printf '%s' "your_gemini_key" | npx wrangler secret put GEMINI_API_KEY
```

### Deploy from GitHub Actions

Add these **repository secrets** (Settings → Secrets and variables → Actions):

| Secret | Purpose |
|--------|---------|
| `CLOUDFLARE_API_TOKEN` | Workers deploy |
| `CLOUDFLARE_ACCOUNT_ID` | Required with API token |
| `GEMINI_API_KEY` | Optional; if set, synced to the Worker on each workflow run |

Then open **Actions → Deploy fred-ai-proxy → Run workflow** (the workflow is manual-only so pushes stay green until secrets exist). After a successful run, update `PROXY_URL_DEFAULT` or `localStorage` as in step 5.

## Cost

Cloudflare Workers free tier: 100,000 requests/day.

## Staying on free tiers (personal site)

- **Gemini:** Prefer a Google AI Studio key on a project **without** pay-as-you-go billing, so quota exhaustion returns errors instead of unexpected charges. Check [Google AI pricing](https://ai.google.dev/pricing) from time to time.
- **Cloudflare Workers:** Typical portfolio traffic stays within the free tier; see [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). Optional **KV** used for rate limits has its own free allotment.
- **Abuse:** This Worker allows browser calls only from **frederikniesner.com** / **www**. Optional KV caps reduce quota burn if the Worker URL is shared.

## Rate limits (optional Workers KV)

Without KV, only **body size** (96 KB max) and **CORS** apply. To add **daily** caps (defaults: 400 global, 40 per IP, UTC day):

1. Create a namespace:
   ```bash
   cd worker
   npx wrangler kv namespace create fred-ai-rate-limit
   ```
2. Add to `wrangler.toml` (use the `id` Wrangler prints):
   ```toml
   [[kv_namespaces]]
   binding = "RATE_LIMIT_KV"
   id = "YOUR_NAMESPACE_ID"
   ```
3. Redeploy (GitHub Action or `npm run deploy`).

Tune limits by editing constants at the top of `index.js`.
