# TESTING REPORT — Adnan Tech | منصة عدنان تك

Date: 2026-10-31. Every row states the environment it was measured in and carries one of
`PASS` / `FAIL` / `BLOCKED` / `NOT SUPPORTED` / `NOT TESTED`.
Environments: **LOCAL** = this machine (Windows 10.0.26300, Node v24.22.0, Git Bash),
**NETLIVE** = https://adnan-tech.netlify.app, **VPROD** = Vercel production alias,
**VPREV** = Vercel preview reached via `vercel curl` (authenticated CLI, bypasses SSO).

This report replaces `docs/ADNAN_TECH_TEST_REPORT.md` (2026-10-27), whose numbers no longer
match the suite.

## 1. Gates (the commands an owner can copy)

| Gate | Command | Environment | Result | Measured |
| --- | --- | --- | --- | --- |
| Types | `npm run typecheck` | LOCAL | **PASS** | 0 errors |
| Lint | `npm run lint` | LOCAL | **PASS with warnings** | 0 errors, 19 warnings (all `react-hooks/exhaustive-deps`, 2 files own 11 of them: `DomainPage.tsx:72-76`, `SettingsPage.tsx:32`) |
| Tests | `npm test` | LOCAL | **PASS** | 46 files, 456 tests, 0 failed, 11.40 s wall |
| Build | `npm run build` | LOCAL | **PASS** | `tsc --noEmit && vite build`, 573 ms (second run same day) |
| Vercel API bundle | `npm run build:vercel-api` | LOCAL | **PASS** | `api/index.js` ≈1.17 MB, 22 routes |
| Dependency audit | `npm audit --omit=dev` | LOCAL | **PASS** | 0 vulnerabilities in the 9 production deps |
| Coverage | `npm run test:coverage` | LOCAL | **FAIL (tooling)** | `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'` — the script is published but the provider is not installed, so **no coverage percentage exists for this project** |

`npm run build` was broken for 4 days before this session (2 × TS6133 from dead imports left by the
removed English Coach page). Restored in commit `6612d0f`; the green row above is the proof.

## 2. What the 456 tests actually cover

Top of the suite by test count:
`x509 37 · csv 25 · gemini-research 23 · cidr-overlap 21 · permissions 19 · ai-adapter 17 ·
incidents 17 · diff 16 · vercel-bridge 16 · operations 15 · mtu 14 · trial 14 · calculators 13 ·
net-analysis 13 · capacity 12 · speedtest 12 · tool-ui 11 · local-auth 10 · rbac 10`

Server-side (the part that holds secrets and money) — 17 of 23 `netlify/lib/*` files and 4 of 22
`netlify/functions/*` files are imported by at least one test:

| Covered | Not covered by any test |
| --- | --- |
| `ai`, `auth`, `env`, `fetch`, `gemini`, `http`, `local-auth`, `net-analysis`, `net-diagnostics`, `net-doh`, `net-latency`, `net-path`, `net-probe`, `prompts`, `rbac`, `schema`, `trial` | **`host.ts` (the SSRF guard)**, `json.ts`, `net-errors.ts`, **`supabase.ts`**, `tls.ts` |
| functions: `ai-chat`, `auth`, `health`, `news` | the other 18 functions, including **all of `admin.ts`**, `content-admin.ts`, `ai-analyze.ts`, `ai-script.ts`, every `net-*` handler |

Frontend: 27 `src/lib/*` pure modules and 5 tool/UI files render under test (`tool-ui`,
`toolkit-additions`, `copilot-research`, `new-surfaces`, `register-page`).
**26 of 33 pages and 5 of 18 tool modules have no test.**
`src/services/api.ts` — the 650-line module every page depends on — **is imported by zero tests**.

Notable behavioural tests that exist and pass (these are the ones worth keeping honest):
- `tests/vercel-bridge.test.ts` (16) — the req/res→Lambda adapter, body cap, header mapping.
- `tests/access-control.test.ts` (7) — permission matrix against the real role table.
- `tests/auth-session.test.ts` (8) + `tests/local-auth.test.ts` (10) — token store, scrypt params, session cap.
- `tests/net-probe.test.ts`, `net-port.test.ts`, `net-latency.test.ts`, `net-path.test.ts` — the private-address rejections.
- `tests/gemini-research.test.ts` (23) — grounding citation parsing and `redact()`.

## 3. Live API matrix (NETLIVE, re-run 2026-10-30T23:41Z)

| Endpoint | Method | Expected | Measured | Verdict |
| --- | --- | --- | --- | --- |
| `/api/health` | GET | 200 + honest per-service flags | 200 in 1.62 s; `ai.configured=false`, `research.configured=false`, `grounded.model="gemini-flash-latest"`, `news.configured=true` | **PASS**, except the hardcoded `news` flag (M-8) |
| `/api/auth?action=config` | GET | 200, provider disclosure | 200 in 1.10 s; `provider=supabase`, `authConfigured=true`, `databaseConfigured=true`, `ownerConfigured=true`, `adminConfigured=false`, `localMode=false`, `siteUrl=https://adnan-tech.netlify.app`, trial 30 d, password 8–128 | **PASS** — proves the deployment really reaches Supabase |
| `/api/auth` login, wrong credentials | POST | 401, no user enumeration | 401 `invalid_credentials` with upstream detail `Invalid login credentials` | **PASS** (identical answer for unknown vs wrong password; see SECURITY_AUDIT §4) |
| `/api/ai/chat` | POST, no token | fail closed | 401 `{"code":"unauthorized","message":"Sign in to use the AI assistant."}` | **PASS** |
| `/api/net/dns?host=example.com` | GET, no token | fail closed | 401 `Sign in to continue.` | **PASS** |
| `/api/ai/models` | GET, no token | fail closed | 401 | **PASS** (anonymous). With a token it needs only `workspace.read`, not `ai.use` → M-6 |
| `/api/research?q=test` | GET, no token | fail closed | 401 | **PASS** (anonymous). Real calls are POST-gated; same M-6 gap |
| `/api/content` | GET | 200 + published rows | 200 in 2.14 s `{"items":[],"source":"supabase"}` | **PASS technically / FAIL as a product** — the `articles` table has no published rows, and no page consumes this endpoint (new finding M-19) |
| `/api/news` | GET | 200 + real publisher items | 200 in **7.16 s**, real BleepingComputer item present | **PASS with warning** — 7 s cold path is the slowest endpoint measured; cache TTL not verified |
| Security headers on `/` | GET | CSP, HSTS, nosniff, frame deny, referrer, permissions, COOP | all present, `frame-ancestors 'none'`, `object-src 'none'` | **PASS** |

## 4. Live environment matrix (Vercel + dev)

| Probe | Environment | Verdict |
| --- | --- | --- |
| Production alias `adnan-tech-adnan-mohamed.vercel.app` | VPROD | **FAIL** — 404 `DEPLOYMENT_NOT_FOUND`; the production deployment is in `Error` (audit C-2) |
| `https://adnan-tech.vercel.app` | VPROD | **FAIL** — `DEPLOYMENT_NOT_FOUND`; the hostname has never been assigned to this project (C-2) |
| `/api/health` | VPREV | **PARTIAL PASS** — 200 but `database.configured=false`, `contentAdmin.configured=false` → zero Supabase env vars on the Vercel project (C-3) |
| Anonymous `GET /` | VPREV | **PASS as configured** — 302 to `vercel.com/sso-api`; Deployment Protection is ON. Left ON deliberately: it is the owner's stated preference not to make previews public |
| Stale bundle check | LOCAL | **FIXED + PASS** — `api/index.js` was missing `/api/net/latency` and `/api/net/path`; regenerated, both now resolve (H-5) |
| Dev API plugin, `/api/*` in-process | LOCAL | **PASS** — handlers run inside Vite via `scripts/dev-api-plugin.ts`; auth uses the file store, not Supabase (`.env.local` has no Supabase vars) |
| Supabase-backed flows from LOCAL | LOCAL | **BLOCKED** — no `SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY` locally, so every RLS/admin/email test needs either the owner's env pull or a seeded test project (owner action D1/D2) |
| Any AI answer end-to-end (chat, analyze, script, grounded search) | NETLIVE, VPREV | **BLOCKED** — `ai.configured=false`; no provider key on either host (owner action D6) |
| `Mailer` / signup e-mail delivery | NETLIVE | **BLOCKED** — needs a real mailbox; requires D5 (SMTP) before it can be called tested |

## 5. Security tests performed by hand

Full write-up in `docs/SECURITY_AUDIT.md`; verdicts only here.

| Test | Environment | Verdict |
| --- | --- | --- |
| Command injection surface | LOCAL | **PASS / NOT APPLICABLE** — `git grep` finds no `child_process`, `exec`, `spawn`, `dgram`, or raw socket anywhere in `netlify/` |
| SQL injection surface | LOCAL | **PASS** — no SQL strings; PostgREST query params are `encodeURIComponent`-ed (`netlify/lib/supabase.ts`), so injection is structural, not policy-dependent |
| Path traversal in uploads | LOCAL | **PASS** — server-generated keys; no user-controlled path segment reaches storage |
| SSRF: loopback / RFC1918 / link-local / CGNAT / `169.254.169.254` | LOCAL (unit) | **PASS** at the unit level; **NOT TESTED** against the live function because no session token exists |
| DNS-rebinding TOCTOU on `assertPublicHost` | LOCAL | **FAIL (accepted risk, M-3)** — resolution is checked then re-resolved by the connector; needs pinning at connect time |
| Client-bundle secret scan | LOCAL + NETLIVE | **PASS** — no `VITE_*`/`NEXT_PUBLIC_*` exists; grep of `dist/` and the served JS finds no key material |
| Role escalation through the request body | LOCAL | **PASS** — no handler reads `role`; DB triggers block privilege writes (migrations 0001:82, 0002:84, 0003:39) |
| Rate limiting under parallel load | — | **NOT TESTED**; and it is in-memory per container (H-8), so a load test would prove weakness, not strength |
| CSP effect on Vercel Toolbar | VPREV | **FAIL (cosmetic, M-13)** — reported CSP violation from the injected toolbar script; app functionality unaffected. Production CSP will not be weakened to silence it |

## 6. Performance measurements

| Metric | Environment | Value | Verdict |
| --- | --- | --- | --- |
| Vite production build time | LOCAL | 573 ms | PASS |
| Entry chunk | LOCAL | 745.58 kB min / **231.87 kB gzip** (`index-go51urGm.js`) | **FAIL vs budget** (target < 200 kB gzip first paint) → M-18 |
| Largest lazy chunk | LOCAL | `ToolkitPage` 356.75 kB / 108.12 kB gzip | WARN — 43 tools statically imported |
| `utils` shared chunk | LOCAL | 171.66 kB / 53.68 kB gzip | INFO |
| Total JS emitted | LOCAL | 61 chunks, ≈1.9 MB minified (2.1 MB in `dist/assets`) | PASS (splitting works; the problem is only the entry) |
| Slowest live endpoint | NETLIVE | `/api/news` 7.16 s | WARN — first call after idle |
| Typical API call | NETLIVE | 1.1–2.1 s | PASS for serverless cold starts |
| Test suite wall time | LOCAL | 11.40 s, 70 % of tracked time spent creating 46 jsdom environments | WARN — `pool: 'vmThreads'` or `isolate: false` is the documented fix; not applied yet |
| Lighthouse | — | **NOT TESTED** — no browser run recorded in this phase |
| Real-device / mid-tier network | — | **NOT TESTED** |

## 7. UI, accessibility, responsive — NOT TESTED

The master prompt's Phase 9 and Phase 13 need a browser. What exists today is static reasoning
plus 5 rendering tests, which is not enough to claim any of the following:

| Surface | Status |
| --- | --- |
| Desktop / laptop / tablet / mobile layout at 1440, 1024, 768, 390 px | **NOT TESTED** |
| RTL (Arabic) visual parity on the 5 pages that switch direction | **NOT TESTED** (clean in code; 0 mixed-direction strings found by grep) |
| Keyboard-only navigation, focus rings, skip link | **NOT TESTED** — and M-15/M-16 are known defects (modal focus restore, palette `aria-activedescendant`) |
| Screen-reader labels on the 43 tools | **NOT TESTED** |
| 11 themes × light/dark contrast | **NOT TESTED**; H-6 flags light-theme contrast specifically |
| Reduce-motion toggle actually stopping animation | **NOT TESTED** |
| Every page under a real authenticated session | **NOT TESTED** — blocked on D1/D5/D6 |

## 8. Highest-risk untested surfaces (what a new test should attack first)

1. `src/services/api.ts` — 650 lines, 0 tests, every page depends on it.
2. `netlify/lib/host.ts` + `supabase.ts` — the SSRF guard and the DB client are both uninstrumented.
3. `netlify/functions/admin.ts` — every mutation (role change, suspension, delete, export) is unverified.
4. `workspace.ts` upload path — size/MIME/binary behaviour, and M-14 says the Vercel bridge corrupts binary bodies.
5. The whole AI answer chain on a real provider (H-1 fake citations, M-7 key redaction in upstream errors).
6. Entitlement enforcement: a member without `ai.use` calling `/api/ai/test` (M-6, live-reproducible once a token exists).

## 9. Honest verdict

| Question | Answer |
| --- | --- |
| Does the code compile, lint, test and build? | **YES**, measured LOCAL 2026-10-31. |
| Is the Netlify production site live and functioning for anonymous visitors? | **YES** for SPA + health/auth-config/content/news; AI and network tools need sign-in and there is no provider key. |
| Is the platform usable by a real signed-up user today? | **NOT VERIFIED.** Auth reaches Supabase (proven by the 401 upstream detail), but no session was ever obtained in this audit, so register → verify → login → use-a-tool has not been walked end-to-end. |
| Is Vercel production usable? | **NO.** Dead production alias (C-2) and missing env vars (C-3). Owner actions D1–D4. |
| Is it safe to publish? | **NO**, not until W1 lands (H-1 fake citations and M-1 pepper default directly contradict the product's own no-fake-results and fail-closed rules). |
| Ready to mark production-approved? | **NOT TESTED / NOT READY.** The blocking set is: W1 fixes, one authenticated end-to-end walk, one real AI answer, one upload ≤ and > the cap, one live SSRF attempt, and a browser pass over §7. |
