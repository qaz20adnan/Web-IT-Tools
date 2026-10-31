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
| Lint | `npm run lint` | LOCAL | **PASS with warnings** | 0 errors, 16 warnings — down from 19 when the three real `react-hooks/exhaustive-deps` bugs were fixed (`DashboardPage.tsx:87`, `DomainPage.tsx:75`, `SettingsPage.tsx:38`). Every warning left is `react-refresh/only-export-components`: 11 in the six `src/context/*.tsx` provider+hook modules, 5 in `main.tsx`, `components/charts/index.tsx`, `components/ui/index.tsx` and `components/tools/PortCheckTool.tsx` |
| Tests | `npm test` | LOCAL | **PASS** | 56 files, 541 tests, 0 failed, 13.9–19.8 s wall (it swings 11–27 s between runs — the M-14 byte tests allocate 4 MB buffers and jsdom is created once per file, 88–124 s of environment time across workers) |
| Build | `npm run build` | LOCAL | **PASS** | `tsc --noEmit && vite build && build:vercel-api`, 0.53–0.66 s depending on cache (entry chunk 746.76 kB min / 232.20 kB gzip) |
| Vercel API bundle | now inside `npm run build` | LOCAL | **PASS** | `api/index.js` 1179 kB, 22 routes |
| Dependency audit | `npm audit --omit=dev` | LOCAL | **PASS** | 0 vulnerabilities in the 9 production deps |
| Coverage | `npm run test:coverage` | LOCAL | **FAIL (tooling)** | `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'` — the script is published but the provider is not installed, so **no coverage percentage exists for this project** |

`npm run build` was broken for 4 days before this session (2 × TS6133 from dead imports left by the
removed English Coach page). Restored in commit `6612d0f`; the green row above is the proof.

## 2. What the 541 tests actually cover

Top of the suite by test count:
`x509 37 · ai-adapter 26 · csv 25 · api-error 24 · gemini-research 23 · cidr-overlap 21 ·
vercel-bridge 20 · permissions 19 · incidents 17 · diff 16 · operations 15 · mtu 14 · trial 14 ·
calculators 13 · net-analysis 13 · capacity 12 · speedtest 12 · tool-ui 11 · local-auth 10 · rbac 10`

Server-side (the part that holds secrets and money) — 18 of 23 `netlify/lib/*` files and 8 of 22
`netlify/functions/*` files are imported by at least one test:

| Covered | Not covered by any test |
| --- | --- |
| `ai`, `auth`, `env`, `fetch`, `gemini`, `http`, `local-auth`, `net-analysis`, `net-diagnostics`, `net-doh`, `net-latency`, `net-path`, `net-probe`, `prompts`, **`rate`**, `rbac`, `schema`, `trial` | **`host.ts` (the SSRF guard)**, `json.ts`, `net-errors.ts`, **`supabase.ts`**, `tls.ts` |
| functions: `ai-analyze`, `ai-chat`, `ai-models`, `ai-test`, `auth`, `health`, `news`, `research` | the other 14 functions, including **all of `admin.ts`**, `content-admin.ts`, `ai-script.ts`, every `net-*` handler |

Frontend: 27 `src/lib/*` pure modules are unit-tested, plus `src/services/apiError.ts` and
`src/services/api.ts` (see below), and 5 tool/UI files render under test (`tool-ui`,
`toolkit-additions`, `copilot-research`, `new-surfaces`, `register-page`).
**26 of 33 pages and 5 of 18 tool modules have no test.**
`src/services/api.ts` — the 650-line module every page depends on — **was never executed by a test
before H-10**; the only reference to it was `vi.mock('@/services/api')` in
`tests/copilot-research.test.tsx:42`. `tests/api-error.test.ts` now imports it for real and drives
`getHealth`, `workspaceRequest` and `authMe` against a stubbed `fetch`, which proves the 401
refresh-and-replay, the `Retry-After` parse and the error envelope. Still unexercised in it: every
upload path, every admin call and the non-JSON branch.

Notable behavioural tests that exist and pass (these are the ones worth keeping honest):
- `tests/vercel-bridge.test.ts` (20) — the req/res→Lambda adapter, header mapping, and that
  `npm run build` itself contains the bundle step (so Vercel cannot be handed a stale `api/`).
  Since M-14 the event body is base64, so it also proves a PNG-header buffer arrives byte-for-byte,
  multibyte Arabic text survives, the 4.5 MB cap is measured on raw bytes (4 MB of `0xFF` encodes to
  ≈5.33 MB and must still pass), and a handler reading `readJsonBody()` gets the decoded object.
  **Mutation-checked**: encoding the body as `utf8` again fails 5 of the 20.
- `tests/route-parity.test.ts` (4) — the same `/api` tree on all three hosts: the route list is
  derived from `netlify/functions/*.ts` + `netlify.toml`, then compared with `vercel/dispatcher.ts`,
  the dev plugin's file lookup, and every `'/api/…'` literal under `src/` (scanned recursively).
  **Mutation-checked**: dropping `net/path` from the dispatcher fails 2 of the 4, and a fake
  `'/api/net/nonexistent'` added to a page fails the frontend scan.
- `tests/runtime-pin.test.ts` (3) — `engines.node`, `.nvmrc`, `netlify.toml NODE_VERSION` and the
  esbuild target must name one Node major, and the pin must be a single major rather than a range
  (Vercel resolves `>=x` to its newest runtime, not its floor). **Mutation-checked**: `NODE_VERSION =
  "24"` in `netlify.toml` fails the cross-declaration test.
- `tests/security-headers.test.ts` (4) — the seven security headers exist on both hosts, the two
  copies are byte-identical (the CSP lives twice: `netlify.toml` and `vercel.json`), the hardening
  directives survive (`script-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, no
  `unsafe-eval`), and no application file uses `new WebSocket` / `wss:` / `new EventSource` while
  `connect-src` has no websocket scheme. **Mutation-checked**: `wss:` added to the Netlify copy only
  fails the parity test; a `new WebSocket(...)` in `src/lib/utils.ts` fails the absence check.
- `tests/error-boundary.test.tsx` (4) — H-9's containment claim, rendered rather than asserted from
  source: a component that throws shows the fallback **and** a sibling `<nav>` outside the boundary
  is still in the DOM, which is the difference between "one page is broken" and "the app is gone".
  Three structural guards follow: the boundary is keyed per `pathname` inside the routes component,
  the root boundary is still mounted above `BrowserRouter`, and `ErrorBoundary.tsx` imports no router
  module (a `Link` in the root fallback would throw a second error, outside any Router context).
  **Mutation-checked**: removing `key={pathname}` fails the structural guard.
- `tests/api-error.test.ts` (24) — H-10's transport contract, the first suite that executes
  `src/services/api.ts` for real. Four behavioural groups: the server emits `Retry-After` from the limiter's own
  window and — the bug the fix had to avoid — does **not** leak it onto the shared `BASE_HEADERS`
  object that every later response reuses; `ApiError` parses both RFC 9110 §10.2.3 forms, ignores an
  unparsable one and clamps an absurd one; a 401 on the ambient session token refreshes once and
  replays, with the positive case and the six guards that bound it asserted individually (one retry
  only, never `/api/auth`, never a caller-supplied token, never a guest with no token to lapse, never
  a 403, no replay when the refresh yields nothing); and one mapping from a caught value to readable
  text, closed by a recursive scan proving no second `errorMessage()` survives under `src/`. Two
  structural guards follow, on the layering that decided where the mapper may live: nothing under
  `src/lib` imports `services`/`pages`/`components`/`context`/`hooks`, and nothing under
  `src/services` imports React — `describeError` has to `instanceof` the `ApiError` that
  `services/api.ts` defines, so in `lib` it would have pointed upward.
  **Mutation-checked** six ways: reverting the header to a direct assignment, dropping the `replayed`
  flag so the 401 loops, replacing `describeError` with a naive `error.message` (fails 4 of the
  mapping tests), removing only the `error.status === 429 &&` gate so a 503 that happens to carry the
  header gets called "too many requests", copying the mapper back into `src/lib/apiError.ts`, and
  adding `import { useState } from 'react'` to `src/services/localTriage.ts` (each reverted from a
  copy, never from git).
- `tests/access-control.test.ts` (7) — permission matrix against the real role table.
- `tests/auth-session.test.ts` (8) + `tests/local-auth.test.ts` (10) — token store, scrypt params, session cap.
- `tests/net-probe.test.ts`, `net-port.test.ts`, `net-latency.test.ts`, `net-path.test.ts` — the private-address rejections.
- `tests/gemini-research.test.ts` (23) — grounding citation parsing and `redact()`.
- `tests/upload-limits.test.ts` (8) — one image cap across browser, schema, handlers and the Vercel
  bridge: it checks the base64 inflation really fits the body cap, runs a too-large file through
  `validateImageFile`, and reads the EN/AR upload hint so the promised number cannot drift from the
  enforced one. **Mutation-checked**: restoring the old 4 MB cap fails 2 of the 6. Since L-5 it also
  parses every `netlify/functions/*.ts` source and requires each `readJsonBody` call to carry its own
  cap, rejecting any numeric literal above `MAX_BODY_BYTES`; since L-3 it requires the dev plugin to
  import `shared/upload-limits` and compare against `MAX_BODY_BYTES`. **Mutation-checked again both
  ways**: putting the `= 8 * 1024 * 1024` default back *and* raising `ai-chat` to 6 MB fails the cap
  test, and neutering the dev plugin's guard to `if (false)` fails the dev-adapter check.
- `tests/ai-adapter.test.ts` → `describe('request budget')` (6) — the 50 s shared AI deadline: the
  clamped value really reaches the upstream abort timer, a spent budget returns a structured
  `504 timeout` without sending a request, retries stop instead of overrunning, and the model
  fallback consumes the primary model's budget rather than starting a second one.

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
| Stale bundle check | LOCAL | **FIXED + PASS** — `api/index.js` was missing `/api/net/latency` and `/api/net/path`; regenerated, both now resolve. The recurrence path is closed: `npm run build` regenerates the bundle, and `tests/route-parity.test.ts` fails if a route exists on one host and not another (H-5). **No CI exists**, so that guard only runs when the suite is run by hand |
| Dev API plugin, `/api/*` in-process | LOCAL | **PASS** — handlers run inside Vite via `scripts/dev-api-plugin.ts`; auth uses the file store, not Supabase (`.env.local` has no Supabase vars) |
| Dev API plugin body cap (L-3) | LOCAL | **PASS at the source level only** — the plugin now imports `MAX_BODY_BYTES` from `shared/upload-limits`, destroys a request past it and answers with the hosts' `payload_too_large` envelope; `tests/upload-limits.test.ts` asserts both and mutation-fails when the guard is neutered to `if (false)`. **Not verified over a live HTTP round trip** — no dev server was started with an over-cap body |
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
| Vite production build time | LOCAL | 529–663 ms | PASS |
| Entry chunk | LOCAL | 746.76 kB min / **232.20 kB gzip** (`index-iyN_9mkG.js`) | **FAIL vs budget** (target < 200 kB gzip first paint) → M-18 |
| Largest lazy chunk | LOCAL | `ToolkitPage` 356.75 kB / 108.21 kB gzip | WARN — 43 tools statically imported |
| `utils` shared chunk | LOCAL | 171.66 kB / 53.68 kB gzip | INFO |
| Total JS emitted | LOCAL | 61 chunks, ≈1.9 MB minified (2.1 MB in `dist/assets`) | PASS (splitting works; the problem is only the entry) |
| Slowest live endpoint | NETLIVE | `/api/news` 7.16 s | WARN — first call after idle |
| Typical API call | NETLIVE | 1.1–2.1 s | PASS for serverless cold starts |
| Test suite wall time | LOCAL | 13.9–19.8 s, 65–72 % of tracked time spent creating 56 jsdom environments (88–124 s across workers) | WARN — `pool: 'vmThreads'` or `isolate: false` is the documented fix; not applied yet |
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
| Is it safe to publish? | **CONDITIONALLY.** The two rule-breaking findings are fixed in the working tree — H-1 (model-recalled URLs are now labelled unverified in the payload and in the UI) and M-1 (trial hashing refuses to start without `NEXORA_HASH_PEPPER`) — plus M-5/M-6/M-7/M-8/L-2. They are **verified only by unit tests on LOCAL**, not deployed, and the remaining W1 items (L-1, L-4, M-9, M-10, H-6) are open. Publishing is still owner-gated by D10. |
| Ready to mark production-approved? | **NOT TESTED / NOT READY.** The blocking set is now: deploy the W1 batch, one authenticated end-to-end walk, one real AI answer, one upload ≤ and > the cap, one live SSRF attempt, and a browser pass over §7. |
