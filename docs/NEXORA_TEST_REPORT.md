# NEXORA Test and Verification Report

Date: 2026-10-23
Environment: Windows, Node.js 22, local workspace without a live Supabase project,
payment provider or deployment credentials.

## Commands run

| Command | Result |
| --- | --- |
| `npm run typecheck` | PASS — no TypeScript errors |
| `npm run lint` | PASS — 0 errors, 11 pre-existing warnings |
| `npm test -- --run` | PASS — 13 files, 92 tests |
| `npm run build` | PASS — production bundle generated |

Build warnings: the Vite config imports lack file extensions (future `configLoader`
warning) and the main chunk is 518.85 kB minified. Neither blocks the build.

## Automated coverage

| Suite | Focus |
| --- | --- |
| `tests/rbac.test.ts` | Role matrix, suspension override, inherited-key safety, assignable roles |
| `tests/trial.test.ts` | Trial dates, expiry, ending-soon, entitlements, quotas, subscription activity |
| `tests/auth-session.test.ts` | Session persistence, malformed storage, implicit-flow fragments, hash clearing |
| `tests/i18n.test.ts` | English/Arabic key parity |\n| `tests/content.test.ts` | Article/script/theme inventory integrity, bilingual content, HTTPS sources |
| `tests/ai-adapter.test.ts` | Provider normalization, fallback/error mapping, URL validation |
| `tests/news.test.ts` | Feed parsing, limits, partial failures, cache behavior |
| `tests/calculators.test.ts`, `cvss.test.ts`, `utils.test.ts` | Tool calculations and utilities |
| `tests/scriptScan.test.ts` | Script risk scanning |
| `tests/cron.test.ts`, `localTriage.test.ts` | Scheduling helpers and local triage |

## Feature status

| Area | Status | Evidence / limitation |
| --- | --- | --- |
| Guest app, local tools, knowledge, saved items | PASS | Build, unit tests and existing flows; 23 articles, 28 tools |
| Provider Hub / model radar | PASS | Adapter tests and prior live OpenRouter verification |
| AI chat/analyze/script via user key | PASS (code/tests) | Live completion depends on the user's provider key |
| Platform AI entitlements and quotas | PARTIAL | Logic unit-tested; not exercised against live usage rows |
| News pipeline | PASS | 19 verified sources; parsing and partial-failure tests |
| Registration/login/refresh/logout | PARTIAL | Implemented, typechecked; no live Supabase project |
| Email verification/reset | PARTIAL | Query and fragment parsing tested; delivery requires Supabase SMTP/templates |
| RBAC enforcement | PARTIAL | Matrix unit-tested; endpoint checks not integration-tested with a live database |
| Private workspace CRUD | PARTIAL | Implemented with owner filters and RLS; no live database run |
| Admin center | PARTIAL | Implemented with permission gates; no live database run |
| Trials | PARTIAL | Pure logic tested; claim uniqueness needs the migration applied |
| Manual subscriptions | PARTIAL | API/audit logic implemented; no payment provider |
| Payments/checkout | BLOCKED | Intentionally not integrated; no fabricated transactions |
| Scheduled jobs | BLOCKED | None enabled; news is request-cached |
| Netlify deployment | BLOCKED | No site/CLI credentials in this environment |
| Live RLS verification | BLOCKED | Requires a Supabase project and applied migration |

## Security checks performed

- Searched the repository for committed provider keys, service-role keys and passwords;
  no live secrets found. `.env.example` contains empty placeholders only.
- Verified service-role usage is confined to `netlify/lib` and functions, not the client.
- Verified privileged endpoints call `requirePermission` after loading the database-backed
  account.
- Verified workspace queries include the authenticated user id.
- Verified suspended accounts receive no permissions or entitlements.
- Verified the client bundle contains no AI provider key.
- Checked `netlify.toml` security headers (CSP, HSTS, frame denial, no-store on APIs).

## Not verified (honest gaps)

1. No Supabase project was available, so signup, email delivery, verification, password
   reset, token refresh against the real service, RLS behavior and admin actions were not
   executed end-to-end.
2. No payment gateway exists, so no checkout, webhook, invoice or refund test is possible.
3. No Netlify deployment was performed; function routing and scheduled behavior are
   unverified in production.
4. AI completion was not re-run against a live provider key in this pass; adapter behavior
   is covered by tests and previous live verification.
5. Rate limiting is in-memory per function instance and was not load-tested.
6. No penetration test or accessibility audit was performed.

## Reproduce

```bash
npm install
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

To complete the blocked checks, apply `supabase/migrations/0001_nexora.sql`, configure the
environment variables from `.env.example`, deploy to Netlify, and run the auth/workspace/
admin flows with a test account.
