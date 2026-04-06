# fred-ai Gemini Proxy (Cloudflare Worker)

The Gemini API blocks direct browser requests (CORS). This Worker proxies requests so your site can call Gemini from the frontend.

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
