# NEXORA AI

NEXORA AI is an IT engineering workspace with AI-assisted troubleshooting, a local
tool suite, curated knowledge, live vendor news, model discovery, private case notes,
and an account platform (Supabase Auth, RBAC, trials and administration). The account
platform is required for all internal pages; public entry pages remain available.

Built by **Eng. Adnan Al Qadi / م. عدنان القاضي**.

- **Frontend:** React 19, TypeScript, Vite 8, Tailwind CSS 4
- **Backend:** Netlify Functions (flat files under `netlify/functions`)
- **Auth/database:** Supabase Auth + Postgres REST (no passwords stored in app tables)
- **AI:** OpenRouter by default, plus OpenAI-compatible providers and local Ollama
- **Tests:** Vitest

## Diagnostics additions

- **DDNS & Port Analyzer** (`/network-tools` → DDNS & Ports): detects the deployment-visible
  public IP, compares A/AAAA DDNS records, probes up to 12 TCP ports and produces a bilingual
  evidence-based report. It only probes the detected public address (CGNAT included), never
  arbitrary third-party hosts.
- **Printer Diagnostics** (`/network-tools` → Printer Diagnostics): probes IPP (631), raw
  printing (9100) and LPD (515) and reads IPP queue attributes. Private LAN probes work when
  the app runs locally; cloud deployments block them by default.
- **Local printer agent:** the UI generates a PowerShell script that inventories printers,
  queues and the spooler, with explicit opt-in to cancel jobs or restart the spooler. NEXORA
  never executes this script remotely.
- **Troubleshooting Knowledge Base** (`/kb`): local-first record of verified problems and
  fixes, with search, categories, tags, Markdown/JSON export and one-click handoff from the
  Troubleshooting Lab and diagnostic tools.

## Status

| Area | Status | Notes |
| --- | --- | --- |
| Public entry pages (`/login`, `/register`, `/about`, recovery/verification) | PASS | Internal pages redirect guests to sign-in |
| OpenRouter AI, model discovery, provider testing | PASS | Requires a signed-in account; a provider key is optional but still supported |
| News pipeline | PASS | 19 verified feeds, cached, partial-failure reporting |
| DDNS/port analyzer, printer diagnostics, local knowledge base | PASS | Requires a signed-in verified account; cloud LAN probes blocked by default |
| Auth, RBAC, trials, workspace, admin APIs | PARTIAL | Implemented, typechecked and unit-tested; no live Supabase project available to verify end-to-end |
| Email verification/recovery | PARTIAL | Requires Supabase email configuration and correct templates |
| Paid subscriptions | BLOCKED | No payment provider configured; admins can record manual plans only |
| Scheduled jobs/Netlify deployment | BLOCKED | No Netlify CLI/site credentials in this environment |

## Quick start

```bash
npm install
npm run dev          # Vite + in-process Netlify functions on /api/*
npm run typecheck
npm run lint
npm test
npm run build
```

`npm run dev` serves the handlers through `scripts/dev-api-plugin.ts`, so `/api/health`,
`/api/news`, `/api/ai/*`, `/api/net/*`, `/api/auth`, `/api/workspace` and `/api/admin` work
without the Netlify CLI. During `npm run dev`, `.env` values are loaded into
`process.env` for the functions only; they are not added to the browser bundle.
`npm run dev:netlify` is available for the real emulator.

All internal pages and tool APIs require a signed-in, email-verified account. Guests can
reach `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify`,
`/check-email` and `/about`. If Supabase is not configured, protected APIs fail closed with
a setup error instead of running anonymously.

## Configure AI

1. Open **Provider Hub** (`/providers`).
2. Pick OpenRouter (recommended), OpenAI, Anthropic, Gemini, Ollama or a custom
   OpenAI-compatible endpoint.
3. Paste the key, refresh the model catalog, then **Test connection**.

Server defaults live in `.env`; see [`docs/OPENROUTER_SETUP.md`](docs/OPENROUTER_SETUP.md).
Keys entered in the UI are sent per request to the app's own proxy (`x-tn-key`) and are
not persisted server-side.

## Enable accounts

1. Create a Supabase project.
2. Apply [`supabase/migrations/0001_nexora.sql`](supabase/migrations/0001_nexora.sql)
   and then [`0002_nexora_owner_admin_roles.sql`](supabase/migrations/0002_nexora_owner_admin_roles.sql)
   (SQL editor or `supabase db push`).
3. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `NEXORA_SITE_URL` and a random `NEXORA_HASH_PEPPER` (32+ bytes).
4. Optionally set `OWNER_EMAIL` (and/or `ADMIN_EMAIL`) to verified addresses you
   control. These variables do **not** grant a role during sign-in. Register and
   verify the account first, then run one explicit local promotion command:
   `npm run owner:promote` for the owner or `npm run admin:promote` for a platform
   administrator. The legacy `npm run super-admin:promote` remains available.
5. Configure Supabase Auth email templates so links reach the app:
   - Confirmation: `{{ .SiteURL }}/verify?token_hash={{ .TokenHash }}&type=signup`
   - Recovery: `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`
6. Add the site URL and redirect URLs in Supabase Auth settings.

There is no automatic administrator bootstrap. Promotion is an explicit,
audited, local command that refuses unverified addresses and never creates
accounts. Manual role changes are audited, only an owner may grant or revoke the
`owner` role, and the last active owner cannot be demoted, suspended or deleted.
See [`docs/NEXORA_AUTH_AND_RBAC.md`](docs/NEXORA_AUTH_AND_RBAC.md).

## Environment

Copy `.env.example` to `.env`. Key groups:

- `AI_*` — provider, model, fallback, vision, limits and allowlist.
- `SUPABASE_*` — project URL, anon key, service-role key (server only).
- `OWNER_EMAIL`, `ADMIN_EMAIL`, `NEXORA_TRIAL_DAYS`, `NEXORA_SITE_URL`,
  `NEXORA_HASH_PEPPER`, `NEXORA_MAINTENANCE_MODE`.
- `NEWS_FEEDS`, `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY`, `CONTENT_ADMIN_TOKEN`.
- `PRINTER_ALLOW_PRIVATE` / `PRINTER_ALLOW_PUBLIC` — opt-in network printer probing policy.
  Private probes are allowed automatically when the app runs locally; public probes are off
  by default.

Never commit real keys. The service-role key bypasses RLS and must stay server-side.

## Plans

- **Trial:** 30 days by default, 100 AI requests/day, 500 workspace records.
- **Premium:** 1,000 AI requests/day, 2,000 workspace records.
- **Standard:** knowledge, research, workspace and exports; no platform AI key.
- **Suspended:** no private workspace or AI access.

Users may connect their own provider key even when the platform key is not included in
their plan. Suspended accounts are always rejected. No payment is fabricated: manual
subscriptions are recorded with `provider='manual'` and an audit/billing event.

## Security highlights

- Passwords and sessions are handled by Supabase Auth; no password hashes are stored in
  application tables.
- Service-role keys, provider keys and tokens are never returned to the browser.
- Every privileged endpoint re-checks the database-backed role and permission.
- Workspace queries always filter by the authenticated user id; RLS provides
  defense-in-depth.
- Profile privilege fields are protected by a trigger; the last active owner or super
  administrator cannot be demoted, suspended or deleted.
- Audit records redact token/password/secret-like fields.
- Input size, timeouts, rate limits and provider-host allowlists are enforced.

## Documentation

- [`docs/NEXORA_ARCHITECTURE.md`](docs/NEXORA_ARCHITECTURE.md)
- [`docs/NEXORA_SECURITY.md`](docs/NEXORA_SECURITY.md)
- [`docs/NEXORA_AUTH_AND_RBAC.md`](docs/NEXORA_AUTH_AND_RBAC.md)
- [`docs/NEXORA_SUBSCRIPTIONS.md`](docs/NEXORA_SUBSCRIPTIONS.md)
- [`docs/NEXORA_CONTENT_PLAN.md`](docs/NEXORA_CONTENT_PLAN.md)
- [`docs/NEXORA_TEST_REPORT.md`](docs/NEXORA_TEST_REPORT.md)
- [`docs/OPENROUTER_SETUP.md`](docs/OPENROUTER_SETUP.md)
- [`docs/NEWS_SOURCES.md`](docs/NEWS_SOURCES.md)
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/TECHNEXUS_AUDIT.md`](docs/TECHNEXUS_AUDIT.md) and
  [`docs/TECHNEXUS_REPAIR_REPORT.md`](docs/TECHNEXUS_REPAIR_REPORT.md) — historical repair record
