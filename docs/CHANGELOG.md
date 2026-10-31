# CHANGELOG — Adnan Tech | منصة عدنان تك

Format: newest first. Every entry states whether it was **verified** (measured by a command in this
session) or **not verified** (code present, no measurement possible without owner actions D1–D10).
Older undated history is not reconstructed here; `git log` is authoritative for commits.

---

## Unreleased — 2026-10-31 (audit phase + foundation repair)

### Added
- `docs/PROJECT_AUDIT.md` — full findings register: 4 CRITICAL, 10 HIGH, 19 MEDIUM, 10 LOW/INFO,
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
  `DomainPage.tsx` (the finding's `:72`, now `:75`) built `allowed` as a fresh array literal per render, which made the 45-article
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
    holds 45 articles, so 15 of them were unreachable from the palette while the UI implied full
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
| W3 security depth | H-7 data left in `localStorage` after sign-out, H-8 in-memory and spoofable rate limiter, M-3 TLS DNS-rebinding window, M-4 implicit-flow tokens in the URL fragment, H-2 token storage migration, M-11 shared CMS bearer token |
| W4 resilience/UX | **H-9 closed locally** — the route tree is wrapped in `<ErrorBoundary key={pathname}>` inside `AppShell`, so a throwing page blanks only the content slot and the sidebar/topbar stay usable (`tests/error-boundary.test.tsx`, mutation-checked); still open: H-10 six handlers invent their own error shapes, M-15/M-16 focus and ARIA defects, M-17 clipped tables on phones, M-18 232 kB gzip entry chunk. Not deployed |
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
