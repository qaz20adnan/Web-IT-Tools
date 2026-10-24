# NEXORA Auth and RBAC

## Authentication

NEXORA uses Supabase Auth through a server-side REST proxy. The browser sends
credentials to `/api/auth`; the function calls Supabase and returns only the session
tokens and the application account. No password hash is stored in NEXORA tables.

### Flows

| Flow | Endpoint/action | Result |
| --- | --- | --- |
| Register | `POST /api/auth` `action=register` | Creates Supabase user + profile, starts trial if eligible |
| Login | `action=login` | Returns access/refresh tokens and account |
| Refresh | `action=refresh` | Rotates the session |
| Logout | `action=logout` | Revokes the Supabase session |
| Forgot password | `action=recover` | Sends a Supabase recovery email |
| Resend verification | `action=resend` | Resends the confirmation email |
| Verify email | `action=verify` | Verifies `token_hash` and returns a session |
| Update profile | `action=update-profile` | Name/company/avatar |
| Change password | `action=change-password` | Current password required |
| Delete account | `action=delete-account` | Requires explicit confirmation; cascades private data |
| Export data | `action=export` | JSON download of profile, cases, notes, conversations |

### Email links

Supabase can use either the token-hash query format or the implicit fragment format.

- Query: `/verify?token_hash=...&type=signup`
- Fragment: `/verify#access_token=...&refresh_token=...&type=signup`
- Recovery query: `/reset-password?token_hash=...&type=recovery`
- Recovery fragment: `/reset-password#access_token=...&refresh_token=...&type=recovery`

The client parses both. A fragment session is stored, the account is refreshed, and the
user continues to `/account` (confirmation) or the reset form (recovery). Recommended
templates:

```html
<!-- Confirm signup -->
<a href="{{ .SiteURL }}/verify?token_hash={{ .TokenHash }}&type=signup">Confirm email</a>

<!-- Reset password -->
<a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">Reset password</a>
```

Set `NEXORA_SITE_URL` to the deployed origin (for example `https://nexora-ai.netlify.app`)
and add it to Supabase **Authentication → URL Configuration**.

### Owner bootstrap

1. Set `NEXORA_OWNER_EMAIL` to a verified address you control.
2. Register that address normally.
3. On the first authenticated request the server checks:
   - the email matches exactly (case-insensitive),
   - the email is verified,
   - `platform_settings.owner_bootstrapped` is not already `true`.
4. Only then is the profile promoted to `super_admin` and the marker written.

No first-signup or arbitrary-account promotion exists. Removing the variable after
bootstrap does not demote the owner.

### Sessions

Tokens are stored under `nexora.auth.session.v1` and refreshed two minutes before expiry.
The token provider in `src/services/api.ts` attaches the access token to API requests.
Clearing storage signs the browser out; server-side logout revokes the refresh token.

## Roles

| Role | Scope |
| --- | --- |
| `super_admin` | Full platform administration |
| `content_manager` | Knowledge/news/content lifecycle, reports, feedback |
| `technical_editor` | Create/update/archive content; no delete or restore |
| `support_specialist` | Support cases, content read, reports |
| `premium_member` | Member features |
| `standard_member` | Member features; no platform-key AI |
| `trial_member` | Member features during trial |
| `suspended_member` | No permissions |

## Permission matrix

| Permission | super | content mgr | tech editor | support | members | suspended |
| --- | --- | --- | --- | --- | --- | --- |
| `users.read` | yes | no | no | no | no | no |
| `users.update` | yes | no | no | no | no | no |
| `users.suspend` | yes | no | no | no | no | no |
| `users.delete` | yes | no | no | no | no | no |
| `roles.assign` | yes | no | no | no | no | no |
| `content.read` | yes | yes | yes | yes | no | no |
| `content.create` | yes | yes | yes | no | no | no |
| `content.update` | yes | yes | yes | no | no | no |
| `content.archive` | yes | yes | yes | no | no | no |
| `content.restore` | yes | yes | no | no | no | no |
| `content.delete` | yes | yes | no | no | no | no |
| `news.manage` | yes | yes | no | no | no | no |
| `providers.manage` | yes | no | no | no | no | no |
| `settings.manage` | yes | no | no | no | no | no |
| `subscriptions.manage` | yes | no | no | no | no | no |
| `reports.read` | yes | yes | no | yes | no | no |
| `audit_logs.read` | yes | no | no | no | no | no |
| `workspace.read` | yes | yes | yes | yes | yes | no |
| `workspace.write` | yes | yes | yes | yes | yes | no |
| `ai.use` | yes | yes | yes | yes | yes | no |
| `research.read` | yes | yes | yes | yes | yes | no |
| `support.cases.read` | yes | no | no | yes | no | no |
| `support.cases.update` | yes | no | no | yes | no | no |

The matrix lives in `netlify/lib/rbac.ts` and is the single source of truth. The UI uses it
to hide controls, but every endpoint re-checks against the database-backed profile.

## Enforcement rules

- A suspended status overrides role permissions: the effective permission set is empty.
- Staff receive premium entitlements for AI/workspace, plus `admin: true`.
- `users.update` accepts a role only with `roles.assign` and a status only with
  `users.suspend`; an admin cannot change their own role or status.
- The last active `super_admin` cannot be demoted, suspended or deleted (API + trigger).
- Workspace rows are always scoped to the authenticated user, including nested message
  queries.
- Permission changes take effect on the next request because the profile is reloaded
  server-side; stale UI state cannot grant access.

## Account states

- `pending` — created but email not verified. Can sign in but cannot use AI with the
  platform key until verified.
- `active` — normal access.
- `suspended` — blocked from workspace, research and AI; admin endpoints reject.

## Testing status

RBAC unit tests cover role/permission lookup, suspension override, inherited-key safety
and assignable roles. Auth/session parsing tests cover stored sessions and fragment
tokens. Live Supabase signup, email delivery, verification and password reset remain
**BLOCKED** until a project is configured; see `docs/NEXORA_TEST_REPORT.md`.
