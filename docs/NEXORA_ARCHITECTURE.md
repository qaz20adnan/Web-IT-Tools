# NEXORA Architecture

## Overview

NEXORA AI is a single-page React application backed by flat Netlify Functions.

1. **Public entry** — `/login`, `/register`, `/forgot-password`, `/reset-password`,
   `/verify`, `/check-email` and `/about` are reachable without a session.
2. **Account mode** — every internal page and tool API requires a signed-in,
   email-verified account. Supabase Auth, server-enforced RBAC, trials/subscriptions, a
   private workspace and an admin center build on that session.

The browser never talks to Supabase directly. All database and auth operations pass
through the app's own `/api` functions using the service-role key server-side.

```
Browser (React)
  ├─ /api/ai/*          → netlify/functions/ai-*.ts → provider adapter
  ├─ /api/news          → news.ts → verified RSS feeds (cached)
  ├─ /api/auth          → auth.ts → Supabase Auth REST + profiles
  ├─ /api/workspace     → workspace.ts → owner-scoped CRUD
  ├─ /api/admin         → admin.ts → permission-gated administration
  └─ /api/content, ...  → content/tools/news endpoints
```

## Frontend

- `src/App.tsx` — lazy routes. Auth pages, `/account`, `/workspace` and `/admin` are
  code-split. `/account`, `/workspace` and `/admin` use `ProtectedRoute`.
- `src/context/AuthContext.tsx` — session bootstrap, refresh scheduling, login/register/
  recovery/verification, profile/security actions, permission helper. Tokens are stored
  in `localStorage` under `nexora.auth.session.v1`.
- `src/services/api.ts` — typed fetch layer. A token provider attaches the access token
  to every request; AI credentials are still sent as `x-tn-*` headers.
- `src/services/authSession.ts` — session persistence and implicit-flow fragment parsing
  (`#access_token=...`) used after Supabase email links.
- `src/components/auth/` — shared auth layout, protected route, trial banner.
- `src/pages/` — login, register, forgot/reset password, verify, check email, account,
  workspace and admin.
- `src/i18n/en.ts` / `ar.ts` — key-identical dictionaries; Arabic drives RTL.
- `src/data/themes.ts` and `src/styles/index.css` — 11 themes including the ten named
  NEXORA themes plus the legacy Cyber Pulse variant.

## Backend

### Auth (`netlify/lib/auth.ts`, `netlify/functions/auth.ts`)

- Supabase Auth signup/login/refresh/logout/recover/resend/verify.
- Profile creation on first authenticated request. No role is granted automatically from
  `OWNER_EMAIL`/`ADMIN_EMAIL`; promotion is an explicit local command
  (`scripts/promote-admin.mjs`).
- Trial creation with a unique HMAC email claim.
- Entitlements resolved on the server from role, status, subscription and trial.
- Permission checks and audit writes.
- AI access/quota enforcement for signed-in users.

### Workspace (`netlify/functions/workspace.ts`)

Private cases, notes, conversations, messages and content feedback. Every query includes
`user_id=eq.<authenticated id>`. Item creation checks the plan's workspace limit. RLS
mirrors the same ownership rules.

### Admin (`netlify/functions/admin.ts`)

Overview metrics, user search, role/status changes, user deletion, audit list, feedback
resolution, platform settings and manual subscriptions. Each action checks a specific
permission; self-demotion/self-suspension/self-deletion is rejected, as is removing the
last active super administrator.

### AI (`netlify/lib/ai.ts`)

OpenRouter remains the default. The adapter validates keys, resolves base URLs, retries
without a configured fallback model when a model is unavailable, and maps provider errors.
Every AI request requires an authenticated, verified member. Requests are
permission-checked and usage-recorded; users may still supply their own provider key
instead of consuming the platform quota.

## Database

`supabase/migrations/0001_nexora.sql` creates:

- `profiles`, `trials`, `trial_claims`
- `subscription_plans`, `subscriptions`, `billing_events`
- `usage_events`
- `cases`, `notes`, `conversations`, `conversation_messages`
- `articles`, `content_revisions`, `news_sources`, `news_ingestion_logs`
- `content_feedback`, `audit_events`, `platform_settings`
- private `workspace` storage bucket

It also adds indexes, `updated_at` triggers, RLS policies, profile privilege protection
and a last-admin guard. `supabase/migrations/0002_nexora_owner_admin_roles.sql`
additively extends the role constraint with `owner`/`admin`, updates staff helpers, and
adds API-independent hierarchy and last-owner protections.

## Deployment

- Build: `npm run build` → `dist/`.
- Functions: flat files in `netlify/functions`; `netlify.toml` maps `/api/*`.
- Security headers (CSP, HSTS, frame denial, no-store for APIs) are in `netlify.toml`.
- No scheduled functions are enabled. News is refreshed on request with a 5-minute cache.

## Known limitations

- No live Supabase project was available, so auth/database flows are typechecked and
  unit-tested but not end-to-end verified.
- Email delivery depends on Supabase SMTP/template configuration.
- No payment gateway is integrated. Manual plans are administrative records only.
- Tokens in `localStorage` are readable by JavaScript; a strict CSP and dependency
  hygiene are required. Moving to httpOnly cookies would require a same-site cookie
  design and CSRF protection.
