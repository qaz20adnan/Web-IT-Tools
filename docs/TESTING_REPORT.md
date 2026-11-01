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
| Tests | `npm test` | LOCAL | **PASS** | 67 files, 904 tests, 0 failed. Wall time **16.77, 20.09 and 20.89 s** on the three confirmation runs of the 904-test suite (the earlier 853-test tree measured 20.8, 26.0 and 26.1 s the same day, and 16.6/18.7 s twice before its last case landed; the range across the week is 11–27 s, so treat anything inside it as normal — the file count moved by one and the time did not). jsdom is created once per file: **67 environments, 104.62–129.87 s cumulative, 64–67 % of tracked time**. The newest file adds 51 tests and costs **0.97–1.15 s in isolation (36–44 ms inside test bodies)** — it renders nothing and touches no DOM API, yet still pays for an environment, which is what L-15 is about; `workspace-tenancy` one file back behaved the same way (63 tests, 1.59 s on a quiet machine, 10.47 s when the machine was loaded). The suite is still load-sensitive in exactly one place: `command-palette.test.tsx > never leaves the pointer outside the option range` failed twice at >5 s on 2026-11-01 (0.81 s alone when diagnosed, 2.20 s alone on a fresh re-measure the same day, 10.2–11.3 s inside a full run). That was a load timeout, not a behaviour change — recorded as **L-15** and given a per-test 30 s budget, deliberately not a global `testTimeout` raise, so every other test still hangs loudly |
| Build | `npm run build` | LOCAL | **PASS** | `build:knowledge-index && tsc --noEmit && vite build && build:vercel-api`. **Attribution corrected 2026-11-01**: the "0.44–1.31 s" figure these docs carried was the bundler step, not the pipeline — `vite build` alone is 504–714 ms (1.66 s cold), `build:knowledge-index` 0.19 s, `tsc --noEmit` **33.61 s**, and the whole script measured **38.15 s** the first time it was timed end to end. `api/index.js` 1180 kB, 22 routes — entry chunk 484.91 kB min / 149.51 kB gzip after M-18, unchanged by the 2026-11-01 batches, which touch no frontend code (re-verified after the content-admin batch: `index-Dbs3Tuo9.js` hash and size identical, which is what a test-only batch should produce) |
| Generated knowledge index | `npm run build:knowledge-index` | LOCAL | **PASS** | `src/data/knowledgeMeta.ts` regenerated: 44 articles, 62 kB, byte-identical to the committed artifact; `tests/knowledge-meta.test.ts` fails if it drifts |
| Vercel API bundle | now inside `npm run build` | LOCAL | **PASS** | `api/index.js` 1180 kB (was 1179 until M-3's resolver landed in it), 22 routes |
| Dependency audit | `npm audit --omit=dev` | LOCAL | **PASS** | 0 vulnerabilities in the 9 production deps |
| Coverage | `npm run test:coverage` | LOCAL | **FAIL (tooling)** | `MISSING DEPENDENCY Cannot find dependency '@vitest/coverage-v8'` — the script is published but the provider is not installed, so **no coverage percentage exists for this project** |

`npm run build` was broken for 4 days before this session (2 × TS6133 from dead imports left by the
removed English Coach page). Restored in commit `6612d0f`; the green row above is the proof.

## 2. What the 904 tests actually cover

Top of the suite by test count:
`admin-rbac-gates 79 · workspace-tenancy 63 · net-error-texts 60 · content-admin-gates 51 · supabase-rest-errors 46 · x509 37 ·
ai-adapter 26 · csv 25 · api-error 24 · gemini-research 23 · cidr-overlap 21 · vercel-bridge 20 ·
permissions 19 · json-extract 18 · incidents 17 · diff 16 · operations 15 · net-dns-rebinding 15 ·
mtu 14 · trial 14 · calculators 13 · modal-focus 13 · net-analysis 13 · capacity 12 · speedtest 12 ·
tool-ui 11 · command-palette 10 · local-auth 10 · rbac 10`

Server-side (the part that holds secrets and money) — **all 23 `netlify/lib/*` files and 11 of 22
`netlify/functions/*` files** are imported by at least one test (LOCAL scan 2026-11-01, re-derived by
script rather than memory: every `netlify/lib/*.ts` basename appears in a `tests/` import, and the only
unimported functions are `content.ts`, `ai-script.ts` and the 9 `net-*` handlers):

| Covered | Not covered by any test |
| --- | --- |
| `ai`, `auth`, `env`, `fetch`, `gemini`, **`host`**, `http`, **`json`**, `local-auth`, `net-analysis`, `net-diagnostics`, `net-doh`, **`net-errors`**, `net-latency`, `net-path`, `net-probe`, `prompts`, **`rate`**, `rbac`, `schema`, **`supabase`**, **`tls`**, `trial` — `host.ts` and `tls.ts` were untested guards until M-3, and `json.ts`, `net-errors.ts`, `supabase.ts` until the 2026-11-01 batch, so the shared server library now has at least one test importing every file | *(none left — the last three landed in this batch)* |
| functions: `admin`, `ai-analyze`, `ai-chat`, `ai-models`, `ai-test`, `auth`, `content-admin`, `health`, `news`, `research`, `workspace` | the other 11 functions: `content.ts`, `ai-script.ts` and the nine `net-*` handlers (`net-tls` has only a source-shape guard, because the handler sits behind auth + rate limiting) |

Frontend: 27 `src/lib/*` pure modules are unit-tested, plus `src/services/apiError.ts` and
`src/services/api.ts` (see below), and 7 UI files render under test (`tool-ui`,
`toolkit-additions`, `copilot-research`, `new-surfaces`, `register-page`, `modal-focus`,
`command-palette`). `responsive-tables`, `knowledge-meta` and `error-boundary` add a source-wide
scan (the middle one a generated-artifact drift check) and a containment render respectively.
**26 of 33 pages and 5 of 18 tool modules have no test.**
`src/services/api.ts` — the 650-line module every page depends on — **was never executed by a test
before H-10**; the only reference to it was `vi.mock('@/services/api')` in
`tests/copilot-research.test.tsx:42`. `tests/api-error.test.ts` now imports it for real and drives
`getHealth`, `workspaceRequest` and `authMe` against a stubbed `fetch`, which proves the 401
refresh-and-replay, the `Retry-After` parse and the error envelope. Still unexercised in it: the
base64 screenshot call (`/api/ai/analyze` — the project has no file-upload endpoint at all, a claim
in the 2026-10-27 report that §8 now corrects), every `adminRequest` action and the non-JSON branch.

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
- `tests/modal-focus.test.tsx` (13) — M-15, rendered through the real `Modal`. Three groups: the
  background (`<body>` children other than the topmost overlay carry `inert` while a dialog is open,
  the overlay itself does not, a stacked pair inerts the lower one and frees it when the top closes,
  and the scroll lock is restored on close — closed by re-render rather than RTL `cleanup()`, because
  detaching the container made that assertion vacuous); focus handoff (returns to the trigger, and
  does not chase a trigger the close also unmounted — the delete-a-row case); and the trap (Tab wraps
  across all **three** panel controls, because the header's Close button precedes the children, and
  Escape must call the *latest* `onClose`, proven by re-rendering and asserting `['second']`). The
  autofocus group is where the second defect surfaced: the 30 ms timer searched the whole panel, so
  every dialog in the app opened with the caret on Close — including the palette, whose `autoFocus`
  search box lost focus 30 ms after Ctrl+K. **Mutation-checked** three ways, each failing exactly one
  test: dropping the "content already claimed focus" guard, dropping the dialog-body preference, and
  dropping the panel fallback.
- `tests/command-palette.test.tsx` (10) — M-16, rendered with a mocked `useNavigate` and `useApp`. The
  invariant is that `aria-activedescendant` always resolves through `getElementById` to a
  `role="option"` that is `aria-selected`, inside the element named by `aria-controls`; then arrows,
  Home/End and the clamp at both ends; that Enter runs the option under the pointer rather than the
  first one (the second entry is the theme action, asserted against a mocked `cycleTheme`); that a
  narrowing query leaves the pointer on the first remaining match; that zero results means the
  attribute is *absent* rather than dangling; and that each `role="group"` resolves its label and the
  option ids stay unique. **Mutation-checked** six ways: removing the attribute, removing the option
  ids (fails 6), removing Home/End, removing the clamp in `move()`, removing the batched
  `setActive(0)`, and reverting the group wrappers to plain `<div>`s.
- `tests/responsive-tables.test.ts` (2) — M-17 as a standing guard rather than a one-off fix: it walks
  every `.tsx` under `src`, reads the 200 characters before each of the 24 `<table` elements, and
  rejects a wrapper that is `overflow-hidden` without a scroll value, or a table that is in neither a
  scroll wrapper nor given `min-w-`. **Mutation-checked**: putting `overflow-hidden` back on one of
  the three fixed sites fails it.
- `tests/knowledge-meta.test.ts` (6) — M-18 guards a *generated* file, so it has to fail in both
  directions: the artifact must equal the catalog (`KNOWLEDGE_META` ids in the same order, and per
  record `{ ...meta, body: source.body }` deep-equals the real article, which catches a dropped field,
  an added one and a drifted title at once) **and** it must stay smaller (the file itself carries no
  `body:` key, asserted against the source text). The other four hold the shape of the fix: the type
  is `Omit<KnowledgeArticle, 'body'>`; the five list surfaces must not import `@/data/knowledge` while
  `ArticlePage` — the one thing that renders a body — must; and `scripts.build` still regenerates the
  index *before* `vite build`. **Mutation-checked** three ways: editing one title in the artifact fails
  the field-for-field test, swapping the build order fails the ordering test, deleting the regenerate
  step fails it too — but only after the first version was caught vacuous, because `indexOf` returns
  `-1` when the step is gone and `-1` sorts before every real index, so an ordering assertion alone
  passes on a build that quietly stopped generating the file.
- `tests/admin-rbac-gates.test.ts` (79) — the first test that runs `netlify/functions/admin.ts` at all,
  and the first proof of the RBAC matrix **at the handler** rather than from the role table. Only
  `authenticate`, `writeAudit`, `setPlatformSetting` and the five Supabase row helpers are mocked;
  `requirePermission()`, `canAssignRole()` and `permissionsFor()` stay real, so the tests validate the
  project's actual source of truth for who may do what. Groups: 12 actions × `premium_member` → 403
  naming the missing permission with no write/audit/auth-admin call, and the same 12 × `owner` → 200;
  method gate that fires *before* authentication (405 with `authenticate` never called) and the 413
  on a 400 kB body; the exact zod 4
  message per field; an undeclared body field (`role:'owner'`, `is_admin:true`) is dropped, not honoured;
  rank ceilings (`admin` cannot grant owner, cannot touch an equal-or-higher account, has no
  `users.delete` at all; `super_admin` cannot delete an owner); self-targeting refused for update-role,
  suspend and delete; last-owner and last-super-admin guards on both update and delete, with the
  positive control (a second privileged account lets the change through) and the negative one (a
  *suspended* owner is not protected, so it stays reclaimable); audit ordering asserted with
  `invocationCallOrder` — the audit row is written **before** the delete, and a failed write leaves no
  audit at all; `escapeFilter()` proven structurally (one `(`, one `)`, one `,`, one `or=` segment)
  because a stripped term still survives as inert text inside `ilike.*…*`, and that an injected `%25`
  wildcard never reaches the query and never opens a second `or=` group or a `role=` segment; the settings key whitelist;
  a past billing period refused; `god_mode` in the database downgrading to `standard_member` in the list
  but 422 for a subscription; plan/usage aggregation; and the three local-only actions answering
  `Unknown administrative action.` on the Supabase path (L-14, pinned as current behaviour).
  **Mutation-checked** 9/9: drop the `users.delete` capability check (3 fail), drop the
  `settings.manage` check, ignore rank when assigning, stop the last-owner count, allow self-targeting,
  pass the search term to PostgREST raw, report an empty update as success, accept a past period, make
  the local-only actions pretend to succeed (3 fail).
- `tests/workspace-tenancy.test.ts` (63) — the first test that runs `netlify/functions/workspace.ts`,
  and the first **handler-level** proof of the tenancy claim behind "no IDOR found". Same mock shape:
  `authenticate`, `writeAudit` and the five row helpers are stubbed; `requireWorkspace()`,
  `requireVerified()`, `countOwned()`, `assertItemBudget()` and the whole zod schema stay in the loop.
  Groups: the gate ladder in order (405 before `authenticate` is ever called, 413 on a 600 kB body
  against the 512 kB cap, 401, suspended account, unverified email, plan without the workspace
  feature) with the entitlement refusal asserted to happen **before** the body is parsed; every one of
  the six read actions asserted to carry `user_id=eq.<caller>` in its query, and
  `conversation_messages` to carry both the parent id and the owner; a foreign row answered as *absent*
  (404 on `case.get`/`conversation.get`, no message read, no delete, no audit) and refused **before**
  the write on update, rename, archive and `note.delete`; every insert stamped with the caller's id and
  a UUID, with a hostile body (`user_id`, `role`, `is_admin`, `archived_at`) still producing the
  caller's id and none of those keys; updates matched on `id=eq.<own>&user_id=eq.<caller>` whose patch
  never contains `user_id`; the budget (limit 0 → 403 before any count, 2+2+1 vs a limit of 5 → 422
  with the exact sentence, 2+2+0 writable, archived rows excluded from the counts, the update path
  never counting, feedback never budget-checked); what the responses reveal (plan/usage in `overview`,
  `select=id,title,provider,model,…` on the list so message bodies stay out of it, order and limit
  clauses); the schema (unknown action, enum values, defaults, 21 tags, 101 messages, empty content,
  at most 3 issues joined into the message); the two upstream 502s; and one behaviour pinned rather
  than fixed — re-saving an existing conversation with `messages: []` really does erase its history
  (200, one scoped delete, zero re-inserts), which is registered as **L-17**.
  **Mutation-checked** 16/16, each applied to a temp copy and reverted from it: drop the entitlement
  gate, strip the owner from `ownedCase`/`ownedConversation`, neuter `uidFilter`, insert a case/note
  with no owner, write a message with no owner, skip the `note.delete` and `case.save` ownership
  pre-checks, allow a zero-storage plan, turn `>=` into `>` on the ceiling, count archived rows,
  report a no-match note update as success, lift the body cap, swallow the conversation 502, widen the
  conversation list to `select=*`, delete the parent before its messages, and null the audit actor.
  Every mutation was caught by 51–62 of the 63 cases (ten of them leave exactly one test standing);
  no guard survives its own removal silently.
- `tests/content-admin-gates.test.ts` (51) — the first test that runs `netlify/functions/content-admin.ts`
  and therefore the first that executes the only write surface guarded by a shared bearer token (M-11)
  rather than a session. Method note, because it changed the design: the first draft stubbed the exported
  row helpers (`supabaseSelect`, `supabaseUpsert`, `supabaseDeleteWhere`) and four delete cases came back
  502 or timed out, because mocking a module's export does not intercept that module's own internal calls
  — `supabaseDelete()` still reached the real `supabaseDeleteWhere()` and the real network. The file now
  stubs only `fetchText()` and asserts on the request the real client actually emits, which is the
  stronger version: it also proves which credential each path carries. `serverConfig` is mutated, not
  mocked, so `supabaseAdminConfigured()` and `supabasePublicConfigured()` are production code.
  Groups: the method gate (PUT/PATCH/HEAD/OPTIONS refused with no database call made); the token gate
  failing closed with `CONTENT_ADMIN_TOKEN` unset on both the read and the write path; the seven wrong-token
  shapes (absent header, equal-length wrong, shorter, longer, empty, whitespace, trailing space) plus the
  prefix of the configured token, and the bare/lowercase-scheme forms that are *accepted* because header
  parsing is not the control; `authorize()` ordered before any body parsing, so an unauthenticated caller
  cannot induce a parse; the read's exact 200-row query and the delete's id requirement (`{}`, `{id:''}`,
  `{id:'   '}`, `{id:null}` all answered 400 with no call) and its encoding (`kb-1&or=1=1` emits one
  filter, not two); the whole `articleSchema` (defaults, stripped undeclared keys, the six honesty labels
  accepted and a seventh refused, `domain:'quantum'` refused, four bad slug shapes refused, empty
  title/body refused, 100 001 characters refused, empty batch and 51 items refused, 31 tags refused,
  a non-URL source refused while a full one round-trips, exactly three of five problems reported, absent /
  unparseable / over-`MAX_BODY_BYTES` bodies → 400, 400, 413).
  **Mutation-checked 23/23**, each applied to a temp copy and reverted: unset token allowed to pass, the
  length guard before `timingSafeEqual()` removed, exact compare replaced by a prefix compare, the
  service-role presence check dropped, PUT allowed through, the token check skipped on the read path,
  a whitespace-only delete id accepted, the delete id interpolated raw, the read's row ceiling dropped,
  `verification`/`domain` enums opened to strings, the batch floor and ceiling lifted, uppercase slugs
  accepted, the body ceiling raised an order of magnitude, `MAX_BODY_BYTES` swapped for 64 MB, sources
  allowed to be non-URLs, the tag ceiling raised, `on_conflict` moved to `slug`, the server clock frozen,
  the issue cap cut to one, the difficulty default dropped, and `z.object` opened to `z.looseObject`.
  Each is caught by 1–13 of the 51 cases. **The first pass was 22/23**: cutting the error cap to
  `slice(0, 1)` survived, because my own assertion read "at most three" — rewritten to demand exactly
  three of the five wrong fields, re-run, caught. Writing the file is also what surfaced **H-11**: the
  admin read goes out with the anon key while the mutations carry the service role, and RLS shows anon
  only `published` rows, which the writer can never set.
- `tests/supabase-rest-errors.test.ts` (46) — the DB client's whole failure surface, with `fetchText`
  stubbed so nothing touches the network: the full `restError()` status table, `extractMessage()`
  precedence (`msg` → `message` → `error_description` → `error` → nested `.message`) with the 300-char
  cap and whitespace collapse, which header goes out (service key vs anon vs the member's own token, and
  an empty token still producing `Bearer `), `Prefer` strings and `on_conflict` encoding, the timeouts and
  byte caps, empty-200 → `null` and non-array → `[]`, `content-range` counting, and every fail-closed 503
  when the URL or a key is missing. It is also where L-13's redaction is pinned. **Mutation-checked** 6/6:
  a 401 becoming a generic 502, the service key no longer redacted, admin reads falling back to the anon
  key, `ignore-duplicates` dropped, `content-range` ignored, and `supabaseAdminConfigured()` no longer
  requiring the service key.
- `tests/net-error-texts.test.ts` (60) — the vocabulary every network tool shows a user, table-driven
  over `describeHttpFailure` / `describeTlsFailure`: each code maps to its sentence, a code that arrives
  only on `error.cause` (with the useless `fetch failed` message the platform gives) still maps, an
  `HttpError` passes its own message through, and a non-`Error` throw cannot crash the handler. Two leak
  guards are the point of the file: an input naming `10.0.4.17:5432`, `127.0.0.1:11434` or a
  `node:internal/deps/undici` stack must produce an answer with **no IP address in it**. It also pins the
  L-12 ordering against the literal `'No peer certificate was returned.'` that `netlify/lib/tls.ts:48`
  actually raises. **Mutation-checked** 4/4: the no-peer-certificate branch losing its place (2 fail),
  the `cause` chain ignored (9 fail), `HttpError` passthrough removed, and an internal address leaking.
- `tests/json-extract.test.ts` (18) — the AI replies are steered by `extractJsonObject()`, so this is the
  guard behind "the assistant's structured answers parse or fail honestly": fenced ```json / ```JSON /
  prose-fenced / `ts` fences, a fence followed by trailing prose, a fence beating a second bare object,
  and the two *distinct* 422 sentences — "no JSON object" versus "malformed JSON" — kept distinct on
  purpose because they tell the user different things. Its last cases document the known limits rather
  than pretending otherwise: a top-level array and a two-object answer both fail as "malformed".
  **Mutation-checked** 2/2: collapsing the two failure sentences (3 fail) and stopping unwrapping the
  fence (2 fail — only after the first draft of the file proved vacuous on a fenced-plus-prose reply).
- `tests/access-control.test.ts` (7) — permission matrix against the real role table.
- `tests/auth-session.test.ts` (8) + `tests/local-auth.test.ts` (10) — token store, scrypt params, session cap.
- `tests/net-probe.test.ts`, `net-port.test.ts`, `net-latency.test.ts`, `net-path.test.ts` — the private-address rejections.
- `tests/net-dns-rebinding.test.ts` (15) — the resolver contract behind every outbound probe, added with M-3:
  `resolvePublicAddress` hands back the *literal address it validated* (one `dns.lookup`, asserted, because
  the bug was a second lookup), rejects a hostname whose answer set contains a private address, never hands
  an IP literal to DNS, prefers v4 the way the socket helpers do, and keeps the 400 that `analyzeUrl`
  deliberately treats as "inert host". `inspectCertificate` is asserted at `tls.connect` — `{host: IP,
  servername: name}` — which is the half people forget when pinning: an IP with no SNI reaches the default
  vhost. `checkHttp` is driven through a faked hop whose socket reports an address *different* from the
  hostname, so the assertion fails if the sub-probe goes back to the name. **Mutation-checked 6/6**: revert
  `net-tls`, revert the sub-probe, null the `peer` capture, ignore the `servername` argument, return the name
  as the address, delete the private-answer check. The file mocks `node:http` with a throwing `request` so a
  future test in it cannot silently start reaching the network — the first draft of this file did exactly
  that, and a 350 ms test was the only clue.
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
| DNS-rebinding TOCTOU on the host guard | LOCAL (unit) | **PASS — M-3 closed 2026-10-31.** The guard now resolves once and returns the validated literal address, `assertPublicHost` delegates to it, and both socket paths (`net-tls`, `checkHttp`'s TLS sub-probe) connect to that address with the hostname kept only for SNI. `tests/net-dns-rebinding.test.ts` (15) holds the contract; 6 mutations, 6 caught. Still **NOT TESTED** against a live rebinding target — that needs an egress path and a domain whose record I can flip, so the unit proof is the entire proof |
| Client-bundle secret scan | LOCAL + NETLIVE | **PASS** — no `VITE_*`/`NEXT_PUBLIC_*` exists; grep of `dist/` and the served JS finds no key material |
| Role escalation through the request body | LOCAL | **PASS** — no handler reads `role`; DB triggers block privilege writes (migrations 0001:82, 0002:84, 0003:39) |
| Rate limiting under parallel load | — | **NOT TESTED**; and it is in-memory per container (H-8), so a load test would prove weakness, not strength |
| CSP effect on Vercel Toolbar | VPREV | **FAIL (cosmetic, M-13)** — reported CSP violation from the injected toolbar script; app functionality unaffected. Production CSP will not be weakened to silence it |

## 6. Performance measurements

| Metric | Environment | Value | Verdict |
| --- | --- | --- | --- |
| Vite production build time | LOCAL | 447–690 ms; the new `build:knowledge-index` step adds 123–165 ms | PASS |
| `npm run build` end to end | LOCAL | 17.2–19.2 s wall (npm overhead + `tsc --noEmit` + vite + the 1180 kB `api/index.js` esbuild bundle) | INFO — the gate is slow for reasons that have nothing to do with the bundle split |
| Entry chunk | LOCAL | 484.91 kB min / **149.51 kB gzip** (`index-KsoF9hUP.js`) — was 747.68 / 232.60 before M-18 | M-18 landed: 263 kB min / 83 kB gzip out of the entry |
| First-paint download (entry + its static imports) | LOCAL | `index` + `utils` = 658.1 kB min / **203.7 kB gzip** (was 278.6 kB gzip) | **MISS by 3.7 kB** vs the < 200 kB gzip budget → the remaining lever is the eagerly-bundled Arabic dictionary, which needs an async language load, i.e. a UX decision (see M-18) |
| Largest lazy chunk | LOCAL | `ToolkitPage` 356.75 kB / 108.21 kB gzip | WARN — 43 tools statically imported |
| Knowledge catalog | LOCAL | `ArticlePage` 318.05 kB / 98.45 kB gzip, of which the 44 article bodies are the bulk | INFO — post-M-18 this is where the bodies live, fetched only on `/kb/<slug>` |
| `utils` shared chunk | LOCAL | 173.23 kB / 54.16 kB gzip | INFO — holds both i18n dictionaries; statically imported by the entry, so it *is* first paint |
| Total JS emitted | LOCAL | 61 chunks, 1.94 MB minified JS | PASS (splitting works; M-18 moved the bodies between chunks and removed them from the entry) |
| Slowest live endpoint | NETLIVE | `/api/news` 7.16 s | WARN — first call after idle |
| Typical API call | NETLIVE | 1.1–2.1 s | PASS for serverless cold starts |
| Test suite wall time | LOCAL | **16.77, 20.09 and 20.89 s** tracked (67 files / 904 tests), **64–67 % of tracked time spent creating 67 jsdom environments** (104.62–129.87 s cumulative across workers). The tree one file back measured 16.6–26.1 s for 66/853, so the extra file moved the count and not the clock | WARN — `pool: 'vmThreads'` or `isolate: false` is the documented fix; not applied yet, and the cost stopped being theoretical on 2026-11-01: the added files tipped an existing render test over the 5 s timeout (see **L-15**). Only 8 of the 67 files render a component, so the environment is wasted on the other 59. The six newest server files are the clearest example — `admin-rbac-gates`, `net-error-texts`, `supabase-rest-errors`, `json-extract` (203 tests, 77 ms of test body, 1.20 s of wall in isolation) plus `workspace-tenancy` (63 tests, 58 ms of body, 1.59 s of wall, 68 % of it environment) and `content-admin-gates` (51 tests, 36–44 ms of body, 0.97–1.15 s of wall) — all six assert strings, filters and status codes and never touch the DOM; they pay the global `environment: 'jsdom'` from `vitest.config.ts`, and a per-file `@vitest-environment node` comment is the cheap fix and is **not** applied, because it is a config-level change to how every suite runs. The slowest single file is `command-palette.test.tsx` at 10.2–11.3 s for 10 tests |
| Lighthouse | — | **NOT TESTED** — no browser run recorded in this phase |
| Real-device / mid-tier network | — | **NOT TESTED** |

## 7. UI, accessibility, responsive — NOT TESTED

The master prompt's Phase 9 and Phase 13 need a browser. What exists today is static reasoning
plus 7 rendering tests, which is not enough to claim any of the following:

| Surface | Status |
| --- | --- |
| Desktop / laptop / tablet / mobile layout at 1440, 1024, 768, 390 px | **NOT TESTED** |
| RTL (Arabic) visual parity on the 5 pages that switch direction | **NOT TESTED** (clean in code; 0 mixed-direction strings found by grep) |
| Keyboard-only navigation, focus rings, skip link | **NOT TESTED in a browser.** M-15/M-16 were the two known defects in this row and are now fixed with 23 jsdom tests behind them (`modal-focus` 13, `command-palette` 10) — but jsdom has no `inert` semantics, no focus ring and no screen reader, so those tests assert attributes and pointer identity, not what a keyboard user experiences. The skip link and focus-visible styling are still unread by any test |
| Screen-reader labels on the 43 tools | **NOT TESTED** |
| 11 themes × light/dark contrast | **NOT TESTED**; H-6 flags light-theme contrast specifically |
| Reduce-motion toggle actually stopping animation | **NOT TESTED** |
| Every page under a real authenticated session | **NOT TESTED** — blocked on D1/D5/D6 |

## 8. Highest-risk untested surfaces (what a new test should attack first)

1. ~~`netlify/functions/workspace.ts`~~ — **done 2026-11-01** by `tests/workspace-tenancy.test.ts`.
   The row used to read "workspace.ts *upload path* — size/MIME/binary behaviour", inherited from the
   2026-10-27 report, and it was wrong: `workspace.ts` has no upload, no `FormData` and no Supabase
   Storage call (LOCAL grep), and neither does `src/services/api.ts` — the only browser→server file is
   the base64 screenshot on `/api/ai/analyze`, whose cap is H-3's and whose handler is already imported
   by a test. The real gap was tenancy and the item budget, and both are now guarded at the handler
   (16/16 mutations caught). What the suite does **not** prove: any round trip against the real
   database, so the RLS half of "no IDOR" is still unverified (D5/D6) — and it pins two behaviours the
   register now carries as L-16 (7 of 16 workspace actions, including the only writer of
   `content_feedback`, have no UI caller) and L-17 (re-saving a conversation with `messages: []`
   deletes its history).
2. ~~`content-admin.ts`~~ **done 2026-11-01** — `tests/content-admin-gates.test.ts` (51) now imports and drives it, which closes the M-11 claim that its token gate fails closed and exposed **H-11** in the process. What is left of this item: the nine `net-*` handlers plus `content.ts` and `ai-script.ts` — **11 of 22 functions** still have no test importing them.
3. The whole AI answer chain on a real provider (H-1 fake citations, M-7 key redaction in upstream errors). **Still open — blocked on D4.**
4. Entitlement enforcement against a live deployment: a member without `ai.use` calling `/api/ai/test` (M-6). The handler logic is now tested; the live repro needs a token. **Blocked on D5/D6.**
5. 26 of 33 pages and 5 of 18 tool modules render no test at all — jsdom coverage exists for the shared kit and the two fixed surfaces only.
6. ~~`src/services/api.ts`, `netlify/lib/host.ts`, `netlify/lib/supabase.ts`, `netlify/functions/admin.ts`~~ — all four were on this list; `api.ts` is executed since H-10, `host.ts` since M-3, and `supabase.ts` + the whole admin surface since the 2026-11-01 batch. What that batch does **not** prove: any real database round trip, any authenticated live call, and the `users.create` / `users.reset_password` / `users.revoke_sessions` actions that the Supabase path never implemented (L-14).

## 9. Honest verdict

| Question | Answer |
| --- | --- |
| Does the code compile, lint, test and build? | **YES**, measured LOCAL 2026-10-31. |
| Is the Netlify production site live and functioning for anonymous visitors? | **YES** for SPA + health/auth-config/content/news; AI and network tools need sign-in and there is no provider key. |
| Is the platform usable by a real signed-up user today? | **NOT VERIFIED.** Auth reaches Supabase (proven by the 401 upstream detail), but no session was ever obtained in this audit, so register → verify → login → use-a-tool has not been walked end-to-end. |
| Is Vercel production usable? | **NO.** Dead production alias (C-2) and missing env vars (C-3). Owner actions D1–D4. |
| Is it safe to publish? | **CONDITIONALLY.** The two rule-breaking findings are fixed in the working tree — H-1 (model-recalled URLs are now labelled unverified in the payload and in the UI) and M-1 (trial hashing refuses to start without `NEXORA_HASH_PEPPER`) — plus M-5/M-6/M-7/M-8/L-2. They are **verified only by unit tests on LOCAL**, not deployed, and the remaining W1 items (L-1, L-4, M-9, M-10, H-6) are open. Publishing is still owner-gated by D10. |
| Ready to mark production-approved? | **NOT TESTED / NOT READY.** The blocking set is now: deploy the W1 batch, one authenticated end-to-end walk, one real AI answer, one upload ≤ and > the cap, one live SSRF attempt, and a browser pass over §7. |
