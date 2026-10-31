# CHANGELOG — Adnan Tech | منصة عدنان تك

Format: newest first. Every entry states whether it was **verified** (measured by a command in this
session) or **not verified** (code present, no measurement possible without owner actions D1–D10).
Older undated history is not reconstructed here; `git log` is authoritative for commits.

---

## Unreleased — 2026-10-31 (audit phase + foundation repair)

### Added
- `docs/PROJECT_AUDIT.md` — full findings register: 4 CRITICAL, 10 HIGH, 19 MEDIUM, 10 LOW/INFO (11 since this session added L-11),
  each with file:line evidence, plus a measured live-environment table and the owner-action list
  D1–D10. **Verified** (live probes against NETLIVE/VPROD/VPREV + LOCAL gate runs).
- `docs/ENVIRONMENT_VARIABLES.md` — authoritative variable census extracted from code, with the
  proof that no `VITE_*`/`NEXT_PUBLIC_*` variable exists in the repository. **Verified.**
- `docs/SECURITY_AUDIT.md` — threat model, injection matrix, auth/session/RBAC/secrets/headers
  review, dependency audit. **Verified** where marked; live-reproduction items are marked BLOCKED.
- `docs/ARCHITECTURE.md` — current-state architecture (layers, handler contract, 22-route table,
  cross-cutting invariants, host capability matrix) and the four-item target architecture (W-1…W-4),
  with the explicit decision **not** to adopt a backend framework, ORM, Redis or Next.js.
- `docs/TESTING_REPORT.md` — per-gate verdicts, per-file test counts, the live API matrix re-run,
  performance numbers, and the honest "NOT TESTED" list for browser/accessibility work. **Verified.**
- `docs/DEPLOYMENT_GUIDE.md` — operator runbook: both host paths in order, Supabase setup, the
  12-point post-deploy checklist with today's status, rollback per host, and the rules that gate a
  production deploy ("انشر للإنتاج", no CSP weakening, no secret in chat, previews stay protected).

### Fixed
- **Build restored.** `npm run build` had failed for 4 days: two `TS6133` unused-import errors in
  `src/components/tools/SecurityTools.tsx` (left by the removed English Coach page). Removed the
  dead `useEffect`/`useSearchParams` imports and the three orphaned types in `src/types/index.ts`
  (`EnglishLevel`, `CoachMessage`, `CoachConversation`). **Verified**: typecheck 0 errors, lint 0
  errors / 19 warnings, 46 files / 456 tests pass, `vite build` 573 ms. Commit `6612d0f`.
- **`.gitignore` rule order.** A duplicated `.env*` line at the end overrode `!.env.example`, making
  the example env file impossible to commit. Rewrote the file; **verified** with
  `git check-ignore --no-index -v`. Commit `a7c9728`.
- **Stale Vercel API bundle.** The generated `api/index.js` was missing `/api/net/latency` and
  `/api/net/path`, so Vercel would have served a 404 for both while Netlify and dev worked.
  Regenerated with `npm run build:vercel-api` (~1.17 MB, 22 routes). **Verified** by grep of the
  regenerated bundle. (Finding H-5.)
- **W2 · H-3 upload caps** (same wave): the screenshot path no longer has four different opinions
  about size. `shared/upload-limits.ts` is now the single owner — a **3 MB** image, which becomes
  ≈4 MB of base64 and ≈4.1 MB of JSON body, under the 4.5 MB ceiling the Vercel bridge enforces
  before any handler runs. `src/lib/utils.ts`, `netlify/lib/schema.ts`, `parseImageDataUrl()`,
  `ai-analyze`, `content-admin` and `vercel/serverless.ts` all import those constants instead of
  writing their own number (the server previously allowed an 8 MB body the platform would never
  deliver, and content-admin a 5 MB body the bridge rejected first). The EN and AR upload hints now
  state 3 MB, matching what the code enforces — the promise and the limit can no longer disagree,
  because a test reads both.
  **Verified**: typecheck 0 errors; lint 0 errors / 19 warnings; `npm test` 51 files / 496 tests in
  12.46 s (new `tests/upload-limits.test.ts` 6 tests; `ai-adapter` 20 → 26 from the H-4 batch);
  `npm run build` 524 ms; `npm run build:vercel-api` regenerated and the bundle contains
  `3 * 1024 * 1024` + `4.5 * 1024 * 1024`. **Mutation-checked**: setting the cap back to 4 MB fails
  2 of the 6 new tests, so they are not vacuous.
  **Not verified**: no real browser upload against a live provider — that stays on the W5 checklist.
  Not deployed.

- **W2 · H-4 request budget** (first item of the platform wave): the AI layer no longer lets the
  platform kill it. One `Deadline` (`PLATFORM_BUDGET_MS = 50_000`, `netlify/lib/ai.ts:157`) now wraps
  every completion: each upstream attempt gets `min(AI_TIMEOUT_MS, budget left)`, a budget too spent
  to answer returns a structured `504 timeout` **before** any request goes out, a transient failure
  stops retrying once another attempt cannot fit (and reports the real cause — 429 stays 429, it is
  not disguised as a timeout), and the model fallback runs inside the primary model's budget instead
  of starting a fresh 60 s. `/api/ai/test` shares one budget across credential verification and the
  catalog read, which could previously reach ~90 s. `.env.example` documents the clamp.
  **Verified**: `npm run typecheck` 0 errors; `npm run lint` 0 errors / 19 warnings; `npm test`
  50 files / 490 tests in 10.53 s (new: `describe('request budget')` 6 cases in
  `tests/ai-adapter.test.ts` 20 → 26 — the abort-timer clamp is asserted by capturing the real
  `setTimeout` call, not by reading the code); `npm run build` 464 ms.
  **Not verified**: no live provider was made to hang for 50 s, so the budget has only been proven
  against mocked fetches. Nothing here is deployed.

- **W2 · H-5 stale-bundle guard** (closes the earlier "Stale Vercel API bundle" fix above so it
  cannot happen again). Two independent holes were involved, not one:
  1. the bundle itself — `npm run build` was `tsc --noEmit && vite build` and the `api/index.js`
     rebuild lived only in `vercel.json`. Any local build, Netlify build or hand-run deploy left a
     bundle behind that no longer matched source (measured again during this work: `api/index.js`
     built 04:17, `vercel/dispatcher.ts` changed 04:34). Now `package.json:14` ends with
     `build:vercel-api` and `vercel.json:4` is just `npm run build`, so there is one definition of
     "a build" and forgetting a step is no longer possible.
  2. the route list — the only tests that knew the 22 API paths carried a hand-copied array, so a
     route added to `netlify/functions/` but missed in the dispatcher could pass anyway.
     `tests/route-parity.test.ts` (new, 4 tests) derives the expected tree from
     `netlify/functions/*.ts` + the explicit `netlify.toml` redirects and checks it against
     `vercel/dispatcher.ts`, against the dev plugin's `<path>.ts` / `<path with / → ->.ts` lookup,
     against the wildcard ordering in `netlify.toml`, and against every `'/api/…'` literal under
     `src/` (walked recursively, so a `fetch` added to a page is caught, not just the service module).
  **Verified**: typecheck 0 errors; lint 0 errors / 19 warnings; `npm test` 52 files / 500 tests in
  12.74 s; `npm run build` 467 ms + `api/index.js` 1179 kB. **Mutation-checked**: removing
  `'net/path'` from the dispatcher fails 2 of the 4 parity tests, a fake
  `'/api/net/nonexistent'` added to `SettingsPage.tsx` fails the frontend scan, and `npm run build`
  without the bundle step fails the `vercel-bridge` pipeline test — all three restored afterwards.
  **Not verified / limitation**: this repository has **no CI** (`.github/`, `.gitlab-ci.yml`,
  `.circleci` all absent), so the parity guard only runs when someone runs `npm test` by hand; and
  `vercel dev` against a bundle built before the last source edit still needs the rebuild that now
  happens in `npm run build`. Not deployed.

- **W2 · M-12 Node runtime pin** (same wave): the repository now names one Node major in the four
  places that each used to name their own — `package.json engines.node` (`>=20.19` → **`22.x`**),
  a new `.nvmrc`, `netlify.toml [build.environment] NODE_VERSION` and the esbuild
  `target: 'node22'` in `scripts/build-vercel-api.mjs`. Two facts from Vercel's own reference made
  the old range meaningless: an open range resolves to the **highest** runtime Vercel offers
  (26.x today; 26/24/22 are the only choices), and Node 20 was dropped from Builds and Functions on
  2026-10-01. So `>=20.19` was really "whatever is newest", while Netlify built on 22. `engines.node`
  also overrides the Vercel project dropdown, so no dashboard change is needed.
  **Chose 22 over 24 deliberately** (the first audit note said "pin 24"): Netlify is the host that
  serves live traffic, its build already declared 22, and the shipped bundle is compiled for
  `node22` — moving the working host is the bigger risk with production already in an error state.
  If the owner later standardises on 24, it is four lines and the new test reports which one was
  missed.
  **Verified**: typecheck 0 errors; lint 0 errors / 19 warnings; `npm test` 53 files / 503 tests in
  12.51 s (new `tests/runtime-pin.test.ts`, 3); `npm run build` 413 ms. **Mutation-checked**:
  `NODE_VERSION = "24"` in `netlify.toml` fails the cross-declaration test, restored afterwards.
  **Not verified**: what Node version a Vercel deployment actually runs cannot be read from this
  machine — it needs a build log (`node -v`) or the Settings → Build & Deployment dropdown. Local
  dev stays on Node 24.22, which npm now reports as an `EBADENGINE` **warning** on install, not an
  error (`engine-strict` is off). Not deployed.

- **W2 · M-13 CSP** (closed by decision, **no policy change**): the Vercel Toolbar console error the
  owner saw comes from `script-src 'self'` and a `connect-src` with no `wss:`. Satisfying the
  Toolbar means allowlisting `vercel.live` and `wss://ws-us3.pusher.com`, which is exactly the kind
  of blanket CSP weakening this project has ruled out — and the app needs neither: it opens no
  websocket, no `EventSource`, loads no external font and runs no Worker, so the policy costs the
  product nothing. What landed instead is the drift guard, because the CSP string exists twice
  (`netlify.toml` for production traffic, `vercel.json` for the second host) and nothing checked
  that the two agreed: `tests/security-headers.test.ts` (4) asserts all seven headers on both
  hosts, asserts they are byte-identical, asserts the hardening directives individually
  (`default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`, `frame-ancestors 'none'`, no `unsafe-eval`), and asserts that no file under
  `src/`, `netlify/`, `vercel/` or `shared/` starts using a websocket or `EventSource` — the case
  where the missing `wss:` would stop being cosmetic.
  **Verified**: typecheck 0 errors; lint 0 errors / 19 warnings; `npm test` 54 files / 507 tests in
  14.19 s; `npm run build` 699 ms. **Mutation-checked**: `wss:` added to the Netlify copy alone
  fails the parity test, and a `new WebSocket(...)` in `src/lib/utils.ts` fails the absence check.
  **Not verified**: nothing about live header delivery changed — the live `curl -I` result for
  Netlify is unchanged from checklist row 5, and no preview was opened to confirm the Toolbar error
  is still there (it is expected to be). If the owner wants the Toolbar on previews, say so and it
  becomes an approved, preview-scoped exception rather than a silent edit. Not deployed.

- **W2 · M-14 Vercel bridge bodies** (last MEDIUM of the platform wave, request half only): the
  adapter used to concatenate the incoming request and hand the handler a UTF-8 string while
  asserting `isBase64Encoded: false`. Anything that is not UTF-8 — a multipart boundary, an
  image part, a stray `0xFF` — was already destroyed before the first handler line ran, and no
  error said so. `readBody()` now returns the raw `Buffer`, the event carries it as base64 with
  `isBase64Encoded: true`, and the 4.5 MB cap is checked against the **raw** length before
  encoding, so 4 MB of binary is accepted even though its base64 form is ≈5.33 MB. No handler was
  touched: `readJsonBody()` has honoured that flag all along, which is why the fix belongs in the
  adapter and nowhere else.
  The second half of the finding (`Set-Cookie` impossible because response headers are
  `Record<string, string>`) is **intentionally not implemented** — `grep Set-Cookie` across
  `src/`, `netlify/`, `vercel/` and `scripts/` returns nothing, and auth lives in `localStorage`,
  so widening the type would buy a capability with no user. Whoever adds cookies widens the type,
  the dev plugin and this adapter together.
  **Verified**: typecheck 0 errors; lint 0 errors / 19 warnings; `npm test` 54 files / 511 tests in
  26.76 s (these four cases allocate real 4 MB buffers, which is why the wall time roughly doubled —
  earlier runs of the same suite measured 12–14 s); `npm run build` 1.47 s, and the regenerated
  `api/index.js` contains `isBase64Encoded: true` + `raw.toString("base64")`, which also proves the
  H-5 build wiring on a real code change rather than by grep. **Mutation-checked**: encoding the
  body as `utf8` again fails 5 of the 20 bridge tests.
  **Not verified**: nothing was posted to a live Vercel function — the byte-preservation claim is
  proven against the adapter, not against the platform's own request handling. Not deployed.

- **W2 · L-3 + L-5 caps** (the last two parity items of the platform wave that needed code): two
  separate leaks, both about a size limit that existed on the host but not in the repo.
  L-3 — `scripts/dev-api-plugin.ts` read request bodies with **no cap at all**, so a 20 MB upload
  worked perfectly in `npm run dev` and 413'd on Vercel; the dev reader now imports `MAX_BODY_BYTES`
  from `shared/upload-limits` (the same file the Vercel adapter and the browser use), destroys the
  request past the cap, and — the part that actually teaches the wrong lesson locally — replies with
  the `{error:{code:'payload_too_large'}}` envelope instead of the generic 500 the catch-all produced.
  L-5 — `readJsonBody(event, maxBytes = 8 * 1024 * 1024)` had a default larger than either host
  accepts, so any future call site that skipped the argument would silently be un-deployable. The
  default is **deleted**, which moves the decision to the compiler: all 18 call sites now name their
  own ceiling (16–32 KB for the nine `net-*` tools and `research`, 64–512 KB for `ai-test`/`auth`/
  `admin`/`workspace`, 2 MB for the two text-only AI routes, `MAX_BODY_BYTES` for `ai-analyze` and
  `content-admin`), and none exceeds 4.5 MB.
  **Deliberately not changed**: the *upstream* response caps (`netlify/lib/fetch.ts:31,35` 10 MB
  default, `ai.ts:228` 12 MB, `news.ts:208` 8 MB, `supabase.ts:96` 5 MB). Those bound what a function
  reads from another server, which is a memory question; forcing them under the host's *request*
  payload limit would break the model-catalog and RSS fetches that legitimately need the room.
  **Verified**: typecheck 0 errors; lint 0 errors / 19 warnings; `npx vitest run` 54 files / **513**
  tests (12.86 s on the first run, 17.22 s on the confirming re-run — the wall time is dominated by
  creating jsdom 54 times, not by assertions); `npm run build` 0.53–0.76 s, `api/index.js` 1179 kB,
  entry chunk unchanged at 745.57 kB min / 231.85 kB gzip. `tests/upload-limits.test.ts` went 6 → 8.
  **Mutation-checked both ways**: restoring the `= 8 * 1024 * 1024` default *and* raising `ai-chat`
  to 6 MB fails the cap test; replacing the dev plugin's `total > MAX_BODY_BYTES` with `if (false)`
  fails the dev-adapter check (both reverted afterwards, suite green).
  **Not verified**: no live dev server was started against an over-cap body — the L-3 claim is the
  source guard plus the mutation check, not an observed 413 round trip. Not deployed.

- **L-7 hook dependencies** (the three warnings that were actual bugs, not style): two pages had a
  `useMemo` that looked like a cache and was not one. `DashboardPage.tsx:87` defined `const L = (en, ar) =>
  settings.language === 'ar' …` inside the component, so the closure was a new function every render and
  the service-row memo at `:119` was keyed partly on something that could not be equal to its previous
  value; `L` is now a `useCallback` on `[settings.language]` and the memo depends on `L` itself.
  `DomainPage.tsx` (the finding's `:72`, now `:75`) built `allowed` as a fresh array literal per render, which made the 44-article
  filter-and-`.sort()` at `:75` re-run on every keystroke-driven re-render; it is memoized on
  `[filter, config.domains]`, and `config` comes from a module-level `HUBS` object so those deps really
  are stable.
  `SettingsPage.tsx` (the finding's `:32`, now `:38`) is **not** a bug and was not "fixed" by deleting deps: `localDataSize()` walks
  `localStorage` (a `getItem` per key), so it cannot run per render, and the five collections it lists
  are the change signal rather than inputs. The deps stay, the reason is now written next to them, and
  the note admits the number refreshes on app-data writes only — a non-tracked key or another tab can
  leave it stale until the next data change.
  19 → 16 warnings, and every warning left is `react-refresh/only-export-components`: 11 across the six
  `src/context/*.tsx` files that keep provider and hook in one module, 5 in `main.tsx`,
  `components/charts/index.tsx`, `components/ui/index.tsx` and `components/tools/PortCheckTool.tsx`.
  Splitting those is a module-layout refactor with import churn through 33 pages, so it was left alone
  rather than silenced warning by warning — no `eslint-disable` was added anywhere except the one
  annotated `SettingsPage` line.
  **Verified**: `npm run lint` 0 errors / 16 warnings; typecheck clean; `npx vitest run` 54 files / 513
  tests; `npm run build` 568 ms. **Mutation-checked**: reverting all three edits at once returns exactly
  3 `exhaustive-deps` warnings plus a `no-unused-vars` error on the orphaned `useCallback` import, then
  restored and re-run clean.
  **Not verified**: no browser was opened, so "the catalog memo now caches" is React semantics plus the
  dependency identities, not a measured render count.

- **W4 · H-9 route-level error boundary**: `ErrorBoundary` was mounted once, at the root above
  `BrowserRouter`, so a throw in any of the 33 pages blanked the whole shell — sidebar, topbar and
  navigation included — while the fallback promised "the error was contained so the rest of the app
  keeps working". That sentence was not true at the time it was written. The route tree now lives in
  its own `PageRoutes()` component (`src/App.tsx:73`) wrapped in `<ErrorBoundary key={pathname}>` and
  mounted **inside** `AppShell`, so a crashing page blanks only the content slot. The `key` is what
  makes recovery possible: any navigation rebuilds the boundary instead of leaving the shell pinned to
  the old error. The root boundary stays as the last resort for failures in the providers or the shell
  itself.
  One thing deliberately **not** changed: the fallback's dashboard control stays a plain
  `<a href="/">`. `Link` looks like the better fix and is a trap — the root boundary renders outside
  `BrowserRouter`, so a router-aware link there would throw a second error with no Router context and
  leave a blank screen exactly when the user needs the recovery path. `tests/error-boundary.test.tsx`
  now asserts the boundary imports no router module at all.
  **Verified**: typecheck 0 errors; lint 0 errors / 16 warnings; `npx vitest run` 55 files / **517**
  tests in 11.78 s; `npm run build` 392 ms, entry chunk unchanged at 745.57 kB min / 231.85 kB gzip.
  The containment test renders a component that throws next to a live sibling `<nav>` and asserts both
  the fallback heading and the sibling are in the DOM. **Mutation-checked**: deleting `key={pathname}`
  fails the structural guard; restored.
  **Not verified**: no page was made to throw in a running browser, so "the sidebar stays usable after
  a crash" is proven in jsdom, not on a screen. Not deployed.

- **W4 · H-10a `Retry-After` end to end + one 401 refresh-and-replay**: the rate limiter already
  computed the exact window and then threw it away into a sentence. `enforceRateLimit`
  (`netlify/lib/rate.ts:25`) now passes the seconds to `HttpError`, which carries them as an optional
  `retryAfterSeconds`, and `errorResponse` emits `Retry-After`. The emission **spreads** rather than
  assigns: `json()` returns the shared module-level `BASE_HEADERS` object by reference, so writing
  `response.headers['Retry-After'] = …` would have stuck the header on every later response served by
  that warm instance — a test asserts the base object is still clean afterwards.
  On the client, `ApiError` gained `retryAfterSeconds` and `parseRetryAfter()` reads both RFC 9110
  §10.2.3 forms (delta-seconds and HTTP-date), ignores what it cannot parse and clamps to 24 h.
  `src/services/api.ts` also gained `setUnauthorizedHandler()`, registered by `AuthProvider`: a 401 on
  the **ambient** session token now refreshes once and replays, because the scheduled refresh only
  fires while the tab is awake and a laptop that sleeps past the expiry leaves every later call dead
  until a reload. Replaying is safe here rather than merely convenient — every handler calls
  `authenticate(event)` before `readJsonBody` and before any mutation, so a 401 applied nothing. Four
  guards keep it that way: one retry only (`replayed`), never `/api/auth/*` (there a 401 *is* the
  answer), never a caller-supplied `adminToken`/`accessToken` (that caller refreshed on purpose, and
  replaying a hand-driven mutation is not this layer's decision), never a guest who had no token to
  lapse, and never a 403 (refreshing cannot widen a role). A burst of parallel 401s costs one refresh
  call, not one per request, because `refreshTokens` already dedupes through `refreshRef`. The
  bootstrap's own 401 retry in `AuthContext` was deliberately left alone: it passes an explicit token
  and runs before any handler exists.
  **Not verified**: no browser was left idle past an expiry, so the lapse-and-recover path is proven
  against a stubbed `fetch`, not against a live Supabase session.

- **W4 · H-10b one error mapping**: the audit called this "three divergent `errorMessage()`
  implementations". It was worse — ~45 catch sites in 20 files using at least 8 different shapes, and
  a complete bilingual `errors.<code>` dictionary in `src/i18n` that **nothing consumed**, which is
  exactly why a visitor saw `Authentication is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY
  on the server.`
  `src/services/apiError.ts` is now the single `describeError(error, lang, fallback)`, adopted at 43
  call sites across 22 files (the two local `errorMessage()` helpers in `NetworkDiagnosticsPage` and
  `SecurityLabPage` are deleted; a recursive scan in the test suite fails if another one appears under
  `src/`, with `src/lib/speedtest.ts` the one documented exception — it maps third-party test-endpoint
  failures and returns `''` so callers supply a phase-specific default). It lives in `services/`, not
  `lib/`, because it has to `instanceof` the `ApiError` that `services/api.ts` defines and `lib →
  services` would invert the one-way dependency rule in `docs/ARCHITECTURE.md` §2 — a rule that held
  for every other `lib` module but was enforced by nothing, so two structural guards in the same test
  file now check it (no upward import from `lib`, no React in `services`). Three duplicated
  `not_configured` branches that named Netlify functions to the visitor were removed
  (`NetworkLookup` ×2, `PortCheckTool`). `DdnsPortAnalyzer` and `PrinterDiagnostics` keep their
  `blocked_host` specialisation, because that code covers both "this target is on a LAN" and "probing
  is switched off here" and only the UI can say which one the person in front of it can act on;
  `ProviderHubPage`'s `runTest`/`testCard` keep the `message`/`detail` split because the card renders
  them as two separate fields.
  **A deliberate limit, not an oversight**: the i18n dictionary is *not* the general source of error
  text. The server's own `message` wins over a per-code translation, because it is written where the
  failure is actually understood and is nearly always the more precise of the two — `auth.ts:512`'s
  "Your daily AI quota is exhausted. Try again tomorrow or use your own provider key." beats any
  generic "too many requests". Only three cases override it, and each is a message addressed to the
  wrong reader: `not_configured` names environment variables, a status of `0` never reached a server
  that could describe it, and a `Retry-After` window is a number to count down from rather than a
  sentence to re-read. The 429 override is gated on `status === 429` **and** a parsed window, so the
  quota message above keeps its wording. `detail` is appended after one `—` except for four codes
  (`invalid_credentials`, `email_not_verified`, `already_exists`, `unauthorized`) where it is the
  identity provider restating the message in jargon ("invalid_grant", "Email not confirmed") — noise,
  not secrecy, since the server already decided every `detail` it sends is browser-safe.
  Three i18n keys were touched in EN and AR: `errors.network` and `errors.not_configured` generalised,
  `errors.retryAfter` added with a `{seconds}` placeholder.
  Four `useCallback`/`useEffect` dependency arrays gained `settings.language` to satisfy
  `react-hooks/exhaustive-deps` without a suppression. Each was checked rather than assumed: all four
  already depended on `t`, itself a `useCallback` on `[settings.language]`, and both affected effects
  open with `if (started.current) return` — so the addition is behaviourally neutral and lint returned
  to its 16-warning baseline. `useNews` is the counter-example and got a ref instead: its `load` had
  deps `[]` and no `t`, so a language dependency there would have re-fetched the news on every switch.
  **Verified**: typecheck 0 errors; lint 0 errors / 16 warnings; `npx vitest run` 56 files / **541**
  tests in 13.9–19.8 s (`tests/api-error.test.ts` 24 new); `npm run build` 529–663 ms, entry chunk
  746.76 kB min / 232.20 kB gzip (was 745.57 / 231.85 — the fix costs 1.19 kB min, 0.35 kB gzip).
  **Mutation-checked** six ways, each reverted and restored from a copy rather than from git:
  a direct header assignment instead of the spread; dropping the `replayed` flag so a 401 loops;
  replacing `describeError` with a naive `error.message` (fails 4 of the 8 mapping tests — the fifth
  needed a second, narrower mutation); removing only the `error.status === 429 &&` gate, which
  makes a 503 carrying `Retry-After` claim "too many requests"; copying the mapper back to
  `src/lib/apiError.ts`; and adding a React import to `src/services/localTriage.ts`.
  **Not verified**: no failure was seen on a screen — no 429 countdown, no `not_configured` surface, no
  lapse-and-replay. And Arabic copy for the *other* codes still needs the server to emit message keys
  instead of English prose; the dictionary cannot fix that from the client. Not deployed.

- **W4 · M-17 three clipped tables**: `NetworkDiagnosticsPage` put its latency-sample, cross-resolver
  DNS and response-header tables in `overflow-hidden` wrappers, so on a phone the columns were cut off
  with no way to scroll — the data existed and the user could not reach it. A census first: 24
  `<table` elements in `src`, and 46 matches for `overflow-auto`/`overflow-x-auto`, so the repo already
  had one convention (`overflow-auto rounded-lg border border-line` beside `<table className="w-full
  text-xs">`); exactly three sites broke it, which made this a one-word change per site rather than a
  layout rethink. `tests/responsive-tables.test.ts` (2) is the standing guard, not a regression test for
  those three files: it walks every `.tsx` under `src`, reads the 200 characters before each `<table`,
  and rejects a wrapper that is `overflow-hidden` without a scroll value or a table that is in neither a
  scroll wrapper nor given `min-w-` on itself. **Mutation-checked**: putting `overflow-hidden` back on
  one site fails the guard. **Not verified on a device** — the test reads the source, so it proves the
  class is present, not that 375 px now scrolls.

- **W4 · M-15 modal focus and inert background**: `Modal` trapped Tab but did nothing else a dialog is
  supposed to do — focus did not return to the trigger when it closed, and the page behind it stayed
  reachable. `aria-modal="true"` asks assistive technology to ignore the background; it does not stop a
  keyboard, and nothing in the app set `inert`, so Escape-closing a dialog left a screen-reader user in
  the middle of a page they had not asked to return to. Four changes: an `overlayStack` + `syncBackgroundInert()`
  marks every other `<body>` child inert while a dialog is open (a stack rather than a flag, because
  `AppShell` mounts the command palette and it can open on top of a page's own dialog — the dialog
  underneath has to stop taking Tab too), focus returns to the trigger only when the trigger is still
  connected (a row's delete dialog is often what unmounted that row's button, and focusing a detached
  node lands the caret on `<body>`), the effect now depends on `[open]` alone, and the initial-focus
  timer was repaired. The dependency change is not cosmetic: 11 of the 12 call sites pass an inline
  arrow `onClose`, so every parent render handed `Modal` a new function identity, which cleared and
  re-armed the 30 ms autofocus and pulled the caret back to the first field mid-typing; `closeRef` keeps
  the latest handler for Escape without re-running the effect. **Reading the autofocus to write its test
  found a defect the audit had not listed**: it ran `panel.querySelector('input, textarea, select,
  button')`, and the header's Close button precedes the children in document order — so **every** dialog
  in the app opened with focus on Close, including the palette, whose `autoFocus` search box lost the
  caret 30 ms after Ctrl+K. Initial focus now leaves a control the content already claimed and otherwise
  prefers the first control in the dialog body, falling back to the panel when the body has none.
  `tests/modal-focus.test.tsx` (13) covers all of it, including that the trap wraps across the panel's
  **three** controls (the first two attempts at this suite failed because they assumed two) and that
  Escape calls the latest `onClose`. **Mutation-checked** three ways, each failing exactly one test:
  drop the claimed-focus guard, drop the body preference, drop the panel fallback. Two assertions were
  rewritten before they were trusted: the inert-on-close check had to close by `rerender` (after RTL
  `cleanup()` the container is detached, which makes a `body > [inert]` count vacuous), and background
  elements are reached through the DOM rather than by role. **Not browser-verified**: jsdom has no
  `inert` semantics, so the suite proves the attribute, not what a keyboard and screen reader do with it.

- **W4 · M-16 the command palette was silent to a screen reader**: it declared `role="combobox"` +
  `listbox` + `role="option"` but never told anyone *which* option was active — `aria-activedescendant`
  was absent and the options had no ids, so arrow keys moved a highlight that only sighted users could
  see. Options now carry ids, the input points at the active one, and `aria-autocomplete="list"` states
  what the list is. Home/End jump to the ends. Two more changes were needed to make the pointer honest
  rather than merely present: the query keystroke resets it in the same batch as the text (`setQuery` +
  `setActive(0)` in one handler) because a `useEffect` on `[query]` commits one frame in which the
  pointer still names an index past the end of the shorter list the keystroke just produced — that frame
  is exactly what an AT reads — and an empty filter now emits no `aria-activedescendant` instead of one
  pointing at `command-option-0`, which is not in the DOM. The group headers became real `role="group"`
  regions labelled by the heading the sighted user sees, instead of unlabelled `<div>`s inside a listbox.
  `tests/command-palette.test.tsx` (10) asserts the pointer always resolves through `getElementById` to
  a rendered, `aria-selected` option inside the element named by `aria-controls`; that Enter runs the
  option under the pointer rather than the first one; that a narrowing query lands on the first remaining
  match; and that no results means no pointer. **Mutation-checked** six ways (remove the attribute, the
  ids, Home/End, the clamp, the batched reset, the group semantics). This also corrects the W1 note above
  that said "no palette test exists yet — that is W5": it exists now, a wave earlier. **Not
  browser-verified**, and M-10's search *coverage* is unchanged — this is about announcing results, not
  finding them.

- **W4 · M-18 the knowledge catalog was pinned to first paint**: the entry chunk shipped **747.68 kB
  min / 232.60 kB gzip**, and the honest measure — the entry's *static import closure*, because a
  chunk only stops being downloaded when the boundary is a dynamic import — was 278.6 kB gzip. The
  cause was not the router or a heavy library: six files imported `KNOWLEDGE_ARTICLES`, and only one
  of them (`ArticlePage.tsx:48`, `renderMarkdown(pickText(article.body, …))`) ever read a body. The
  other five wanted a title. A bundler cannot split an object literal, so asking the catalog for a
  title bought all 44 article bodies in the same chunk. The fix is generated rather than duplicated:
  `scripts/build-knowledge-index.mjs` bundles the catalog with esbuild, strips `body`, and writes
  `src/data/knowledgeMeta.ts` (44 records, 62 kB, typed `Omit<KnowledgeArticle, 'body'>`); the
  palette, the dashboard, `/solutions`, `/docs` and the domain hubs read that, and `ArticlePage` is
  the only file left importing the catalog. `npm run build` regenerates it before `vite build`, and
  `tests/knowledge-meta.test.ts` (6) fails both if the artifact drifts *and* if it stops being
  smaller — `{ ...meta, body }` deep-equals the source record, so a dropped or added field fails, and
  a hand-edit of the generated file fails until the next build overwrites it. **Verified**: entry
  chunk 484.91 kB / **149.51 kB gzip**, closure 658.1 kB / **203.7 kB gzip** — first paint shed
  ~75 kB gzip (−27%) and the bodies moved to `ArticlePage-*.js` (318.05 kB / 98.45 kB gzip), fetched
  only on `/kb/<slug>`. The generator is deterministic (same md5 across runs). **The <200 kB budget
  is missed by 3.7 kB**, and the only lever that size is the eagerly-bundled Arabic dictionary
  (`src/i18n/ar.ts`, 78 kB of source, both dictionaries in the statically-imported `utils` chunk) —
  that needs an async language load gating the first render, which on an Arabic-first product means a
  flash of untranslated keys, so it is the owner's UX call and not something to spend quietly.
  `DashboardPage` stays eager by the same reasoning: it *is* the `/` route, so lazy-loading it adds a
  round trip to the most common first paint instead of removing bytes. Three mutations: drift one
  title (fails), swap the build order (fails), delete the build step (fails — only after the first
  version of that assertion was caught vacuous, since `indexOf` returns `-1` for a missing step and
  `-1` sorts before every real index). Also corrected here: two docs claimed the catalog "holds 45
  articles"; it holds 44, and the M-10 row still described the `slice(0, 30)` as open although W1
  closed it. **Not browser-verified, nothing deployed.**

- **W4 bundle cost, re-measured after M-18**: `vite build` 447–690 ms (the new generator step adds
  123–165 ms; `npm run build` end to end is ~17.2–17.5 s of npm + tsc + vite + the 1179 kB API
  bundle). Entry chunk **484.91 kB min / 149.51 kB gzip** (`index-KsoF9hUP.js`), first-paint closure
  **203.7 kB gzip**. M-15/M-16/M-17 together cost 0.92 kB min / 0.40 kB gzip on top of H-10's 1.19 kB
  / 0.35 kB, and M-18 paid for all of it and 83 kB more. **Verified**: typecheck 0 errors; lint 0
  errors / 16 warnings; `npm test` 60 files / **572** tests in 14.0–15.0 s. Not deployed.

- **W3 · M-3 DNS-rebinding window in the TLS probe** (the last `Discovered → W1` medium that was
  still a live code defect — and the finding was wider than the register said): `net-tls.ts` called
  `await assertPublicHost(host)` and then `inspectCertificate(host, port)`. Validate by name, connect
  by name, so the socket performs a **second** resolution and a TTL-1 record flipped between the two
  lookups reaches `169.254.169.254` or `127.0.0.1`. The register credited the other paths with
  "connect to the validated literal IP"; that was true of the HTTP hop
  (`net-diagnostics.ts:148-171`) and **false of its own TLS sub-probe**, which re-resolved
  `current.hostname` after the hop finished. Two sites, not one.
  Fix, reusing the convention already in `net-probe.ts` instead of inventing a mechanism:
  `netlify/lib/host.ts:79-112` `resolvePublicAddress()` resolves **once**, rejects if *any* answer is
  private/reserved, and returns `{host, address, family}` — the literal address to connect to;
  `assertPublicHost()` is now a delegate that returns only the name (`host.ts:59-62`), so the unsafe
  half is no longer reachable by accident. `inspectCertificate()` gained an explicit `servername`
  (`netlify/lib/tls.ts:16-32`), because a socket opened to an IP with no SNI lands on the host's
  default vhost: pinning without SNI would have traded an SSRF hole for a wrong-certificate answer.
  `net-tls.ts:22,24` connects to `target.address` and carries the typed hostname as SNI; `checkHttp`
  does better and connects to `response.socket.remoteAddress` (captured at `:183`, used at `:235`) —
  the address the hop actually spoke to, so that path never resolves a third time.
  **Verified**: typecheck 0 errors; lint 0 errors / 16 warnings; `npm test` **61 files / 587 tests**
  in 15.1–15.8 s tracked (16.3 s wall); `npm run build` green — vite 0.58 and 0.65 s,
  `api/index.js` 1179 → **1180 kB** because the resolver is shared by both hosts, and the entry chunk
  is unchanged at 484.91 kB / 149.51 kB gzip since nothing in this fix is frontend code. New
  `tests/net-dns-rebinding.test.ts` (15 tests, 15 ms). **Mutation-checked 6/6**: revert `net-tls` to
  `inspectCertificate(host, port)`; revert the sub-probe to `current.hostname`; null the `peer`
  capture; ignore the `servername` argument; return `address: host` from the resolver; delete the
  private-answer check.
  **Not verified**: there is no live rebinding target. Proving this against the internet needs a
  domain whose record I control *and* egress from the function, so the unit proof is the entire proof,
  and it is a proof about this code path, not about the platform's resolver. Nothing is deployed.
  Two documentation errors surfaced on the way and are corrected in this commit:
  `docs/ARCHITECTURE.md` claimed `NET_PROBE_ALLOW_PRIVATE` relaxes `host.ts` (it does not — that file
  answers only to `ALLOW_LOCAL_AI`, and only for `localhost`/`127.0.0.1`/`::1`), and the line-number
  citations for `host.ts` in `docs/ENVIRONMENT_VARIABLES.md` and `docs/SECURITY_AUDIT.md` moved with
  the file (113 → 141 lines).
  One **new finding** came out of reading the guard closely, and it is recorded rather than fixed:
  **L-11** — `ALLOW_LOCAL_AI=true` never actually authorizes `http://localhost:11434`, because
  `normalizeHost()` rejects single-label names before the flag is consulted (`127.0.0.1` works; both
  measured with a throwaway probe, since deleted). It fails closed, so it is a usability defect, and
  the obvious fix widens the input gate of the SSRF guard — that is your call, not mine to make
  quietly. `docs/ENVIRONMENT_VARIABLES.md` now documents the IP form as the only one that works.

- **W1 honesty and gating batch** (the audit's `Discovered → W1` list, now landed in
  `70e1deb` plus the follow-up commit that carries this line):
  - H-1: `/api/ai/analyze` returns every model-recalled URL with `verified: false`, drops the
    `retrievedAt` a model would invent, and the Lab heading switches to "Sources recalled by the
    model" with an explicit no-search note (`src/pages/TroubleshootingLabPage.tsx`,
    `lab.modelSources*` in both catalogues). The analysis prompt now tells the model nothing was
    searched and to omit rather than guess.
  - M-5: `verifyProviderAuth()` no longer calls a public catalog "authenticated". It probes the
    catalog with and without the key and returns `ProviderVerification {latencyMs, keyVerified,
    reason?, note?}`; OpenRouter still uses the documented `/key` endpoint, Ollama is reported as
    reachability with no credential. `/api/ai/test` forwards `keyVerified`, `unverifiedReason` and
    `note`, and the Providers page shows a warning panel plus a warning toast instead of a green
    "Connection OK".
  - M-6: `ai/models`, `ai/test` and `research` now gate on `ai.use` / `research.read` (was the
    `requireMember` default `workspace.read`) and record usage through `recordAiUsage` — except for
    BYOK traffic, which `usesClientProviderKey()` detects from `x-tn-key` so a member's own key does
    not spend platform quota.
  - M-7: `mapUpstreamStatus(status, detail, secret)` + `redactSecret()` in `netlify/lib/fetch.ts`
    move redaction into the shared path, so upstream error text cannot echo a submitted key to the
    browser; `gemini.ts` now reuses it instead of keeping its own copy.
  - M-8: `/api/health` derives `news.configured` / `research.configured` from the live feed
    and key state, reports `sources` and `invalidCustomFeeds`, and the About page counts the same
    feeds instead of asserting them.
  - M-1, M-2: `emailHash()` refuses to start a trial without `NEXORA_HASH_PEPPER` (existing trials
    are untouched, one server warning, no login 503), rate-limit buckets use the per-process
    `emailBucketKey()` instead of the peppered hash, and printer public probing is opt-in.
  - L-2: `normalizeBaseUrl()` also strips a pasted `/api/chat`, so an Ollama endpoint URL no longer
    doubles to `/api/chat/api/chat`.
  **Verified**: `npm run typecheck` 0 errors; `npm run lint` 0 errors / 19 warnings; `npm test`
  50 files / 484 tests pass in 11.52 s (new: `tests/analyze-honesty.test.ts` 5 tests,
  `verifyProviderAuth` cases in `tests/ai-adapter.test.ts` 17 → 20); `npm run build` 531 ms.
  **Not verified**: nothing in this batch was deployed or exercised against a live provider — the
  unproven-key panel, the lab source label and the entitlement rejections have only been proven by
  mocked handlers.

- **W1 leftovers** (same wave, second batch):
  - L-1: `og:image` / `twitter:image` pointed at `nexora-ai.netlify.app`, which answers **404**. Both
    now use `https://adnan-tech.netlify.app/og-cover.png`, probed this session: **200,
    `image/png`**. The two duplicated `name="description"` tags (one EN, one `lang="ar"`) became one
    bilingual tag, because crawlers take the first and silently drop the other.
  - L-4: deleted the three `STORAGE_KEYS` entries no code ever reads (`researchRecent`,
    `conversations`, `securityLab`). `grep` across `src/` and `tests/` returns zero references.
  - M-10: the command palette stopped pre-truncating `KNOWLEDGE_ARTICLES.slice(0, 30)`; the catalog
    holds 44 articles, so 14 of them were unreachable from the palette while the UI implied full
    coverage. No palette test exists yet — that is W5.
  - `tests/ai-gating.test.ts` (5 tests) is the missing proof for M-6: it spies `requireMember` and
    asserts `/api/ai/models` and `/api/ai/test` ask for `ai.use`, `/api/research` asks for
    `research.read`, BYOK requests (`x-tn-key`) record **no** platform usage, and research with no
    provider key is left unbilled.
  - The retired hostname was also replaced inside `docs/DEPLOYMENT.md` and
    `docs/ADNAN_TECH_AUTH_AND_RBAC.md`.
  - `docs/PROJECT_AUDIT.md` gained **§8.1 "Fixed in code, not yet deployed or browser-verified"**, so
    the register stays the as-found snapshot instead of being rewritten as work lands.
  **Verified**: typecheck 0 errors, lint 0 errors / 19 warnings, `npm test` 50 files / 484 tests in
  11.52 s, `npm run build` 467 ms, the two OG probes above. **Not verified**: the palette change and
  the meta tags have not been looked at in a browser (W5).

- **Work rescue.** 187+ uncommitted files from 2026-10-25→31 were committed as a checkpoint
  (`9805209`) after the ignore fix, so the six days of platform work are no longer single-copy on a
  laptop. No remote exists yet — backup remote approval is owner action D6.

### Corrected (documentation truthfulness)
- The stack table now reports what the repository contains rather than what earlier notes assumed:
  22 Netlify functions, 23 shared libs, 33 page modules across 39 route entries, 43 tools in 18
  component files, 22 `/api` routes in the Vercel dispatcher.
- `docs/ADNAN_TECH_*.md` (2026-10-27) are marked as superseded where they disagree with the code —
  the auth "PARTIAL" wording, the printer-default wording, and the stale test counts. Task #6 will
  rewrite those files or delete them with approval.
- `docs/ENVIRONMENT_VARIABLES.md` was itself three findings behind the code, and each stale row was
  a live misunderstanding waiting to happen: it said `NET_PROBE_ALLOW_PRIVATE` is "missing from
  `.env.example`" (L-9 — landed two batches earlier, in `70e1deb`, and also present in `README.md:128`
  and `docs/DEPLOYMENT.md:94`), that `PRINTER_ALLOW_PUBLIC` has a code default of `true` (M-2 —
  `envBool()` is false unless the value is exactly `true`, pinned by `tests/secure-defaults.test.ts:26`),
  and that an empty pepper "silently degrades to the literal `'nexora-local-pepper'`" (M-1 — that
  literal no longer exists in the source; `hasPepper()` at `netlify/lib/auth.ts:116` refuses the trial
  instead). All three corrected by reading the current code, then re-verified against the tests.
  **Verified**: `git log -S` for the `.env.example` line, grep for the deleted literal, the two
  guard tests exist and pass. **Not verified**: nothing was re-deployed, so the *host* env state is
  unchanged (Vercel still has no Supabase vars — C-3/D3).
- Re-read all eight `Discovered → W1` **medium** findings against current source instead of trusting
  the changelog that claimed them, because the register still showed every one of them as open six
  batches later. Six are genuinely closed and now say which line proves it: M-1 (`emailBucketKey()`
  at `netlify/lib/auth.ts:129`, refusal warning at `:210`), M-2 (`envBool` is false unless the value
  is exactly `true`, `netlify/lib/env.ts:18-20,65`), M-5 (`ProviderVerification.keyVerified`,
  `netlify/lib/ai.ts:478-527`), M-6 (`requireMember(event, 'ai.use')` / `'research.read'` plus
  `recordAiUsage`, BYOK excluded by `usesClientProviderKey`), M-7 (`redactSecret` +
  `mapUpstreamStatus` in `netlify/lib/fetch.ts:86-93`, now reused by `gemini.ts:272`), M-8
  (`news.configured = feeds.length > 0`, `research.configured = providers.length > 0 || grounded`).
  **Two are not closed, and saying so is the point of the pass**: **M-3 is still a live defect** —
  `net-tls.ts:22-24` calls `assertPublicHost(host)` and then `inspectCertificate(host, port)`, so it
  resolves the name twice and connects to the *second* answer; the rebinding window the audit
  described was never fixed, and it is now the next code item. **M-4 was already mitigated before the
  audit** and the register overstated it: both landing pages call `clearAuthHash()` immediately after
  reading (`ResetPasswordPage.tsx:27,30`, `VerifyEmailPage.tsx:31,34`), so the fragment does not
  survive in history or the address bar; what remains is the implicit flow itself and `localStorage`
  persistence, which the H-level session findings already own.
  **Verified**: every claim above is a file:line read in this session. **Not verified**: none of it
  was re-deployed or exercised against a live provider.
- Recorded that `adnan-tech.vercel.app` has never been assigned to the Vercel project and that its
  production alias 404s (finding C-1/C-2 in the audit table). Note for the owner: the repo's own
  plan (`README.md:15`, `docs/DEPLOYMENT.md:5-13`) designates **Netlify** as production and Vercel
  as preview-only, so serving production from `adnan-tech.vercel.app` is a *change* of plan, not a
  repair — it needs decision D1.

### Discovered, not yet fixed (next waves)
| Wave | Items |
| --- | --- |
| W1 safe-now | **12 of 14 closed** (H-1, M-1, M-2, M-5, M-6, M-7, M-8, L-1, L-2, L-4, L-9, M-10 — see the two W1 batches above and §8.1 of the audit); still open: M-9 export/clear key lists incomplete (needs owner approval, it widens what gets deleted), H-6 light-theme contrast (needs a browser) |
| W2 platform | **all nine named items closed locally** — H-4, H-3, H-5, M-12, M-13, M-14, L-3, L-5 and L-6 (shared 50 s request budget; one `shared/upload-limits.ts` for every body/image cap; `npm run build` regenerates the Vercel bundle plus a filesystem-derived route-parity test; one Node major pinned in four places; CSP left intact and guarded against drift; the Vercel bridge keeps request bytes intact as base64; the dev adapter refuses what the hosts refuse and `readJsonBody` has no silent default — see the batches above; none deployed). L-6 was closed **without a code change** as an accepted platform difference, verified rather than assumed. H-5's original wording said "add the guard to CI" — there is no CI in this repository, so the guard was placed in the test suite instead; wiring CI is a separate owner decision |
| W3 security depth | H-7 data left in `localStorage` after sign-out, H-8 in-memory and spoofable rate limiter, M-4 implicit-flow tokens (already mitigated for the history half by `clearAuthHash()`; the remainder is PKCE, a Supabase dashboard setting plus a client path), H-2 token storage migration, M-11 shared CMS bearer token. ~~M-3 TLS DNS-rebinding window~~ **fixed in this session** — it was re-verified open by the documentation pass above and closed by the W3 entry that follows it |
| W4 resilience/UX | **H-9, H-10, M-15, M-16 and M-17 closed locally** — the route tree is wrapped in `<ErrorBoundary key={pathname}>` inside `AppShell`, so a throwing page blanks only the content slot and the sidebar/topbar stay usable (`tests/error-boundary.test.tsx`, mutation-checked); one `describeError()` in `src/services/apiError.ts` replaced ~45 catch sites' worth of invented error shapes across 20 files, wired to the `errors.<code>` i18n dictionary that existed but was never consumed, with `Retry-After` carried from the limiter to a countdown and a single guarded 401 refresh-and-replay (`tests/api-error.test.ts` 24, mutation-checked six ways); dialogs now inert-ate the background, return focus to the trigger, and stopped stealing the caret from their own content (`tests/modal-focus.test.tsx` 13); the command palette announces its active option and answers Home/End (`tests/command-palette.test.tsx` 10); and the three clipped diagnostics tables scroll behind a source-wide guard (`tests/responsive-tables.test.ts` 2); and M-18 took the 44 article bodies out of first paint with a generated metadata index (`src/data/knowledgeMeta.ts`, `tests/knowledge-meta.test.ts` 6) — entry chunk 232.60 → **149.51 kB gzip**, static closure 278.6 → **203.7 kB gzip**, so the <200 kB budget is missed by 3.7 kB and the only lever left at that size is an async Arabic dictionary, which is a UX call for the owner. None of it browser-verified. Not deployed |
| W5 verification | browser pass over the §7 "NOT TESTED" list, coverage provider installed, tests for `src/services/api.ts`, `netlify/lib/host.ts`, `admin.ts` |

### Blocked on the owner (no code change will move these)
Vercel production build log (D2) · Vercel env vars (D3) · AI/Gemini keys (D4) · authenticated
end-to-end walk (D5/D7) · backup remote (D6) · production deploy (D10).

---

## 2026-10-25 → 2026-10-31 (checkpoint `9805209`, summarized after the fact)

Not individually verified in this session; the code exists and the suite passes with it.

- **Vercel support path**: `vercel/dispatcher.ts` + `vercel/serverless.ts` + `scripts/build-vercel-api.mjs`
  + `vercel.json`, so one commit runs on Netlify, Vercel, and `npm run dev`.
- **New network tools**: `/api/net/latency` (TCP-connect RTT) and `/api/net/path` (hop inference),
  replacing the 15-line `net-traceroute.ts` stub, which was deleted — ICMP and `traceroute` are not
  available in either host's runtime, and the replacement does not pretend otherwise.
- **Dev-only local auth store** (`netlify/lib/local-auth.ts`, `.local-auth/store.json`, scrypt) so the
  platform is usable without Supabase credentials locally.
- **Gemini grounded search** (`netlify/lib/gemini.ts`) with citation parsing and `redact()`.
- **RBAC/entitlement expansion**, admin surface, workspace endpoints, news pipeline, 11 themes,
  bilingual dictionary growth, and ~20 new test files.
- `docs/DEPLOYMENT.md`, `docs/VERCEL_DEPLOYMENT.md`, `docs/GEMINI_WEB_SEARCH_SETUP.md` written.

---

## 2026-10-24 — commit `dfb695b` "Backup: initial project state"
Baseline snapshot taken before any agent work. Nothing changed in it.

## 2026-10-25 — commit `529a826` "Checkpoint: preserve existing NEXORA AI platform work"
Pre-Vercel checkpoint of the SPA + Netlify functions + Supabase RBAC platform.
