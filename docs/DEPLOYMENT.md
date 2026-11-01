# Deployment

## Hosting target

Netlify is the production target: the handlers are already Netlify Functions, the free plan
permits commercial use, and its synchronous functions now default to a 60 s timeout, which is
what the AI and research routes need. The trade-off is the credit budget — the free plan has
300 credits a month and the site pauses when they run out (bandwidth costs 20 credits per GB,
function compute 10 credits per GB-hour), so heavy AI traffic means watching the meter.

Vercel is used for preview and testing only. `vercel.json` and the `vercel/` dispatcher exist so
the same commit runs there, but the Hobby plan is restricted to non-commercial personal use and
caps a deployment at 12 Serverless Functions — see
[`docs/VERCEL_DEPLOYMENT.md`](VERCEL_DEPLOYMENT.md) for how that limit is worked around and for
the measured limits of the other free hosts.

## Netlify

The repository is ready for a standard Netlify build; no adapter is required.

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Publish directory | `dist` |
| Functions directory | `netlify/functions` |
| Node version | 22 (from `netlify.toml`) |
| Bundler | esbuild |

`npm run build` runs `tsc --noEmit` first, so a type error fails the deploy.

### Functions are flat — this matters

Netlify does not expose nested directories as nested routes. All handlers are flat
files (`ai-models.ts`, `net-tls.ts`, ...) and public URLs are mapped explicitly in
`netlify.toml`:

```
/api/ai/models  -> /.netlify/functions/ai-models
/api/ai/test    -> /.netlify/functions/ai-test
/api/ai/chat    -> /.netlify/functions/ai-chat
/api/ai/analyze -> /.netlify/functions/ai-analyze
/api/ai/script  -> /.netlify/functions/ai-script
/api/net/dns    -> /.netlify/functions/net-dns
/api/net/tls    -> /.netlify/functions/net-tls
/api/*          -> /.netlify/functions/:splat
/*              -> /index.html
```

Specific rules must stay above the wildcard. Do not reintroduce nested folders.

## Environment variables

Set these in **Site configuration → Environment variables**. Only server-side
variables belong here; never prefix secrets with `VITE_`.

### Required for AI

| Variable | Example | Notes |
| --- | --- | --- |
| `AI_PROVIDER` | `openrouter` | `openai`, `anthropic`, `gemini`, `openrouter`, `ollama`, `custom` |
| `AI_BASE_URL` | `https://openrouter.ai/api/v1` | API base, not an endpoint |
| `AI_MODEL` | `openai/gpt-4.1-mini` | Exact provider model ID |
| `AI_API_KEY` | `sk-or-v1-...` | Secret |
| `AI_FALLBACK_MODEL` | optional | Used only for missing/unsupported primary models |

### Required for accounts

| Variable | Example | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | `https://project.supabase.co` | Project URL |
| `SUPABASE_ANON_KEY` | `eyJ...` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Server-only; bypasses RLS |
| `NEXORA_SITE_URL` | `https://adnan-tech.netlify.app` | Used in auth redirects |
| `NEXORA_HASH_PEPPER` | 32+ random bytes | Trial claim HMAC; keep stable. Required — with it unset the server refuses to hash an email and grants no new trial |
| `OWNER_EMAIL` | `owner@example.com` | Optional verified owner address. Never grants a role automatically; run `npm run owner:promote` after verification. |
| `ADMIN_EMAIL` | `admin@example.com` | Optional verified platform-administrator address. Never grants a role automatically; run `npm run admin:promote` (or `npm run super-admin:promote` for the legacy role). |
| `NEXORA_TRIAL_DAYS` | `30` | Clamped to 1–365 |
| `NEXORA_MAINTENANCE_MODE` | `false` | Optional maintenance flag |

Apply `supabase/migrations/0001_nexora.sql` and then
`supabase/migrations/0002_nexora_owner_admin_roles.sql` before enabling accounts, then
configure the Supabase Auth site URL and email templates documented in
[`ADNAN_TECH_AUTH_AND_RBAC.md`](ADNAN_TECH_AUTH_AND_RBAC.md).

### Optional

| Variable | Default | Notes |
| --- | --- | --- |
| `AI_APP_REFERER` | `https://adnan-tech.netlify.app` | OpenRouter attribution |
| `AI_APP_TITLE` | `Adnan Tech` | OpenRouter attribution |
| `AI_VISION_PROVIDER` / `AI_VISION_BASE_URL` / `AI_VISION_MODEL` / `AI_VISION_API_KEY` | – | Separate vision provider |
| `AI_ALLOWED_HOSTS` | – | Extra hostnames or `.suffix` entries for custom providers |
| `ALLOW_LOCAL_AI` | `false` | Allow `http://localhost` (Ollama); keep `false` in production |
| `NET_PROBE_ALLOW_PRIVATE` | `false` | Lets port/latency/path probes aim at LAN addresses. Local or trusted self-hosted only |
| `PRINTER_ALLOW_PRIVATE` / `PRINTER_ALLOW_PUBLIC` | `false` | Both printer probe policies are opt-in; private is additionally implied when running locally |
| `AI_TIMEOUT_MS` | `60000` | Upstream timeout |
| `AI_MAX_OUTPUT_TOKENS` | `2500` | Completion cap |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | `60000` / `20` | Per-client rate limit |
| `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` | – | Research providers |
| `NEWS_FEEDS` | – | Comma-separated feeds that replace the defaults |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | – | Optional persistence; service key is server-only |
| `CONTENT_ADMIN_TOKEN` | – | Required by every `/api/content/admin` method — read, write and delete |
| `LOG_LEVEL` | `info` | Structured logging |

See `.env.example` for the annotated list.

## Local development

```bash
npm install
npm run dev
```

`npm run dev` starts Vite and serves the Netlify handlers in-process through
`scripts/dev-api-plugin.ts`. This is the supported local flow and matches the
`/api/*` paths used in production. `vite.config.ts` loads `.env` into `process.env`
for those handlers only; secrets are never exposed through `import.meta.env` unless
they are explicitly prefixed with `VITE_`.

`npm run dev:netlify` uses the Netlify CLI (`netlify dev`) if it is installed; it is
not required. If both are available, prefer `dev:netlify` when debugging
Netlify-specific behavior (redirects, headers, scheduled functions).

Local checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Post-deploy checklist

1. `GET /api/health` returns 200 and reports the expected provider/model.
2. `GET /api/news?refresh=1` returns items and an empty `errors` array.
3. `/providers` → **Refresh models** lists the live catalog.
4. **Test connection** succeeds with a real key; a deliberately wrong key returns 401.
5. A real analysis in `/lab` returns a completion (requires credits).
6. Security headers are present (`Content-Security-Policy`, `X-Frame-Options`).
7. Register a test account, verify email, and sign in.
8. `/workspace` creates a private case; a second account cannot see it.
9. `/admin` is hidden for a member and shows only permitted tabs for staff.
10. Trial entitlement appears in the account payload and the trial banner.
11. Password recovery link opens `/reset-password` and accepts a new password.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `/api/*` 404 in production | Nested function folder or redirect order changed |
| `/api/*` 404 locally | Using a static server instead of `npm run dev` |
| 401 `invalid_key` | Wrong/revoked key, or key sent to the wrong provider |
| 404 `not_found` | Base URL includes an endpoint path, or model ID is wrong |
| 402 `insufficient_credits` | Provider account balance |
| 429 `rate_limited` | Provider quota; automatic retry is limited to transient errors |
| News empty with `errors` | Upstream source down; successful sources still render |
| Ollama unreachable | `ALLOW_LOCAL_AI=true` and the server reachable from the function |
