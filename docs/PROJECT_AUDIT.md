# PROJECT AUDIT — Adnan Tech | منصة عدنان تك

Auditor: Qoder agent team (security, AI integration, DevOps, frontend). Date: 2026-10-31.
Method: read-only source audit + live probes against the running deployment. Nothing in this
report is copied from the older `docs/ADNAN_TECH_*.md` files; where those files disagree with
the code or with a live measurement, this report wins and the disagreement is listed.

Everything below states the environment it was measured in. `LOCAL` = this machine,
`NETLIVE` = https://adnan-tech.netlify.app, `VPROD` = Vercel production alias,
`VPREV` = a Vercel preview reached with an authenticated CLI (`vercel curl`, bypasses SSO).

## 1. Real stack (discovered, not assumed)

| Layer | Fact | Evidence |
| --- | --- | --- |
| Framework | React 19.3 + Vite 8 + TypeScript 5.9, **SPA not Next.js** | `package.json:28-59`, `vite.config.ts` |
| Routing | react-router-dom 7, 39 route entries over 33 pages, 32 lazy + 1 eager | `src/App.tsx:10-47`, `:7`, `:79-134` |
| Styling | Tailwind CSS 4 via `@tailwindcss/vite`, 11 themes, token layer | `src/data/themes.ts`, `src/styles/index.css:51-364` |
| Backend | 22 flat Netlify Functions + 23 shared libs, no framework adapter | `netlify/functions/`, `netlify/lib/` |
| Vercel path | 1 generated function (`api/index.js`) dispatching 22 `/api` routes | `vercel/dispatcher.ts:31-54`, `scripts/build-vercel-api.mjs` |
| Auth/DB | Supabase Auth + PostgREST over HTTPS, service-role server-side only | `netlify/lib/supabase.ts`, `netlify/lib/auth.ts` |
| AI | OpenRouter default, OpenAI/Anthropic/Gemini/Ollama/custom; Gemini Interactions for grounded search | `netlify/lib/env.ts:5-12`, `netlify/lib/ai.ts`, `netlify/lib/gemini.ts` |
| Tests | Vitest 5, 51 files / 496 tests, jsdom | `vitest.config.ts`, LOCAL run 2026-10-31 |
| Naming | brand is Adnan Tech; npm name `nexora-ai`, `NEXORA_*` env vars and `nexora.*` storage keys intentionally unchanged | `package.json:2`, `README.md:153-159` |

## 2. Live environment state (measured)

| Probe | Environment | Result |
| --- | --- | --- |
| `GET /api/health` | NETLIVE | PASS 200 — `database.configured=true`, `news.configured=true`, `contentAdmin.configured=true`, `ai.configured=false`, `research.configured=false` |
| `GET /api/auth?action=config` | NETLIVE | PASS — `provider=supabase`, `authConfigured=true`, `databaseConfigured=true`, `ownerConfigured=true`, `adminConfigured=false`, `localMode=false`, `siteUrl=https://adnan-tech.netlify.app`, trial 30 days, password 8–128 |
| `POST /api/auth` login, bogus credentials | NETLIVE | PASS (correct failure) 401 `invalid_credentials`, upstream detail `Invalid login credentials` → the live deployment really reaches Supabase Auth |
| `POST /api/ai/chat` unauthenticated | NETLIVE | PASS (fail-closed) 401 `Sign in to use the AI assistant.` |
| `GET /api/net/dns?host=example.com` unauthenticated | NETLIVE | PASS (fail-closed) 401 |
| `GET /api/news` | NETLIVE | PASS 200 with real publisher items → function egress and the feed pipeline work |
| Security headers on `/` | NETLIVE | PASS — CSP, HSTS(+preload), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy, Permissions-Policy all served |
| Vercel production alias `adnan-tech-adnan-mohamed.vercel.app` | VPROD | **FAIL — 404 `DEPLOYMENT_NOT_FOUND`** (production deployment is in `Error`) |
| `https://adnan-tech.vercel.app` | VPROD | **FAIL — `DEPLOYMENT_NOT_FOUND`**; this hostname has never been assigned to project `adnan-mohamed/adnan-tech` |
| Vercel preview `GET /api/health` | VPREV | PASS 200 but `database.configured=false`, `contentAdmin.configured=false` → **no Supabase env vars on the Vercel project** |
| Vercel preview anonymous `GET /` | VPREV | 302 → `vercel.com/sso-api` (Deployment Protection / Vercel Authentication is ON) |
| `npm run typecheck`, `lint`, `test`, `build` | LOCAL | PASS / 0 errors + 19 warnings / 496 passed in 12.46 s / built in 524 ms (entry chunk 745.57 kB min, 231.85 kB gzip). Re-run on 2026-10-31 after the W1 batch and the first W2 items; full per-file breakdown in [docs/TESTING_REPORT.md](TESTING_REPORT.md) |
| `npm audit --omit=dev` | LOCAL | PASS — 0 vulnerabilities in production dependencies |

Consequence of the VPROD row: **Netlify is the only working production target today.** The
plan recorded in `README.md:15` and `docs/DEPLOYMENT.md:5-13` says exactly that, so the owner's
stated intent to serve production from `adnan-tech.vercel.app` is a different plan and needs a
decision (see §7 item D1).

## 3. Findings register

Severities: CRITICAL breaks production or a core promise; HIGH breaks a feature, leaks data,
or misleads the user; MEDIUM is a real defect with a bounded blast radius; LOW is hygiene.

The tables below are the **as-found snapshot** and are deliberately not rewritten as work lands.
What has since been fixed locally — and how it was proved — is tracked in §8.1.

### CRITICAL

| ID | Area | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| C-1 | Deployment | Vercel production deployment is in `Error`; its alias 404s, so every Vercel production URL is dead while five previews sit Ready | VPROD probe above; `vercel ls` (1 Error/Production, 5 Ready/Preview, all 3 days old) | OPEN — build log not yet read (needs Vercel dashboard or an API token; see D2) |
| C-2 | Deployment | The Vercel project has no Supabase env vars, so `auth`, `admin`, `workspace` are permanently broken there (fail-closed 503 `not_configured`), unlike NETLIVE where they are configured | VPREV health vs NETLIVE health | OPEN — needs D3 |
| C-3 | Platform | `npm run build` (and therefore every deploy) failed for 4 days: `tsc --noEmit` stopped on two unused imports left behind when the English Coach page was deleted | git `6612d0f`; the tree at 2026-10-28 12:35 (the errored VPROD deploy) contained exactly this break — most probable cause of C-1, unconfirmed without the build log | **RESOLVED** locally (typecheck + build green), not yet deployed |
| C-4 | Backup | The repository had no remote at all: 188 changed files / 6 days of work existed on one disk only | `git remote -v` empty; `git log` stopped at 2026-10-25 | PARTIAL — work is now committed (3 commits), remote still absent (D6) |

### HIGH

| ID | Area | Finding | Evidence |
| --- | --- | --- | --- |
| H-1 | Security/UX | Analysis mode renders **model-asserted** `sources[]` as citations; the URLs are never fetched or verified, only `z.string().url()` checked | `netlify/functions/ai-analyze.ts:32-34`, `netlify/lib/schema.ts:78`, `netlify/lib/prompts.ts:94`, rendered at `src/pages/TroubleshootingLabPage.tsx:579-592`. Grounded search does this correctly (`netlify/lib/gemini.ts:89-118`) |
| H-2 | Session security | Access **and refresh** tokens live in `localStorage` → any XSS gives durable account takeover. README admits the risk but the code has no mitigation | `src/services/authSession.ts:3,7,23`; `README.md:117-118` |
| H-3 | Upload/vision | Three different body caps for the same feature: client 4 MB image → ≈5.33 MB base64 JSON, server limit 8 MB, Vercel bridge 4.5 MB. Real usable cap ≈3.3 MB raw image; on Vercel the request dies with a raw 413 and the friendly "too large" message never runs | `netlify/functions/ai-analyze.ts:12`, `vercel/serverless.ts:25,48`, `netlify/lib/ai.ts:293`, `netlify/lib/http.ts:96-98` — **RESOLVED** locally: one `shared/upload-limits.ts` (3 MB image → ≈4.1 MB body ≤ the 4.5 MB bridge cap) is imported by the browser guard, the zod schema, the vision encoder, both handlers and the Vercel bridge; UI copy now says 3 MB. 6 tests including a mutation check. Not deployed, not exercised with a real upload in a browser |
| H-4 | AI reliability | Timeout budget exceeds the platform ceiling: `AI_TIMEOUT_MS` default 60000 is **per attempt**, retried twice → up to ~120 s, while Netlify standard functions are capped at 60 s and `vercel.json` sets `maxDuration: 60`. Failure appears as an opaque platform kill, not a structured error | `netlify/lib/env.ts:56`, `netlify/lib/ai.ts:153-177`, `vercel.json:9`, official Netlify docs (60 s default) — **RESOLVED** locally: one 50 s `Deadline` per request (`ai.ts:157`), clamped attempts, structured `504 timeout`, retries and model fallback share the budget; 6 tests, not deployed |
| H-5 | Deployment | The generated `api/index.js` served locally was **stale** — it lacked the `net/latency` and `net/path` routes present in source | `vercel/dispatcher.ts:41-44` vs bundle built 10-28 13:05; regenerated at 2026-10-31 02:32 (now present) — **RESOLVED** locally; needs a guard so it cannot go stale again |
| H-6 | Theming | Hard-coded dark-navy panels bypass the token layer, so `arctic-light`, `sandstone-calm` and `forest-mist` render dark text on dark navy (unreadable hero + signal board). Charts and the hero SVG are likewise pinned to the midnight palette | `src/pages/DashboardPage.tsx:287,425,459`; `src/components/charts/index.tsx:17,171,293,336`; `src/components/dashboard/HeroNetwork.tsx:67-72,108,120`; `src/components/layout/Topbar.tsx:191` |
| H-7 | Privacy | `signOut()` clears only the tokens. Every account-scoped record (saved items, chat history, diagnostic targets, KB notes, provider base URLs, inventory) stays in `localStorage` indefinitely, and the user id is in the key name. Two keys are not account-scoped at all, so they leak between accounts on a shared browser | `src/context/AuthContext.tsx:213-222`, `src/services/authSession.ts:20`, `src/lib/storage.ts:49` (`removeKey()` has zero callers), `src/components/tools/DdnsPortAnalyzer.tsx:126`, `src/components/tools/CertDecodeTool.tsx:35`; `tests/access-control.test.ts:50-65` only tests the helper, never the call sites |
| H-8 | Rate limiting | The limiter is an in-memory `Map`, so limits are per-warm-instance, not per client, and on Vercel the key is `x-forwarded-for[0]`, which the caller controls. `news.ts` also lets an anonymous caller force an upstream fetch with `refresh=1` | `netlify/lib/rate.ts:9,11`, `vercel/serverless.ts:56-59`, `netlify/functions/news.ts:238` |
| H-9 | Resilience | `ErrorBoundary` is mounted once at the root; a throw inside any of the 33 pages blanks the entire shell including navigation | `src/main.tsx:35`, `src/App.tsx:77` (Suspense without a boundary) |
| H-10 | Error UX | No central 401/403 handling after bootstrap, no `Retry-After` parsing for 429, and 503 `not_configured` surfaces as raw server prose; three separate `errorMessage()` implementations diverge in wording | `src/services/api.ts:53-97,91`, `src/context/AuthContext.tsx:143`, `src/lib/speedtest.ts:277`, `src/pages/NetworkDiagnosticsPage.tsx:81`, `src/pages/SecurityLabPage.tsx:283` |

### MEDIUM

| ID | Finding | Evidence |
| --- | --- | --- |
| M-1 | `emailHash()` silently falls back to `SUPABASE_URL` or the literal `nexora-local-pepper` when `NEXORA_HASH_PEPPER` is unset, making `trial_claims.email_hash` predictable → trial abuse, or locking a real user out of their own trial | `netlify/lib/auth.ts:113` |
| M-2 | `PRINTER_ALLOW_PUBLIC` **defaults to `true` in code** while `.env.example` and README say off; a host with the variable unset becomes an open public-internet printer port scanner | `netlify/lib/env.ts:65` vs `.env.example`, `README.md:123-125` |
| M-3 | `net-tls.ts` checks the host is public, then reconnects by name — a DNS-rebinding window (TOCTOU); other probe paths connect to the validated literal IP | `netlify/functions/net-tls.ts:22-24` vs `netlify/lib/net-diagnostics.ts:148-171` |
| M-4 | Implicit-flow tokens are read from the URL fragment (`#access_token=…&refresh_token=…`) and then persisted, exposing them to history and any injected script | `src/services/authSession.ts:48-63`, `src/pages/ResetPasswordPage.tsx:27-29`, `src/pages/VerifyEmailPage.tsx:31-33` |
| M-5 | `verifyProviderAuth()` trusts a catalog response for `custom`/OpenAI-compatible hosts, so a bogus key "passes" against any endpoint with a public `/models` | `netlify/lib/ai.ts:422-427`, `netlify/functions/ai-test.ts:26-35` |
| M-6 | `ai/models`, `ai/test` and `research` gate on `workspace.read` instead of `ai.use`/`research.read` and never record usage → paid Tavily/Brave calls are uncounted | `netlify/functions/ai-models.ts:8`, `netlify/functions/ai-test.ts:11`, `netlify/functions/research.ts:126-128` |
| M-7 | Upstream error text is forwarded to the browser (`detail`, ≤500 chars) without the redaction that `gemini.ts` applies → a provider message echoing a submitted prompt or key reaches the client | `netlify/lib/ai.ts:178`, `netlify/lib/fetch.ts:64-79`, `netlify/lib/http.ts:76` vs `netlify/lib/gemini.ts:278` |
| M-8 | `/api/health` **hardcodes `news.configured: true`** and derives `research.configured` from Tavily/Brave only, ignoring the Gemini key it separately reports as `grounded` — a status endpoint that invents one of its own flags | `netlify/functions/health.ts:28,33,34` |
| M-9 | Settings export and "clear everything" enumerate private keys from a hand-written list that omits `diagnostics`, `diagnosticFavorites`, `virtualization`, `netIpHistory`, `certdecode.prefs`; `localDataSize()` reports more than is cleared | `src/pages/SettingsPage.tsx:16`, `src/lib/storage.ts:94` |
| M-10 | Command palette searches only `KNOWLEDGE_ARTICLES.slice(0, 30)` of 44 articles while the UI implies full coverage | `src/components/layout/CommandPalette.tsx:59` |
| M-11 | Shared static bearer `CONTENT_ADMIN_TOKEN`, no rate limit and no user binding on the CMS write surface | `netlify/functions/content-admin.ts:28-41` |
| M-12 | Node runtime differs per host: Netlify builds on 22, Vercel project is 24.x, local dev is 24.22, esbuild target `node22`, `engines: >=20.19` | `netlify.toml:7`, `.vercel/project.json`, `scripts/build-vercel-api.mjs:20`, `package.json:8-10` |
| M-13 | CSP `script-src 'self'` + `connect-src 'self' https:` (no `wss:`) blocks the Vercel Toolbar in previews — the console message the owner saw. Cosmetic only: the app itself has no `ws:`/`wss:` client, no external fonts, no Worker, and `img-src` already allows `data: blob: https:` | `vercel.json:33`, `netlify.toml:128`, `src/App.tsx`/`src/services` grep: zero websocket usage |
| M-14 | Vercel bridge decodes bodies as UTF-8 strings and always sets `isBase64Encoded: false` → multipart/binary uploads are silently corrupted; `Set-Cookie` is impossible because the response header type is `Record<string,string>` | `vercel/serverless.ts:52,92,98-104`, `netlify/lib/http.ts:35,96` |
| M-15 | Modal traps Tab but never returns focus to the trigger and does not mark the background inert | `src/components/ui/index.tsx:376-407` |
| M-16 | Command palette uses `combobox`/`listbox` without `aria-activedescendant` (options have no ids) and has no Home/End | `src/components/layout/CommandPalette.tsx:158-163` |
| M-17 | Three tables sit in `overflow-hidden` wrappers instead of `overflow-x-auto`, so latency/path/history columns clip on phones | `src/pages/NetworkDiagnosticsPage.tsx:419,560,1001` |
| M-18 | First-paint JS is ~745 kB min / 232 kB gzip because the entry chunk eagerly pulls the whole 44-article knowledge catalog (via CommandPalette) and **both** i18n dictionaries, plus DashboardPage which is the one non-lazy page | `src/App.tsx:7`, `src/components/layout/AppShell.tsx:6`, `src/components/layout/CommandPalette.tsx:7`, `src/i18n/index.ts:1-2`; measured in `dist/assets/index-go51urGm.js` (61 chunks, ≈1.9 MB JS / 2.1 MB in `dist/assets`); `/toolkit` alone is 356 kB min / 106 kB gzip because the toolkit page statically imports its tool components (`src/pages/ToolkitPage.tsx:10-45`) |
| M-19 | The whole dynamic-content pipeline is unreachable from the UI: `/api/content` answers `{"items":[],"source":"supabase"}` live, no page ever calls the exported `fetchArticles()`, and every knowledge surface (`/solutions`, `/docs`, `/kb`, domain hubs, CommandPalette) reads the bundled `src/data/knowledge*.ts` catalog instead. The CMS, its 2 RLS policies, `content_revisions` and `CONTENT_ADMIN_TOKEN` therefore serve zero end users today | NETLIVE probe 2026-10-30T23:41Z; `src/services/api.ts:252-284` (exported, 0 callers), `netlify/functions/content.ts:5-16` (ignores the `type` param the client sends), `src/pages/{KnowledgePage,DocsHubPage,ArticlePage,DomainPage}.tsx` |

### LOW / INFO

| ID | Finding | Evidence |
| --- | --- | --- |
| L-1 | `og:image` and `twitter:image` still point at the retired hostname `https://nexora-ai.netlify.app/og-cover.png`; `meta description` is duplicated | `index.html:10,11,22,31` |
| L-2 | `normalizeBaseUrl()` does not strip `/api/chat`, so a pasted Ollama chat URL doubles to `/api/chat/api/chat` → upstream 404 | `netlify/lib/ai.ts:47-49` |
| L-3 | Dev middleware reads request bodies with no byte cap, so oversized payloads pass locally and fail in production | `scripts/dev-api-plugin.ts:74` |
| L-4 | Dead `localStorage` key declarations never used: `researchRecent`, `conversations`, `securityLab` | `src/lib/storage.ts:9,12,15` |
| L-5 | Body/response caps are inconsistent per call (4/8/10/12 MB); `readJsonBody` defaults to 8 MB which exceeds both hosts' ceilings — no handler uses the default today | `netlify/lib/http.ts:93`, `netlify/lib/fetch.ts:31-36`, `netlify/lib/ai.ts:176,412,418,455` |
| L-6 | Bundling strategy differs: Netlify keeps `fast-xml-parser` external, Vercel bundles it | `netlify.toml:12` vs `scripts/build-vercel-api.mjs:20` |
| L-7 | 19 ESLint warnings remain (all `react-hooks/exhaustive-deps` / `react-refresh`), three of them real dependency bugs: `DashboardPage.tsx:119` missing `L`, `DomainPage.tsx:72` unstable `allowed`, `SettingsPage.tsx:32` over-specified deps | `npm run lint` LOCAL |
| L-8 | Oversized components: `NetworkDiagnosticsPage.tsx` 1093 lines/5 panels, `SecurityLabPage.tsx` 971, `DashboardPage.tsx` 935, `AdminPage.tsx` 703, `CertDecodeTool.tsx` 742, `src/lib/x509.ts` 1424 | LOCAL reads |
| L-9 | `NET_PROBE_ALLOW_PRIVATE` is read by code but missing from `.env.example` and the README env list, so LAN port scanning is silently undeclared | `netlify/lib/env.ts:61`, `netlify/functions/net-port.ts:19` |
| L-10 | No `.vercelignore` (not needed — `/api`, `dist`, `.env*`, `.local-auth` are git-ignored and the Vercel build regenerates the bundle) | LOCAL |

## 4. Actively verified as correct (do not re-audit)

- No privileged endpoint trusts a client-supplied role, plan or `user_id`; the session is
  derived from the bearer token (`netlify/lib/auth.ts:315-337`).
- Signup hardcodes `standard_member` (`netlify/lib/auth.ts:174`); profile updates write only
  `full_name` (`netlify/functions/auth.ts:429-444`); a DB trigger blocks non-admin role/status
  changes (`supabase/migrations/0001_nexora.sql:82-109`, `0002`, and `0003` which fixes
  `request.jwt.claims` detection under `service_role`).
- `OWNER_EMAIL`/`ADMIN_EMAIL` can never grant a role at sign-in — they only set boolean flags;
  promotion happens exclusively through `scripts/promote-admin.mjs` with `--confirm` and a
  verified-address check. The README claim is TRUE.
- Last-owner / last-super-admin protection exists in **both** the API
  (`netlify/functions/admin.ts:435-454`) and a DB trigger (`0002:126-142`, `0003:81-97`).
- Workspace is scoped by `user_id=eq.<authenticated id>` everywhere including messages
  (`netlify/functions/workspace.ts:121,247-249`) with RLS as a second layer; **no IDOR found**.
- CSRF is genuinely unnecessary today: the API trusts only `Authorization: Bearer` and never an
  ambient cookie (`netlify/lib/auth.ts:117-121`).
- No secret reaches the browser: no `VITE_*`/`NEXT_PUBLIC_*` variable exists anywhere; the only
  `import.meta.env` reads are `DEV`/`MODE`. Provider keys live in memory, or `sessionStorage`
  only when `storeProviderKeysInSession` is on, scoped `nexora.key.<user>.<id>`
  (`src/context/ProvidersContext.tsx:8,53,66-69`). `usage_events` has no key column and audit
  writes redact key-like fields (`netlify/lib/auth.ts:402-418,452-463`).
- OpenRouter key verification is a real authenticated `GET /key`, not a public catalog check
  (`netlify/lib/ai.ts:405-416` + test).
- Grounded-search citations come only from provider annotations, deduped, non-http dropped —
  search mode **cannot** fabricate a source (`netlify/lib/gemini.ts:89-118`).
- `webSearch: 'auto'` really decides via a live-need heuristic and never drops an explicit
  search request (`netlify/lib/gemini.ts:65-68`, `netlify/functions/ai-chat.ts:16`).
- The local triage path is honestly labelled: `offline: true`, a WifiOff badge and explicit
  "not AI-generated" wording (`src/services/localTriage.ts:262,286`,
  `src/pages/TroubleshootingLabPage.tsx:471`, `src/lib/report.ts:48,94`).
- Network tools never invent results: latency reports `truncated`/`platformFailures` and excludes
  platform failures from the loss percentage, with a test asserting "never invents a latency for
  a target that does not answer" (`netlify/functions/net-latency.ts:144-162`); the egress IP is
  explicitly labelled as the **platform's**, never the user's
  (`netlify/functions/net-analyzer.ts:23-34`); the UI discloses serverless/ICMP/raw-socket
  limits (`src/pages/NetworkDiagnosticsPage.tsx:273,371-372,517`).
- `NET_PROBE_ALLOW_PRIVATE` still cannot reach cloud metadata: `169.254.169.254` stays blocked
  unconditionally (`netlify/lib/net-probe.ts:67`). Loopback does become reachable when that flag
  is set — keep it off in the cloud (`netlify/lib/net-diagnostics.ts:33`).
- No `child_process`, `dgram` or raw socket anywhere in `netlify/` → the code is correctly
  shaped for a serverless sandbox. Raw ICMP ping and hop-by-hop traceroute are impossible here,
  which is why `net-ping.ts`/`net-traceroute.ts` were removed; TCP-connect RTT is the stand-in
  (`netlify/lib/net-probe.ts:166-219,240-259`).
- `localAuthEnabled()` cannot fire in production: it needs `NEXORA_LOCAL_AUTH=1` **and**
  non-production `NODE_ENV` **and** absence of `NETLIFY`/`AWS_LAMBDA_FUNCTION_NAME`/
  `LAMBDA_TASK_ROOT` (`netlify/lib/local-auth.ts:121-128`); the live site reports
  `provider=supabase`, `localMode=false`. Local auth uses scrypt (N=16384, r=8, p=1,
  64-byte key), `timingSafeEqual`, 1 h access / 30 d refresh, 20 sessions per account,
  SHA-256-hashed tokens.
- Open redirect is closed: `safeRedirect()` rejects absolute URLs, `//`, `/\`, `://` and control
  characters (`src/lib/redirect.ts:7-16`), and recovery/resend use the env `authSiteUrl`, never
  user input (`netlify/functions/auth.ts:365,383`).
- RTL integrity: zero `ml-`/`mr-`/`pl-`/`pr-`/`left-`/`right-`/`text-left`/`text-right` in
  `src/**`; logical properties throughout; `dir` and `lang` set on `<html>`
  (`src/context/AppContext.tsx:81`); EN/AR key parity and a mojibake guard are tested
  (`tests/i18n.test.ts:7-30`).
- Accessibility basics are strong: 0 icon-only buttons without a label out of ~330, 0 `<button>`
  missing `type`, explicit empty states in charts.
- Fake/decorative UI is nearly absent: zero `TODO`, zero empty `onClick`, zero `href="#"`, all
  31 nav targets resolve to real routes, all 11 `onSubmit` handlers hit `src/services/api.ts`.
  The only decorative control is the Upgrade button (§5).
- Dependency hygiene: `npm audit --omit=dev` = 0 vulnerabilities; all 9 production dependencies
  are imported somewhere; `npm ls --depth=0` clean; `npm ci` matches the lockfile.

## 5. Features that are UI-only, half-wired, or unmeasured

| Item | Reality |
| --- | --- |
| Upgrade / paid plans | `src/pages/AccountPage.tsx:303` only fires an info toast ("Paid subscriptions are not enabled yet"). No payment provider exists. The admin side of manual plans works (`src/pages/AdminPage.tsx:245`). Recommendation: hide the CTA unless the plan is sellable — do not leave a dead button |
| Email verification + recovery | Configured on NETLIVE (`siteUrl=https://adnan-tech.netlify.app`) but **never round-tripped** — needs one real signup (D5) |
| Supabase schema / RLS | Migrations 0001–0003 exist and the live API says `databaseConfigured=true`, but **no read of the real database has been performed** — the linked project `zrlhtrujorfodccetkne` is not reachable with any credential stored on this machine (the local `.secrets` keys belong to project `qxmhxdfttttthuqlhifo`, a different product) |
| AI assistant + grounded search | Code complete, fail-closed and unit-tested, but **`ai.configured=false` and `research.configured=false` on NETLIVE** → the flagship feature has never answered a real request in production (D4) |
| Ping / traceroute | Impossible in this runtime by design; the honest TCP-connect replacements are `net/latency` and `net/path`. Nothing fakes an ICMP result |
| LAN tools (printer agent, private probes) | Work only under `npm run dev` (`localRuntime()` is false on both hosts); the UI says so |
| Tests | 496 pass, but `src/services/api.ts` is only ever `vi.mock`ed and never executed, and 5 of 51 files render components → 26 of 33 pages and 14 of 22 functions have zero coverage, including every admin mutation |

## 6. What I could do without any external credential (already done)

1. Fixed the broken build and removed the dead types (commit `6612d0f`) — deployable again.
2. Committed six days of untracked work (commit `9805209`) and cleaned `.gitignore`
   (`a7c9728`), which had a rule that made `.env.example` uncommittable.
3. Regenerated `api/index.js` so the Vercel dispatcher matches source again (H-5).
4. Measured the live API behaviour in §2 (auth fail-closed, Supabase reachability, news,
   headers) — this is what allowed me to correct the "no live Supabase project" claim.
5. Full static audit with severity, plus an authoritative env-var census
   (`docs/ENVIRONMENT_VARIABLES.md`).

## 7. Required user actions (names only — never paste secret values in chat)

| ID | Action | Where |
| --- | --- | --- |
| D1 | Decide the production host: Netlify (currently working) or Vercel (currently dead). This fixes `NEXORA_SITE_URL` and the Supabase redirect allowlist | decision |
| D2 | Read the failed Vercel production build log: Vercel dashboard → Projects → **adnan-tech** → Deployments → the 2026-10-28 deployment marked Error → **Build Logs**. Or let me use a Vercel API token placed in a git-ignored local file | dashboard |
| D3 | Add to Vercel (both Preview **and** Production scopes, not production only): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXORA_HASH_PEPPER`, `NEXORA_SITE_URL`, `CONTENT_ADMIN_TOKEN` | Vercel dashboard → Project → Settings → Environment Variables |
| D4 | Add `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_ALLOWED_HOSTS` (and optionally `GEMINI_API_KEY`, `GEMINI_WEB_SEARCH_ENABLED=true`, `GEMINI_MODEL`) to enable the assistant and live research | same, on the host chosen in D1 |
| D5 | Approve or decline **one throwaway signup on the live production site** so email verification, profile creation, trial start and a real AI call can be proven end-to-end. It writes one row set to production data | decision |
| D6 | Approve a backup remote (private GitHub repo). I will not push without your go-ahead; note the commit author on this machine is `NEXORA Engineer <engineer@nexora.local>` | decision |
| D7 | Supabase access for project `zrlhtrujorfodccetkne` so RLS and the 0003 trigger can be verified read-only: either a Personal Access Token (supabase.com/dashboard/account/tokens) saved to a git-ignored file such as `D:\Adnan-Web\.secrets\pat.txt`, or run my read-only script in the SQL Editor yourself and paste back only the counts | dashboard |
| D8 | Keep or relax Vercel Deployment Protection for previews. Today every preview 302s to Vercel SSO, which is why anonymous verification is impossible; I verified previews through an authenticated CLI instead. Do not make previews public without asking me to say so | dashboard, and it has a security effect |
| D9 | The errored production deployment stays undeleted until you approve; alias currently points at it | Vercel dashboard |
| D10 | Production deploy happens only after you write the exact phrase **"انشر للإنتاج"** | — |

## 8. Priority order for the fix program

| Wave | Contents | Why first | Status |
| --- | --- | --- | --- |
| W1 safe-now | H-1 fake citations, M-1 pepper fail-closed, M-2 printer default, M-5/M-6/M-7 AI gating and redaction, M-8 health truthfulness, L-1/L-2/L-4, H-6 light-theme contrast, M-9/M-10 | local, testable, no external dependency, and several violate the "no fake results" rule directly | **11 of 13 fixed locally** (`70e1deb` plus the W1 follow-up commits): H-1, M-1, M-2, M-5, M-6, M-7, M-8, L-1, L-2, L-4, M-10 — itemised with proof in §8.1. Still open: M-9 (needs your approval, it widens what "clear everything" deletes) and H-6 (needs a browser pass in the light themes). **None of it is deployed.** |
| W2 platform | H-3 upload caps, H-4 timeout budget, H-5 stale-bundle guard, M-12 Node pin, M-13 CSP on previews only, M-14 binary bodies, L-3/L-5/L-6 | makes both hosts behave the same | **2 of the named items fixed locally** — H-4 (50 s shared deadline, `ai.ts:157`) and H-3 (one `shared/upload-limits.ts`), both in §8.1. Open: H-5, M-12, M-13, M-14, L-3/L-5/L-6. Not deployed |
| W3 security depth | H-7 sign-out sweep + account scoping, H-8 limiter, M-1 content-admin token, M-3 TLS rebinding, M-4 PKCE, H-2 cookie migration | each needs a design decision, ordered by blast radius | not started |
| W4 resilience/UX | H-9 per-route boundary, H-10 single error mapping, M-15/M-16/M-17, M-18 bundle split | user-visible quality | not started |
| W5 verification | §18 mandatory API matrix against preview, the 10 untested surfaces, Lighthouse/axe pass | turns "coded" into "proven" | not started |
| W6 release | C-1/C-2 with your D1–D4, then production only on D10 | gated by owner | blocked on D1–D4, D10 |

### 8.1 Fixed in code, not yet deployed or browser-verified

| ID | What landed | Proof |
| --- | --- | --- |
| H-1 | Recalled analysis URLs are labelled `verified: false`, the invented `retrievedAt` is dropped, the Lab heading and note say the model recalled them, and the prompt tells the model nothing was searched | `tests/analyze-honesty.test.ts` (5) |
| M-1 / M-2 | Trial hashing refuses to start without `NEXORA_HASH_PEPPER`; rate-limit buckets use the per-process `emailBucketKey()`; public printer probing is opt-in | `tests/secure-defaults.test.ts`, `tests/config-truth.test.ts` |
| M-5 | `verifyProviderAuth()` returns `ProviderVerification` and distinguishes an authenticated catalog from a public one; `/api/ai/test` forwards it and the Providers page warns instead of claiming success | `tests/ai-adapter.test.ts` (5 cases) |
| M-6 | `ai/models`, `ai/test`, `research` gate on `ai.use` / `research.read` and record usage; BYOK traffic (`x-tn-key`) is not charged to platform quota | `tests/ai-gating.test.ts` (5) |
| M-7 | Upstream error text is redacted in the shared `mapUpstreamStatus()` instead of a per-file copy | `tests/fetch.test.ts` |
| M-8 | `/api/health` reports derived news/research truth, including `sources` and `invalidCustomFeeds` | `tests/config-truth.test.ts` |
| L-1 | `og:image` / `twitter:image` now point at the live host, and the duplicated `meta description` is one bilingual tag | **Verified live 2026-10-31**: `https://adnan-tech.netlify.app/og-cover.png` → 200 `image/png`; the old `nexora-ai.netlify.app` → 404 |
| L-2 | `normalizeBaseUrl()` strips a pasted `/api/chat` | `tests/ai-adapter.test.ts` |
| L-4 | The three dead `STORAGE_KEYS` entries were deleted (`researchRecent`, `conversations`, `securityLab`); `grep` shows no remaining reference | LOCAL grep + suite green |
| M-10 | The command palette searches all 45 knowledge articles instead of the first 30 | LOCAL count of `slug:` across `src/data/knowledge*.ts`; no palette test exists yet (W5) |
| H-4 | Every AI call now runs inside one `Deadline` (`PLATFORM_BUDGET_MS = 50_000`): each attempt's timeout is clamped to what is left, a spent budget throws a structured `504 timeout` before the platform kills the function, retries stop when the budget cannot fit another attempt, the model fallback shares the primary model's budget, and `/api/ai/test` shares one budget across verification + catalog | `tests/ai-adapter.test.ts` → `describe('request budget')` (6 cases, incl. the abort timer actually receiving the clamped value) |
| H-3 | Upload sizes now have one owner: `shared/upload-limits.ts` sets a 3 MB image (≈4 MB of base64, ≈4.1 MB of body), and `src/lib/utils.ts`, `netlify/lib/schema.ts`, `netlify/lib/ai.ts`, `ai-analyze`, `content-admin` and `vercel/serverless.ts` all import from it instead of inventing their own number. The EN/AR upload hint says 3 MB, matching what the code enforces | `tests/upload-limits.test.ts` (6) — includes the base64-inflation arithmetic and a UI-copy check; **mutation-checked**: setting the cap back to 4 MB fails 2 of those tests |

Still open from W1: **M-9** (the export/clear list omits keys the app writes — and the inventory is
worse than the register said: `nexora.ioc.v1`, `nexora.vulns.v1`, `nexora.cidr-plan.v1`,
`nexora.mtu-config.v1`, `nexora.capacity-input.v1`, `nexora.certdecode.prefs.v1` and
`nexora.net.ip.v1` hold member data yet are written **unscoped**, so two accounts on one browser see
the same lab data). Widening "clear everything" also widens what gets deleted, so it needs your go-ahead.
**H-6** needs a real browser in each light theme.
