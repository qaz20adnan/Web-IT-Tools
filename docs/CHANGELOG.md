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
- Recorded that `adnan-tech.vercel.app` has never been assigned to the Vercel project and that its
  production alias 404s (finding C-1/C-2 in the audit table). Note for the owner: the repo's own
  plan (`README.md:15`, `docs/DEPLOYMENT.md:5-13`) designates **Netlify** as production and Vercel
  as preview-only, so serving production from `adnan-tech.vercel.app` is a *change* of plan, not a
  repair — it needs decision D1.

### Discovered, not yet fixed (next waves)
| Wave | Items |
| --- | --- |
| W1 safe-now | H-1 model-asserted citations presented as verified, M-1 pepper fallback, M-2 printer default `true`, M-6 AI/research endpoints gate on `workspace.read`, M-7 unredacted upstream error detail, M-8 hardcoded `news.configured` in `/api/health`, L-1 `og:image` still pointing at `nexora-ai.netlify.app` |
| W2 platform | H-3 three conflicting upload caps, H-4 per-attempt timeout exceeds the 60 s platform ceiling, H-5 add a stale-bundle guard to CI, M-12 Node version pinning, M-13 CSP on previews only, M-14 binary/multipart bodies on the Vercel bridge |
| W3 security depth | H-7 data left in `localStorage` after sign-out, H-8 in-memory and spoofable rate limiter, M-3 TLS DNS-rebinding window, M-4 implicit-flow tokens in the URL fragment, H-2 token storage migration, M-11 shared CMS bearer token |
| W4 resilience/UX | H-9 one root `ErrorBoundary` for 33 pages, H-10 six handlers invent their own error shapes, M-15/M-16 focus and ARIA defects, M-17 clipped tables on phones, M-18 232 kB gzip entry chunk |
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
