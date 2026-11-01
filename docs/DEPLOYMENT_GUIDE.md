# DEPLOYMENT GUIDE — Adnan Tech | منصة عدنان تك

Operator runbook, current as of 2026-10-31. It supersedes nothing in `docs/DEPLOYMENT.md`
(technical build settings) or `docs/VERCEL_DEPLOYMENT.md` (platform comparison) — it adds the
order of operations, the verification gates, and the two things those files predate:
**Vercel production is currently dead** and **Vercel has no Supabase variables**.

Read `docs/ENVIRONMENT_VARIABLES.md` first if you need the authoritative variable list.

## 0. State you are deploying into (measured, do not skip)

| Target | State on 2026-10-31 | Consequence |
| --- | --- | --- |
| `https://adnan-tech.netlify.app` | **LIVE and working** — SPA, `/api/health`, `/api/auth`, `/api/news`, `/api/content` all 200; Supabase connected; **no AI key** | Netlify is the only production host today |
| Vercel project `adnan-mohamed/adnan-tech` | **production alias → 404 `DEPLOYMENT_NOT_FOUND`**; the 2026-10-28 production deployment is in `Error`; `adnan-tech.vercel.app` was never assigned | Do not treat Vercel as a fallback until owner action D2 |
| Vercel previews | Reachable only through Vercel SSO (Deployment Protection ON) and answer `/api/health` with `database.configured=false` | Env vars D3 must be added with **Preview + Production** scopes |
| Supabase project `zrlhtrujorfodccetkne` | reachable, migrations 0001–0002 applied (profiles/trials/…), `articles` table returns 0 published rows | content pipeline is live but empty (M-19) |

## 1. Rules for this runbook (they come from the owner, not from preference)

1. **Never put a secret in a chat message, in a commit, in a log line, or in the browser bundle.**
   Secrets go into the host's Environment Variables screen. There is no `VITE_*` and no
   `NEXT_PUBLIC_*` in this project, and adding one for a secret is a defect, not a shortcut.
2. **Production deploy happens only after the owner writes the exact phrase "انشر للإنتاج".**
   Until then, deploy to preview/branch only.
3. **Do not delete the errored Vercel production deployment** and do not re-point the alias
   without approval (D9).
4. **Do not weaken the CSP** to silence any console message (M-13). `script-src` stays `'self'`,
   no `unsafe-inline`, no `unsafe-eval`.
5. **Do not make Vercel previews public.** Deployment Protection stays ON unless the owner says
   otherwise (D8).
6. Migrations: never create a new database, never drop or edit existing rows without an explicit
   approval plus a backup and a written migration plan.
7. Every deploy step below is followed by §7 verification. A deploy without the checklist is
   "deployed, unverified".

## 2. Prerequisites

| Needed | Where | Verify |
| --- | --- | --- |
| Node 22.x — one pin, four places (`package.json engines`, `.nvmrc`, `netlify.toml`, esbuild target); a test fails if they disagree. npm prints an advisory warning if you build on 24 | `package.json:8-10`, `.nvmrc`, `netlify.toml:7`, `scripts/build-vercel-api.mjs:24` | `node -v`, `npm test` → `tests/runtime-pin.test.ts` |
| Netlify site connected to the repo, or the Netlify CLI | app.netlify.com | `GET /api/health` → 200 |
| Vercel project `adnan-tech`, CLI optional | vercel.com dashboard | see §5 |
| Supabase project + 3 migrations applied | supabase.com dashboard | §6 |
| An AI provider key (OpenRouter recommended) | provider console | owner pastes it into the host, never into chat (D4) |
| Optional `GEMINI_API_KEY` for grounded web search | aistudio.google.com | `docs/GEMINI_WEB_SEARCH_SETUP.md` |

## 3. Build settings (both hosts, already committed)

| Setting | Value | File |
| --- | --- | --- |
| Framework | Vite (SPA) — **not Next.js** | `vercel.json:3`, `vite.config.ts` |
| Build command (Netlify) | `npm run build` (= `build:knowledge-index && tsc --noEmit && vite build && npm run build:vercel-api`) | `netlify.toml:2`, `package.json:14` |
| Build command (Vercel) | `npm run build` (same script; the API bundle is part of it) | `vercel.json:4` |
| Output directory | `dist` | `netlify.toml:3`, `vercel.json:5` |
| Install | `npm ci --no-audit --no-fund` | `vercel.json:6` |
| Functions | `netlify/functions` (22 flat files, esbuild bundler) | `netlify.toml:4,11-14` |
| Vercel function | `api/index.js`, generated, git-ignored, 60 s `maxDuration` | `vercel.json:7-11` |
| Node | **22.x on both hosts.** `engines.node = "22.x"` overrides the Vercel project dropdown, so the dashboard can stay on 24.x and the deploy still runs 22.x (M-12) | `netlify.toml:7`, `package.json:8-10` |

**Three structural traps, two already bitten once:**
- Nested function folders do not work on Netlify. Handlers stay flat and `/api/*` redirects stay
  explicit, with the specific rules above the `/api/*` wildcard (`netlify.toml:19-118`).
- `api/index.js` is generated. It is no longer a second command to remember: `npm run build`
  ends with `build:vercel-api`, so every build — local or on Vercel — regenerates it (H-5). Before
  this, building by hand or forgetting the second command left Vercel silently serving a stale API.
  `tests/route-parity.test.ts` additionally fails `npm test` if a route exists on one host but not
  another; there is no CI here, so that check only runs when the suite is run locally.
- `src/data/knowledgeMeta.ts` is generated too, and it is committed on purpose (Vite needs it at
  build time and the test suite reads it). It is the catalog without the article bodies, which is
  what keeps 44 bodies out of the first-paint bundle. Editing it by hand is the trap: the next
  `npm run build` overwrites the edit, and `tests/knowledge-meta.test.ts` fails the mismatch first.
  Edit `src/data/knowledge.ts` and regenerate instead.

## 4. Deploy path A — Netlify (the working host)

Dashboard route (recommended; no terminal needed):

1. app.netlify.com → **Adnan Tech** site → **Deploys** → check the last deploy is green.
2. **Site configuration → Environment variables** → confirm the names listed in
   `docs/ENVIRONMENT_VARIABLES.md` §"Supabase / auth" exist with **Applied** scope, values entered
   in the field, never copied from a chat.
3. To ship code: push to the branch the site builds from. Netlify builds automatically.
4. Before merging, confirm the local gates are green (typecheck, lint, test, build) — a type error
   fails the deploy, so §8 is not optional.

CLI equivalent, if the owner prefers it:

```bash
npm run build            # must succeed
npx netlify deploy       # draft deploy, returns a preview URL — safe, not production
npx netlify deploy --prod  # ONLY after "انشر للإنتاج"
```

## 5. Deploy path B — Vercel (blocked until D2–D4 are done)

Order matters. Do not re-deploy before step 3 or you will reproduce the same `Error`.

1. **Read the failed build log** (owner action D2): vercel.com → **Projects → adnan-tech →
   Deployments** → the 2026-10-28 row marked *Error* → **Build Logs**. The fix is whatever that log
   names; nothing here can guess it.
2. **Add the variables with both scopes** (D3): Project → Settings → **Environment Variables**,
   for each of `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXORA_HASH_PEPPER`, `NEXORA_SITE_URL`, `CONTENT_ADMIN_TOKEN` tick **Production, Preview,
   Development**. Production-only ticking is what makes previews answer `database.configured=false`.
   `NEXORA_SITE_URL` on Vercel must be the URL chosen in D1 — and Supabase's Auth → Redirect URLs
   allowlist must contain the same value or email links break.
3. Add `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_ALLOWED_HOSTS` (D4) if Vercel is to serve AI.
4. Deploy a preview first:
   `npx vercel` (no `--prod`). Verify §7 against the preview URL with
   `npx vercel curl https://<preview-url>/api/health` — plain `curl` hits the SSO 302 (D8).
5. Production: `npx vercel deploy --prod` **only** on the owner's "انشر للإنتاج".
   Note the Vercel quirk recorded in project memory: on a brand-new project the *first* deploy
   lands as production even without `--prod`; check with `npx vercel inspect <url>`.
6. Leave the errored deployment in place until the owner approves deleting it (D9).

## 6. Supabase setup (once per environment)

1. **Migrations, in order, in Dashboard → SQL Editor.** Paste and run each file completely:
   `supabase/migrations/0001_nexora.sql` → `0002_nexora_owner_admin_roles.sql` →
   `0003_service_role_claim_lookup.sql`. The SQL Editor does not auto-save a typed query; run it
   explicitly. RLS is enabled on all 18 tables inside 0001 — do not run it partially.
2. **Auth → URL Configuration**: Site URL = the value of `NEXORA_SITE_URL`; Redirect URLs = the
   same origin plus `/verify`, `/reset-password` paths the app uses.
3. **Auth → Providers / Email**: on a new project `mailer_autoconfirm` is `false` and there is no
   SMTP, so a signup would sit unconfirmed forever. Either configure SMTP (D5 territory) or accept
   that registration cannot complete in that environment — say so in the test report; do not
   silently flip autoconfirm in production.
4. **Storage**: the workspace bucket and its three `storage.objects` policies come from 0001:455-468.
   Note the schema drift on projects created 2025+: `storage.objects.owner` is `uuid`, and there is
   no `mime_type` column (the type lives in `metadata->>'mimetype'`).
5. **Owner bootstrap**: roles are never granted by request body. After the owner account exists and
   is verified, run `npm run owner:promote` (or `admin:promote`) with `--env-file=.env`, which reads
   the emails from `OWNER_EMAIL` / `ADMIN_EMAIL`.
6. `supabase/.temp/` is git-ignored; nothing else in `supabase/` should change without a new
   numbered migration file.

## 7. Post-deploy verification (run every time; record the verdict)

Automated part — replace the base URL:

```bash
B=https://adnan-tech.netlify.app
curl -s $B/api/health | head -c 400
curl -s "$B/api/auth?action=config"
curl -s -o /dev/null -w "%{http_code}\n" -X POST $B/api/ai/chat -H 'content-type: application/json' -d '{}'
curl -s -o /dev/null -w "%{http_code}\n" "$B/api/net/dns?host=example.com"
curl -s $B/api/news | head -c 200
curl -sI $B/ | grep -iE "content-security|strict-transport|x-frame|x-content-type|referrer|permissions"
```

| # | Check | Expected | Status today |
| --- | --- | --- | --- |
| 1 | `/api/health` | 200, provider/model reported truthfully, no invented flags | PASS except M-8 |
| 2 | `/api/auth?action=config` | 200, `provider=supabase`, `localMode=false`, right `siteUrl` | PASS on Netlify, **FAIL on Vercel** (no env) |
| 3 | anonymous `/api/ai/chat` | 401 | PASS |
| 4 | anonymous `/api/net/*` | 401 | PASS |
| 5 | security headers on `/` | CSP + HSTS + nosniff + DENY + referrer + permissions | PASS |
| 6 | `/api/news` | items present, real publisher URLs | PASS (7.16 s cold) |
| 7 | register → verify email → login | session issued, profile row created, trial started | **BLOCKED** (D5: no mailbox walked; SMTP not configured) |
| 8 | real AI chat + analyze with a key | a completion, sources labelled as model-asserted vs searched | **BLOCKED** (D4/D6) |
| 9 | upload at 3 MB and above 3 MB | one accepted, one structured "exceeds the 3 MB limit" (not a raw 413) | **NOT TESTED in a browser**; H-3 is now single-sourced in `shared/upload-limits.ts` and covered by `tests/upload-limits.test.ts` — a real upload on both hosts is still owed (W5) |
| 10 | second account cannot read the first one's workspace case | 404/403, empty list | **BLOCKED** (needs 2 sessions + D7) |
| 11 | `/admin` invisible to member, tabs correct for staff | server rejects the API call too, not just the UI | **BLOCKED** (needs sessions) |
| 12 | `/toolkit`, `/copilot`, `/diagnostics` load on a phone width | no clipped tables, no blank shell | **NOT TESTED in a browser.** M-17's three clipped tables are fixed and `tests/responsive-tables.test.ts` now rejects the pattern anywhere in `src`, but that reads class names, not a 375 px viewport; H-9's per-route boundary is likewise fixed in code and unit-tested but never exercised in a browser. This row is the browser pass the checklist still needs |

Anything in **BLOCKED** needs an owner action from `docs/PROJECT_AUDIT.md` §7 (D1–D10), not more code.

## 8. Local gates before any deploy

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

Current measured state: all four PASS (0 lint errors / 16 warnings, all of them `react-refresh`
module-layout hints rather than defects; 904 tests in 67 files, 16.77–20.89 s; a build that takes
**≈38 s end to end** — `tsc --noEmit` is 33.6 s of that and `vite build` only 0.59–0.71 s, so the
"under 1.4 s" figure this guide carried before 2026-11-01 described the bundler, not the pipeline.
The same script also regenerates `src/data/knowledgeMeta.ts` and the 1180 kB `api/index.js`).
If `npm run build` fails, nothing downstream is deployable — that is how the site sat broken for four days before 2026-10-31.

One local-only difference worth knowing before you trust a dev run: since L-3 the dev API adapter
(`scripts/dev-api-plugin.ts`) enforces the same 4.5 MB body ceiling as Vercel and answers with the
same `payload_too_large` envelope, so an upload that fails locally fails in production too. Before
that, oversized requests succeeded locally and 413'd on the host.

## 9. Rollback

| Host | Rollback |
| --- | --- |
| Netlify | Deploys list → previous green deploy → **Publish deploy**. Data is unaffected because no migration runs in the app. |
| Vercel | Deployments → previous production deployment → **… → Promote to Production**. Do not delete the failed one (D9). |
| Supabase schema | Migrations are forward-only in this repo. Rollback = a new numbered migration file that undoes the change, written and approved first, with a backup taken (Dashboard → Database → Backups) beforehand. |
| Env vars | Vercel: un-tick the scope or delete the variable, then redeploy for the change to take effect. Netlify: same, plus a redeploy. |

## 10. After release, watch these four things

1. **Netlify credits** — free plan 300 credits/month, 20 credits/GB bandwidth, 10 credits/GB-hour
   function time; the site pauses at zero. AI-heavy traffic burns function time.
2. **Provider spend** — OpenRouter credits and (if enabled) Gemini grounding billing. `AI_*` keys
   are the meter; the daily per-user cap is `netlify/lib/trial.ts`, not the client.
3. **`/api/health` from a scheduled check** — a 503 or a flipped `database.configured` means env or
   Supabase trouble, not app trouble.
4. **`audit_events` and `usage_events` tables** — the only real record of who did what; nothing else
   in the platform logs identity.

## 11. Known blockers (owner decisions, do not code around them)

`D1` host choice · `D2` Vercel build log · `D3` Vercel env vars · `D4` AI keys · `D5` throwaway
signup for the e2e proof · `D6` backup remote + push approval · `D7` read-only Supabase access ·
`D8` preview protection policy · `D9` deletion of the errored deployment · `D10` the production
phrase. Full table: `docs/PROJECT_AUDIT.md` §7.
