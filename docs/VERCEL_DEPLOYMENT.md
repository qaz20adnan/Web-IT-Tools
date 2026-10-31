# Vercel deployment — Adnan Tech

The platform runs on Vercel **and** still deploys to Netlify from the same commit. Nothing
in `netlify/functions` or `netlify/lib` was rewritten: the handlers keep their Lambda-style
`(event, context)` signature and the Vercel side is one adapter plus one generated file.

## Layout

```
vercel/serverless.ts              (req, res) → (event, context) bridge; body and IP handling
vercel/dispatcher.ts              the route table: 22 public /api paths → the Netlify handlers
scripts/build-vercel-api.mjs      esbuild step that bundles the dispatcher into api/index.js
api/index.js                      GENERATED (git-ignored) — the only Vercel Function
vercel.json                       build, rewrites, function limits and security headers
netlify.toml + netlify/functions  unchanged — Netlify stays a valid target
```

`vercel/` is in `tsconfig.json` and is type-checked by `npm run build`. `api/` is not,
because it is build output; it is listed in `.gitignore`.

## Why one function instead of 22

Two Vercel facts decide the shape:

1. **The Hobby plan allows at most 12 Serverless Functions per deployment.** The platform
   exposes 22 `/api/*` routes, so one file per route fails the build outright. Rather than
   upgrade the plan or drop routes, every route is dispatched by a single function.
2. **`@vercel/node` does not bundle.** For a TypeScript entry it renames `.ts` → `.js` and
   lets Node run it. This codebase uses extensionless relative imports
   (`from '../netlify/lib/http'`), which ESM cannot resolve — the deployed function died
   with `ERR_MODULE_NOT_FOUND: '/var/task/netlify/functions/admin'`. Forcing
   `{"type":"commonjs"}` in `api/package.json` only swapped that for
   `SyntaxError: Cannot use import statement outside a module`.

The fix is therefore a build step, not a code change: `scripts/build-vercel-api.mjs` runs
esbuild over `vercel/dispatcher.ts` with `format: 'esm'`, `platform: 'node'`,
`target: 'node22'`, `bundle: true` and `external: ['node:*']`. The result is a
self-contained ~1.1 MB `api/index.js` with zero relative imports, so none of the 40+
extensionless imports in `netlify/` need editing and Netlify keeps consuming the same
source. esbuild is already in the tree through Vite; it is now an explicit devDependency.

## Routing

`vercel.json` maps every public API URL onto the single function and carries the original
path in a query parameter:

```json
{ "source": "/api/:match*", "destination": "/api/index?_fn=/:match*" }
```

`resolveRoute()` in `vercel/serverless.ts` prefers `_fn` and falls back to the pathname, so
`/api/ai/chat` and `/api/index?_fn=/ai/chat` reach the same handler. `_fn` is then deleted
from `queryStringParameters`, which the tests pin down: `/api/news?refresh=1` still arrives
with `{ route: 'news', query: { refresh: '1' } }`. Without that, Vercel's rewrite would have
silently dropped the query string that the News tool uses to bypass its cache.

The SPA fallback excludes the API prefix — `/:path((?!api/).*)` → `/index.html` — because
Vercel checks the filesystem before rewrites, but a mistyped `/api/…` path would otherwise
be answered with HTML 200. It returns the same JSON the dev server returns instead:
`{"error":{"code":"not_found","message":"No API function matches /api/typo."}}`.

The same 22 routes are asserted three ways in `tests/vercel-bridge.test.ts`: against the
live route table, against the files in `netlify/functions`, and against the public URLs the
frontend calls.

## Environment variables

Names are identical to `.env.example` — `AI_*`, `GEMINI_*`, `SUPABASE_*`, `NEXORA_*`,
`RATE_LIMIT_*`, `NEWS_FEEDS`, `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `PRINTER_*`,
`CONTENT_ADMIN_TOKEN`, `OWNER_EMAIL`, `ADMIN_EMAIL`, `LOG_LEVEL`.

**No secret gets a `VITE_` or `NEXT_PUBLIC_` prefix.** Vercel inlines both prefixes into the
browser bundle, which would publish `SUPABASE_SERVICE_ROLE_KEY`, `AI_API_KEY` and
`GEMINI_API_KEY`. Values are added as server-side (plain or Encrypted) environment and are
read through `process.env` in `netlify/lib/env.ts`.

```bash
vercel link                                            # once, picks the project
vercel env add SUPABASE_URL production
vercel env add SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add AI_PROVIDER production
vercel env add AI_MODEL production
vercel env add AI_API_KEY production
vercel env add GEMINI_API_KEY production               # optional, Web Research only
vercel env add GEMINI_MODEL production                 # optional
vercel env add GEMINI_WEB_SEARCH_ENABLED production
vercel env add NEXORA_HASH_PEPPER production
vercel env add NEXORA_SITE_URL production
vercel env add CONTENT_ADMIN_TOKEN production
```

For local work against the same values, `npm run env:vercel` writes `.env.local`
(git-ignored, and created by `vercel link`). `npm run dev` serves `/api/*` through
`scripts/dev-api-plugin.ts`, which executes the Netlify handlers in-process, so the local
dev server, `netlify dev` and Vercel all hit the same code.

`NEXORA_LOCAL_AUTH` stays development-only — it is ignored in a production build, so account
auth on Vercel goes through Supabase exactly as it does on Netlify.

## Deploy

```bash
npm run build                              # includes build:vercel-api, via package.json
npx vercel deploy --yes                      # preview deployment (remote build)
npm run deploy:vercel                        # production, only when decided
```

Deploy with a **remote** build. `vercel build` runs `npm ci` in the checked-out project on
this machine, and a live Vite dev server holds `lightningcss.win32-x64-msvc.node` open, so
the reinstall fails with `EPERM` and leaves `node_modules` half-deleted.

## Preview verification — 2026-10-28

Deployed as `adnan-tech-2up6i86k6…` and `adnan-tech-j1jvjwjo9…` (project
`adnan-mohamed/adnan-tech`), verified from the live preview URLs:

| Check | Result |
| --- | --- |
| `GET /api/health` | 200 with the full service report; `news.configured:true`, `ai/research/database/contentAdmin:false` as expected with no env set |
| `GET /api/news` ×2 | 120 items, 19 sources, 0 errors, **identical** `fetchedAt` — outbound fetch, RSS parsing and the in-instance cache all work |
| `GET /api/news?refresh=1` | later `fetchedAt`, so query parameters survive the `_fn` rewrite |
| `GET /api/typo` | JSON 404 from the dispatcher, not HTML |
| `GET /copilot` | SPA deep link served by the fallback |
| `GET /theme-init.js` | static file wins over the rewrite |
| Response headers | CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, COOP, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` on `/api/*` — all present |

Not verified, and why: Vercel **Deployment Protection (Vercel Authentication)** is on for
the project, and `vercel curl` only performs unauthenticated GETs. POST endpoints
(`/api/auth`, `/api/ai/chat`, `/api/ai/test`, image uploads), the 4.5 MB body limit, and
whether the runtime image ships `ping`/`traceroute` are all still untested. The account
holder needs to disable or bypass deployment protection for previews.

One known cosmetic issue: Vercel injects the Toolbar script
(`https://vercel.live/_next-live/feedback/feedback.js`) into preview HTML. The ported CSP
allows `script-src 'self'`, so the browser blocks it — a console error on previews only, no
functional impact. `toolbar` is **not** a valid `vercel.json` key (the build rejects it with
`Invalid vercel.json - should NOT have additional property toolbar`); it is a dashboard
setting under Project Settings → General → Vercel Toolbar, and the CLI has no flag for it.

## Platform limits that differ from Netlify

| Behaviour | Vercel | Netlify |
| --- | --- | --- |
| Serverless functions per deployment | **12 on Hobby** (worked around with one dispatcher) | no such cap |
| Max request/response body | **4.5 MB** (`413 FUNCTION_PAYLOAD_TOO_LARGE`) | 6 MB |
| Function duration | `maxDuration: 60` set in `vercel.json` | 10 s default |
| Region | single region, `iad1` by default (decision open) | single region |
| Build Node.js | 24.x; the bundle targets `node22` | Node 22 |
| In-memory rate limits / research cache | per warm instance | per warm instance |

Consequences worth knowing:

- **Image analysis** (`POST /api/ai/analyze`, and `POST /api/ai/chat` with attachments) is
  capped at 4.5 MB instead of 6 MB. The adapter enforces it itself and returns the same
  `413 payload_too_large` JSON envelope, so the UI message stays localised rather than
  surfacing an edge-level error.
- **Duration is now generous**: the 45 s Gemini grounding timeout fits inside 60 s, which it
  did not inside Netlify's 10 s default.
- **Region changes the network tools.** `ping`, `traceroute`, port checks and the speed test
  measure from the function's own region. Pick the region near the users who need those
  numbers, and say which region produced a result when reporting one.
- **`ping` and `traceroute` call the OS binaries** through `execFile`. If the Vercel runtime
  image has neither, the tools do not fail: `net-diagnostics` reports
  `available: false` with reason `unsupported`. Confirm both after deployment protection is
  lifted.

## Other free hosts, measured 2026-10-28

Checked against what this platform actually needs: 22 server routes, outbound HTTPS, raw TCP +
TLS + DNS probes, `execFile` of the OS `ping`/`traceroute`, 45–60 s requests, ~4.5 MB bodies and
server-only secrets.

| Host | Free today | Commercial on free | `ping`/`traceroute` | 45–60 s | Verdict |
| --- | --- | --- | --- | --- | --- |
| Netlify | 300 credits/month, then the site pauses | allowed | not documented | 60 s default | **chosen for production** |
| Vercel Hobby | yes | **not allowed** (non-commercial only) | no | 60 s via `maxDuration` | preview/test only |
| Cloudflare Workers/Pages | 100k requests/day, unmetered bandwidth | allowed | no — `node:child_process` is a stub | wall time unlimited but **10 ms CPU** on free | static + most APIs; private-IP targets blocked |
| Koyeb | 1 instance, 512 MB, scales to zero after 1 h idle | not prohibited | yes (real container) | 120 s | needs a card; cold starts |
| Oracle Cloud Always Free | 2 OCPU/12 GB VM, 10 TB egress | allowed | yes | unlimited | only host meeting every requirement, but self-managed |
| Render free | 750 instance-hours/month | "not for production" per docs | not documented | 30 s | too short for the AI routes |
| Deno Deploy | 1M requests/month | — | yes | — | shutting down (~April 2027) |
| AWS Amplify / Railway / Fly.io / Zeabur | credits-only, trial-only, ended, or closed to new free projects | — | — | Lambda caps bodies at 6 MB | excluded |

A sandboxed host does not break the network tools: `net-diagnostics` reports
`available: false` with reason `unsupported`, and the UI says so instead of faking a result.

## Rollback

`netlify.toml` and `netlify/functions` are untouched, so deploying the same commit to
Netlify remains a one-command fallback. The Vercel-only surface is `vercel/`,
`scripts/build-vercel-api.mjs`, `vercel.json` and the generated `api/`.
