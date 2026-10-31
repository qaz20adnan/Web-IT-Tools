# ARCHITECTURE — Adnan Tech | منصة عدنان تك

Date: 2026-10-31. Scope: the architecture that exists today, described from the code, plus the
target architecture and the migration path for the gaps found in
[docs/PROJECT_AUDIT.md](PROJECT_AUDIT.md).
This file supersedes `docs/ADNAN_TECH_ARCHITECTURE.md` (2026-10-27) wherever they disagree; that
file describes a plan, this one describes the product.

## 1. Shape of the system

```
Browser (React SPA, no server rendering)
  │  fetch /api/*  with Authorization: Bearer <access token>
  ▼
Edge/Serverless layer  ── two independent hosts run the SAME handler code
  ├─ Netlify:  netlify.toml redirects → 22 flat functions  netlify/functions/*.ts
  ├─ Vercel:   vercel.json rewrite   → 1 function          api/index.js (generated bundle)
  └─ Dev:      scripts/dev-api-plugin.ts → handlers run in-process inside Vite
  │
  ▼
Shared server libraries  netlify/lib/*.ts  (23 files — the real product logic)
  │
  ▼
External services (HTTPS only, from the function):
  Supabase Auth (GoTrue) · Supabase PostgREST · Supabase Storage
  OpenRouter / OpenAI / Anthropic / Gemini / Ollama / custom base URLs
  Google DoH · RSS/security feeds · any user-supplied public host
```

There is no application server, no ORM, and no WebSocket layer. Everything "backend" is a set of
stateless request handlers plus a library layer. That is a deliberate and correct choice for a
tooling platform on free tiers; §5 lists the two places where it starts to hurt.

## 2. Frontend layers

| Layer | Location | Size | Responsibility |
| --- | --- | --- | --- |
| entry | `src/main.tsx` | — | mounts `App`, imports the token stylesheet once |
| routing | `src/App.tsx` | 145 lines | 39 route entries over 33 pages; 32 `load()`-wrapped lazy, 1 eager (`DashboardPage`, `src/App.tsx:7`) |
| guards | `src/components/auth/` | — | `ProtectedRoute` + permission gating before the page module even loads |
| state | `src/context/*.tsx` | 6 providers | `AppContext` (settings/i18n), `AuthContext` (session+profile), `ProvidersContext` (BYOK), `LibraryContext` (saved/history/Kb), `DiagnosticsContext`, `ToastContext` |
| transport | `src/services/api.ts` | 650 lines | the only place that builds `/api` requests; token injected through `setAuthTokenProvider` (`src/services/api.ts:49`) |
| session | `src/services/authSession.ts` | 55 lines | `localStorage` key `nexora.auth.session.v1` + legacy URL-hash reader |
| pure logic | `src/lib/*.ts` | 27 files | calculators, CIDR, CVSS, x509, cron, diff, csv, markdown, script scanning — all framework-free and unit-tested |
| static knowledge | `src/data/*.ts` | 14 files | articles, scripts, models, tools, themes, domains |
| UI kits | `src/components/{ui,layout,dashboard,charts,tools,onboarding,brand}` | — | presentational shell + 43 catalogued tools living in 18 component files (`src/data/tools.ts`, `src/components/tools/`) |
| pages | `src/pages/*.tsx` | 33 | 38 concrete paths served by 33 modules — `DomainPage` is instantiated 7 times with a `hub` prop (`src/App.tsx:110-116`) |
| styling | `src/styles/index.css` + `src/data/themes.ts` | — | Tailwind 4, 11 themes driven by CSS custom properties, RTL via logical properties |
| i18n | `src/i18n/{en,ar,index}.ts` | — | typed dictionaries, no runtime provider library |

**Direction of dependency is one-way:** `pages → components/context → services → lib`. No lib
imports a page, no service imports React. This is why 27 of the 34 test files can run pure logic
without jsdom.

## 3. Server layers

### 3.1 Handler contract

Every function is `(event, context) => Response-shaped result`. Three thin adapters satisfy the
same signature:

| Runtime | Adapter | Evidence |
| --- | --- | --- |
| Netlify | native `Handler` from `netlify/functions` | `netlify/functions/*.ts` |
| Vercel | `vercel/serverless.ts` bridges Node `req/res` → Lambda event, buffers the body (4.5 MB cap), and hands the path to `createVercelDispatcher` | `vercel/serverless.ts`, `vercel/dispatcher.ts:31-56` |
| Local dev | `scripts/dev-api-plugin.ts` registers the same route table on Vite's connect server | `vite.config.ts` |

`scripts/build-vercel-api.mjs` bundles `netlify/functions/*.ts` + `netlify/lib/*.ts` with esbuild
into the git-ignored `api/index.js` (~1.17 MB). One function instead of 22 exists because the Hobby
plan caps a deployment at 12 Serverless Functions (`docs/VERCEL_DEPLOYMENT.md:25`, plan limit as
documented on 2026-10-28 — NOT RE-TESTED from this account), and `vercel.json`
`functions["api/index.js"].maxDuration = 60` sets the single function's ceiling.

**Consequence to remember:** `api/index.js` is generated. If it is not rebuilt, Vercel silently
serves an older API (finding H-5: the bundle was stale and missing `/api/net/latency` and
`/api/net/path`). `vercel.json` does chain `build:vercel-api`, so the fix is to never build Vercel
by hand.

### 3.2 Library layer (the parts that matter)

| File | Lines | Role | Notes for future changes |
| --- | --- | --- | --- |
| `netlify/lib/auth.ts` | 500 | bearer → identity. Local dev path, then Supabase `/auth/v1/user`, then `accountForUser` (profile + role + entitlements + trial + usage). Also `requireMember`, `enforceAiAccess`, `writeAudit`, `recordUsage`, `sanitizeDetail` | the single choke point for identity; nothing else may decide "who is this" |
| `netlify/lib/local-auth.ts` | — | dev-only file store `.local-auth/store.json`, scrypt N=16384 r=8 p=1, 1 h access / 30 d refresh, 20 sessions per account | gated by `localAuthEnabled()`; never active when Supabase env is present |
| `netlify/lib/rbac.ts` | 252 | 10 roles × 23 named permissions, `has()` | mirrored client-side in `src/lib/permissions.ts` **for UI only** |
| `netlify/lib/trial.ts` | — | server-side trial/plan/entitlement + daily AI limit | authority for limits; client copy is display only |
| `netlify/lib/env.ts` | — | one place that reads `process.env`, exports `serverConfig`, `aiSettings`, `geminiSettings`, `allowedHosts` | the census lives in `docs/ENVIRONMENT_VARIABLES.md` |
| `netlify/lib/supabase.ts` | — | PostgREST + GoTrue + admin fetch over `fetch`, service-role server-side, `restError()` mapping, every param `encodeURIComponent` | no `@supabase/supabase-js` dependency at runtime |
| `netlify/lib/ai.ts` | — | provider adapters (openai/anthropic/gemini/openrouter/ollama/custom), `normalizeBaseUrl`, retry + fallback model, `verifyProviderAuth` | BYOK arrives in `x-tn-*` request headers, never in the URL or the bundle |
| `netlify/lib/gemini.ts` | — | Gemini Interactions API + Google Search grounding, citation annotation parsing, `redact()` | the only real web-search source today |
| `netlify/lib/host.ts` | 113 | `assertPublicHost` — SSRF guard: loopback/RFC1918/link-local/CGNAT/metadata always rejected, resolution re-checked at connect time | `NET_PROBE_ALLOW_PRIVATE` relaxes it in dev only |
| `netlify/lib/net-*.ts` | 6 files | TCP-connect RTT (`net-latency`), path inference (`net-path`), DoH lookups (`net-doh`), response analysis (`net-analysis`), probes (`net-probe`), diagnostics (`net-diagnostics`) | there is no `child_process`, no `dgram`, no raw socket anywhere — see §4.4 |
| `netlify/lib/schema.ts` | 171 | zod schemas for every request body | validation happens before any network or DB call |
| `netlify/lib/rate.ts` | — | in-memory token bucket per identity/IP | **not** a distributed limiter; resets per container (§5, W-3) |
| `netlify/lib/prompts.ts` | 138 | system prompts for copilot / analyze / script | the answer-format contract |
| `netlify/lib/http.ts`, `json.ts`, `fetch.ts`, `net-errors.ts` | — | response builders, JSON helpers, timeout-aware fetch, error mapping | duplicated responsibility with `vercel/serverless.ts` for body handling (§5, W-2) |

### 3.3 Public API surface (22 routes)

| Group | Routes | Auth | Notes |
| --- | --- | --- | --- |
| meta | `GET /api/health` | none | honest per-service `configured` flags |
| auth | `ANY /api/auth` — 14 actions: config, register, login, refresh, logout, me, update-profile, change-password, reset-password, recover, resend, verify, delete-account, export | mixed | two branches in one file: dev-local store (`netlify/functions/auth.ts:199-285`) and Supabase (`:286-556`); the only endpoint family with a per-runtime code path |
| AI | `POST /api/ai/chat`, `POST /api/ai/analyze`, `POST /api/ai/script` | `ai.use` via `enforceAiAccess` | billed-capable paths; daily limit enforced server-side |
| AI meta | `GET /api/ai/models`, `POST /api/ai/test` | sign-in + **`ai.use`**, and the call is recorded | Fixed in W1 (was the `requireMember` default `workspace.read`, and uncounted). BYOK requests still count as the member's own spend, not platform quota |
| research | `POST /api/research` | sign-in + **`research.read`**, and the call is recorded | Fixed in W1 (was `workspace.read` and uncounted, so paid Tavily/Brave calls were invisible) |
| content | `GET /api/content`, `ANY /api/content/admin` | public read / `CONTENT_ADMIN_TOKEN` | admin token is a shared secret (M-11) |
| news | `GET /api/news` | none | real feeds, cached |
| network | `GET/POST /api/net/{analyzer,dns,tls,latency,path,port,http,url,printer}` | mixed | public-internet targets only on hosts |
| data | `ANY /api/workspace`, `ANY /api/admin` | `workspace.*` / explicit permissions | service-role used server-side, RLS still enforced for user tokens |

## 4. Cross-cutting invariants

These are the rules the code currently honors; treat them as the contract any future change must
preserve.

### 4.1 Identity is decided once
`netlify/lib/auth.ts` is the only function that maps a token to a role. Handlers call
`authenticate()` then `requireMember()` / `has(permission)`. The client's `src/lib/permissions.ts`
exists only to hide buttons. `git grep` confirms no handler trusts a `role` field from a request
body, and `profiles` privilege columns are guarded by three DB triggers
(`supabase/migrations/0001_nexora.sql:82`, `0002:84`, `0003:39`) plus `protect_profile_delete`.

### 4.2 Secrets never reach the browser
There is not a single `VITE_*` or `NEXT_PUBLIC_*` variable in the repository (proof and census in
`docs/ENVIRONMENT_VARIABLES.md`). BYOK keys travel in `x-tn-*` request headers and are used only
inside the function invocation.

### 4.3 Storage is the only persistence
18 tables + `storage.objects` policies (`supabase/migrations/0001_nexora.sql:62-463`). All RLS is
enabled; writes for staff flow through service-role calls made from the function, never from the
browser. Migration files are the source of truth — there is no schema in git besides them.

### 4.4 No fake results
Every tool either returns a measured result or returns an explicit unsupported/blocked status.
Serverless cannot send ICMP or run `traceroute`, so `/api/net/latency` measures TCP-connect time and
`/api/net/path` infers hops — both label their method in the response. Offline triage
(`src/services/localTriage.ts`) is marked `offline: true`.

## 5. Target architecture (what to change, in order)

The current design is sound. Four items are worth real engineering; everything else is a bug fix.

| # | Change | Why | Cost / risk |
| --- | --- | --- | --- |
| W-1 | Single error/response map shared by all handlers (fold `netlify/lib/net-errors.ts` + the ad-hoc `jsonError` calls into one module) | 6 handlers invent their own shapes; clients can't branch reliably (H-10) | low; contained in `netlify/lib` |
| W-2 | One body-reading + timeout utility used by dev, Netlify and Vercel adapters | the 4.5 MB Vercel cap and the 60 s budget were expressed three times (H-3, H-4). **Partly landed**: `shared/upload-limits.ts` is now the single body/image ceiling and `netlify/lib/ai.ts` owns one 50 s `Deadline` per request; what remains is folding the dev adapter's own reading of those values into the same utility | low |
| W-3 | Rate limiting moved out of process memory (Supabase RPC table + a `usage_events`-backed window) | an in-memory bucket resets on every cold start and is spoofable through `x-forwarded-for` (H-8, M-1) | medium; needs a migration + backfill plan → owner approval |
| W-4 | Split `src/services/api.ts` (650 lines) by domain and add tests around it | it is the only module with zero test coverage and every page depends on it | low; mechanical |

Deliberately **not** planned: adding a framework (Nest/Fastify), an ORM, a Redis dependency, a Web
Socket layer, or moving to Next.js. None of them buy anything at this scale on a free tier, and each
would invalidate the working Netlify/Vercel parity described in §3.1.

## 6. Host capability matrix (measured 2026-10-31, see PROJECT_AUDIT §2)

| Capability | `npm run dev` (LOCAL) | Netlify (NETLIVE) | Vercel (VPROD/VPREV) |
| --- | --- | --- | --- |
| SPA + static | PASS | PASS | PASS (preview only; production alias is dead — C-2) |
| Supabase auth/DB | BLOCKED (no vars in `.env.local`) | PASS | BLOCKED (vars absent — C-3) |
| Local file auth | PASS | not active | not active |
| AI chat | PASS with own key | BLOCKED `ai.configured=false` (D6) | BLOCKED |
| Grounded search | PASS with `GEMINI_API_KEY` | BLOCKED | BLOCKED |
| DNS/TLS/HTTP/URL | PASS | PASS (public internet only) | PASS (public internet only) |
| Latency/path/port | PASS | PASS (TCP only) | PASS (TCP only) |
| LAN targets | PASS (`NET_PROBE_ALLOW_PRIVATE`) | FAIL by design (SSRF guard) | FAIL by design |
| ICMP ping / traceroute | NOT SUPPORTED by design | NOT SUPPORTED | NOT SUPPORTED |
| `admin` / `workspace` | PASS | PASS | BLOCKED (needs env) |
| Security headers | n/a (dev server) | PASS | PASS |
| Raw ICMP sockets, `child_process` | available | forbidden | forbidden |

Read across the last two rows: the network tools will never do more than TCP/HTTP/DNS/TLS on either
host. Any "real ping" requirement means an agent on a customer-owned box — a separate product
decision, not a code fix.
