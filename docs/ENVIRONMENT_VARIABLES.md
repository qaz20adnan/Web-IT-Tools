# ENVIRONMENT VARIABLES — Adnan Tech

Authoritative list: every variable is one the **code reads**, found by grepping
`process.env` across `netlify/`, `src/`, `scripts/` and the build configs. Not copied from
`.env.example`. Values are never recorded here.

Presence in the live environments was measured where possible:
`NETLIVE` = https://adnan-tech.netlify.app (read through `/api/health` and `/api/auth?action=config`),
`VPREV` = a Vercel preview (`/api/health`), `LOCAL` = this machine's `.env.local`.

### Census measured 2026-11-01 (API reads, values never printed)

| Host | What the config store actually holds | Consequence |
| --- | --- | --- |
| Netlify `adnan-tech` (`9b5bd170-ab23-41bb-88fe-67539716b8bf`) | **7 keys and nothing else**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXORA_HASH_PEPPER`, `NEXORA_SITE_URL`, `OWNER_EMAIL`, `CONTENT_ADMIN_TOKEN`. The list endpoint masks values, so presence was confirmed two ways: the key names, and `/api/health` answering `database.configured=true` and `contentAdmin.configured=true` | Auth, trials, the admin surface and news work; **`AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL` and every `GEMINI_*`/`TAVILY_*`/`BRAVE_*` name is absent on this host**, which is why the live health says `ai.configured=false`, `vision.configured=false`, `research.configured=false` |
| Vercel `adnan-tech` (`prj_Nt6noTngtbq27eHOYdYitLhXBnTX`) | **0 user variables** in every scope — `/v9/projects/{id}/env` and `/v10/…` both return an empty `envs` array | C-2 stands: `auth`, `admin`, `workspace` are permanently fail-closed there |
| Local `.env.local` | **1 variable: `VERCEL_OIDC_TOKEN`.** Nothing else | Any `LOCAL` cell in the tables below that implies Supabase credentials sit in this file describes an older state of the file, not today's. **The only copy of the seven Netlify values is Netlify itself** — so a Vercel parity pass has to read them from there, and there is no local file that can leak them |

## 1. Supabase / auth / database

| Variable | Required | Used by | Purpose | Dev | Preview | Prod | Secret | Present? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `SUPABASE_URL` | **yes (prod)** | `netlify/lib/env.ts:70`, `netlify/lib/supabase.ts:12-16`, `scripts/promote-admin.mjs:27` | REST + Auth base | optional | **missing** | present | yes (URL, not a key) | NETLIVE ✅ / VPREV ❌ / LOCAL ❌ |
| `SUPABASE_ANON_KEY` | **yes (prod)** | `env.ts:71`, `supabase.ts:19,88` | non-service requests | optional | **missing** | present | yes | NETLIVE ✅ / VPREV ❌ |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes (prod)** | `env.ts:72`, `supabase.ts:20-24`, `promote-admin.mjs:28` | bypasses RLS, server only | optional | **missing** | present | **TOP SECRET** | NETLIVE ✅ / VPREV ❌ |
| `NEXORA_HASH_PEPPER` | **yes (prod)** | `env.ts:54`, `netlify/lib/auth.ts:113` | HMAC for `trial_claims.email_hash` | yes | **missing** | unknown | secret | see §3 pitfall P-1 |
| `NEXORA_SITE_URL` | **yes (prod)** | `env.ts:53` (`?? URL`) | origin of verification/recovery links | `http://localhost:5173` | **missing → falls back to `localhost:5173`** | NETLIVE resolves to `https://adnan-tech.netlify.app` via the Netlify-injected `URL` | public | Vercel injects no `URL`; must be set explicitly |
| `NEXORA_TRIAL_DAYS` | no (30) | `env.ts:49`, `auth.ts:186` | trial length, overridable by the `trial_days` platform setting | any | any | any | public | — |
| `NEXORA_MAINTENANCE_MODE` | no (false) | `env.ts:55` | global gate | dev only | no | planned | public | — |
| `OWNER_EMAIL`, `ADMIN_EMAIL`, `NEXORA_OWNER_EMAIL` | no | `env.ts:44-46`, `auth.ts:380-381` | **booleans only** — they never grant a role at sign-in | optional | optional | set on NETLIVE (`ownerConfigured=true`, `adminConfigured=false`) | public-ish (an email address) | — |

Name trap: the code reads `SUPABASE_SERVICE_ROLE_KEY`. `SUPABASE_SERVICE_ROLE` does not exist
anywhere, so a Vercel variable named that way would be silently ignored.

## 2. AI providers and search

| Variable | Required | Used by | Purpose | Secret |
| --- | --- | --- | --- | --- |
| `AI_PROVIDER` | **yes for AI** | `env.ts:76`, `ai.ts:82` | one of `openai\|anthropic\|gemini\|openrouter\|ollama\|custom` | public |
| `AI_API_KEY` | **yes for AI** | `env.ts:79`, `ai.ts:84` | platform key; users may instead send their own per request via `x-tn-key` | **secret** |
| `AI_MODEL` | **yes for AI** | `env.ts:79`, `ai.ts:90,98,103` | primary model id; no default in code | public |
| `AI_BASE_URL` | no | `env.ts:77` → `defaultBaseUrl()` | provider root | public |
| `AI_FALLBACK_MODEL` | no | `env.ts:78`, `ai.ts:110` | retried only on `not_found\|invalid_input\|forbidden\|upstream_error` | public |
| `AI_VISION_PROVIDER/BASE_URL/MODEL/API_KEY` | no | `env.ts:130-136`, `ai.ts:86-103` | image analysis; each falls back to the matching `AI_*` | one is secret |
| `AI_TIMEOUT_MS` | no (**60000**) | `env.ts:56`, `ai.ts:258,362` | desired per-attempt fetch timeout; clamped to the 50 s shared request budget (`ai.ts:157`) — see pitfall P-2 | public |
| `AI_MAX_OUTPUT_TOKENS` | no (2500) | `env.ts:57` | completion cap | public |
| `AI_ALLOWED_HOSTS` | no | `env.ts:67-70`, `netlify/lib/host.ts:114-141` | **security allowlist** for custom/Ollama base URLs | public |
| `AI_APP_REFERER`, `AI_APP_TITLE` | no | `env.ts:61-63` | OpenRouter attribution | public |
| `ALLOW_LOCAL_AI` | no | `env.ts:60`, `netlify/lib/host.ts:84,130` | permits local **loopback-IP** AI targets (`http://127.0.0.1:11434`). The `localhost` spelling does *not* work: `normalizeHost()` rejects single-label names before this flag is consulted, so set it with the IP form (finding L-11, open) | public |
| `GEMINI_API_KEY` | no (off) | `env.ts:105` | live web research; falls back to `AI_API_KEY` when `AI_PROVIDER=gemini` | **secret** |
| `GEMINI_MODEL` | no (`gemini-flash-latest`) | `env.ts:106` | grounding model — a moving alias, see P-5 | public |
| `GEMINI_WEB_SEARCH_ENABLED` | no (false) | `env.ts:107` | master switch for Google Search grounding | public |
| `GEMINI_BASE_URL`, `GEMINI_TIMEOUT_MS`, `GEMINI_MAX_OUTPUT_TOKENS`, `GEMINI_CACHE_TTL_SECONDS` | no | `env.ts:108,110-113` | endpoint, 45 s, 3000, no cache | public |
| `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY` | no | `netlify/functions/research.ts:61,96,134-135`, `health.ts:10-11` | link-list research providers (paid per call) | **secret** |

## 3. Content, limits, policy

| Variable | Required | Used by | Purpose |
| --- | --- | --- | --- |
| `CONTENT_ADMIN_TOKEN` | **yes for the whole CMS endpoint** | `env.ts:69`, `netlify/functions/content-admin.ts:29-42`, `tests/content-admin-gates.test.ts` | single static bearer, `timingSafeEqual` behind a length guard, no rate limit (M-11). Gate is handler-tested (51 tests, 26/26 mutations): unset → 503 on read *and* write with no database call. Since the 2026-11-01 H-11 fix the endpoint needs **only** `SUPABASE_SERVICE_ROLE_KEY` — read, write and delete all go out with it, so `SUPABASE_ANON_KEY` is no longer consulted here and the listing sees unpublished drafts. Do not treat that as a reason to widen anyone else's access: this key now leaves the server on `GET` too |
| `NEWS_FEEDS` | no | `netlify/functions/news.ts:176`, `health.ts:34` | extra RSS URLs |
| `RATE_LIMIT_WINDOW_MS` (60000), `RATE_LIMIT_MAX` (20) | no | `env.ts:58-59`, `netlify/lib/rate.ts` | in-memory, per warm instance (H-8) |
| `NET_PROBE_ALLOW_PRIVATE` | no (false) | `env.ts:61`, `netlify/functions/net-port.ts:19`, `net-diagnostics.ts:33` | allows **RFC1918 + loopback** TCP probes. Documented in `.env.example`, README and `docs/DEPLOYMENT.md` (L-9 closed). Keep off on any cloud host |
| `PRINTER_ALLOW_PRIVATE` | no (false) | `env.ts:62`, `net-printer.ts` | LAN printer probing; auto-allowed only under `localRuntime()` |
| `PRINTER_ALLOW_PUBLIC` | no (false) | `env.ts:65`, `net-printer.ts:27` | public IPP/9100/515 probing. The inverted default is **fixed** (M-2): both printer flags go through `envBool()`, which is false unless the value is literally `true` |
| `LOG_LEVEL` | no (`info`) | `env.ts:66`, `netlify/lib/http.ts:121`, `netlify/lib/auth.ts:438,465` | `silent` suppresses the `[nexora]` error log |
| `APP_NAME` | no (`Adnan Tech`) | `env.ts:43` | display name |

## 4. Host-injected (set by the platform, never by you)

`NODE_ENV`, `NETLIFY`, `URL` (Netlify only), `AWS_LAMBDA_FUNCTION_NAME`, `LAMBDA_TASK_ROOT`,
`NEXORA_LOCAL_AUTH` (set to `1` by `vite.config.ts:19-21` during `npm run dev`),
`VERCEL_OIDC_TOKEN`, `VERCEL_ENV`.

`localAuthEnabled()` = `NEXORA_LOCAL_AUTH=1` **and** `NODE_ENV≠production` **and** none of
`NETLIFY`/`AWS_LAMBDA_FUNCTION_NAME`/`LAMBDA_TASK_ROOT` set (`netlify/lib/local-auth.ts:121-128`).

## 5. Absent by design — and that is a good sign

There is **no `VITE_*` and no `NEXT_PUBLIC_*` variable anywhere** in the repository. The only
`import.meta.env` reads are `DEV` and `MODE` (`src/components/ErrorBoundary.tsx:19,37`,
`src/pages/AboutPage.tsx:212`, `src/pages/RegisterPage.tsx:78`). So no secret can be inlined
into the browser bundle by accident, and none was found in `dist/`.

## 6. Measured gaps (as of 2026-10-31)

| Gap | Symptom | Fix |
| --- | --- | --- |
| `LOCAL` has no `SUPABASE_*` | `.env.local` contains only `VERCEL_OIDC_TOKEN`, so auth/DB/RBAC cannot be exercised locally except through the dev-only local provider | copy `.env.example` → `.env` with real values, never commit it |
| `VPREV` has no `SUPABASE_*` | `databaseConfigured=false` on Vercel previews → every internal tool and page returns 503 there | D3 |
| No `NEXORA_SITE_URL` on Vercel | verification/recovery links would point at `http://localhost:5173/verify?...` | set explicitly, do not rely on `URL` |
| No AI key on NETLIVE | `ai.configured=false`, `research.configured=false` → the assistant is unreachable in production | D4 |
| `NET_PROBE_ALLOW_PRIVATE` undocumented | LAN scanning possible with no paper trail | **CLOSED** — it is in `.env.example` (with an "never for a public deployment" comment), `README.md:128` and `docs/DEPLOYMENT.md:94` |

## 7. Pitfalls with a real failure mode

| ID | Pitfall |
| --- | --- |
| P-1 | Empty `NEXORA_HASH_PEPPER` used to degrade to `SUPABASE_URL`, then to the literal `'nexora-local-pepper'`, making trial-claim HMACs guessable. **Fixed** (M-1): the literal fallback is gone from the source, `hasPepper()` (`netlify/lib/auth.ts:116`) gates the whole path, and an un-peppered deployment now refuses to start a trial (`auth.ts:210`) rather than hash with a guessable key |
| P-2 | `AI_TIMEOUT_MS=60000` is **per attempt** and retries double it; Netlify standard functions die at 60 s and `vercel.json` sets `maxDuration: 60` → the user gets a platform error page, not the app's JSON error (H-4). **Fixed in code**: every AI request now runs inside one 50 s `Deadline` (`ai.ts:157`), so the value is a wish, not a guarantee — it is clamped to the budget left, and a spent budget returns `504 timeout` instead of a platform kill. Not deployed |
| P-3 | `PRINTER_ALLOW_PUBLIC` unset used to mean *on*. **Fixed** (M-2) — `envBool()` returns false unless the value is exactly `true`, and `tests/secure-defaults.test.ts` pins that a deployment with nothing set cannot probe public printer ports |
| P-4 | On Vercel, `NEXORA_SITE_URL ?? URL` resolves to the `localhost:5173` default because Vercel does not inject `URL` |
| P-5 | `gemini-flash-latest` is a moving alias: good for staying current, bad for reproducing an answer during an audit |
| P-6 | `AI_ALLOWED_HOSTS` gates custom/Ollama base URLs — leaving it empty while `ALLOW_LOCAL_AI=true` in production is how a proxy-to-localhost bug appears |
