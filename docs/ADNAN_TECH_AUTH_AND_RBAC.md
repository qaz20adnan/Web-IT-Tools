# Adnan Tech Auth and RBAC

## Authentication

Adnan Tech uses Supabase Auth through a server-side REST proxy. The browser sends
credentials to `/api/auth`; the function calls Supabase and returns only the session
tokens and the application account. No password hash is stored in Adnan Tech tables.

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

### Owner and administrator promotion

There is **no automatic promotion** based on an email address. `OWNER_EMAIL` and
`ADMIN_EMAIL` are only inputs for an explicit local command; signing in never changes a
role.

1. Optionally set `OWNER_EMAIL` (owner) and/or `ADMIN_EMAIL` (platform administrator) to
   verified addresses you control.
2. Register that address normally and verify it (email verification must be enabled).
3. Sign in once so the profile row exists.
4. Run one deliberate command with the service-role key:

```bash
npm run owner:promote         # role=owner, uses OWNER_EMAIL
npm run admin:promote         # role=admin, uses ADMIN_EMAIL
npm run super-admin:promote   # legacy role=super_admin, uses ADMIN_EMAIL
# or: node --env-file=.env scripts/promote-admin.mjs --role=owner --confirm
```

The command refuses unverified addresses, never creates accounts, writes an audit event,
and is safe to re-run. There is no public bootstrap endpoint and no default administrator
password. Removing the variables after promotion does not demote the account.

Only an active `owner` may grant or revoke the `owner` role. A platform `admin` cannot
modify an owner, super administrator or another admin, and cannot grant administrative
roles. The database trigger repeats these hierarchy checks for direct REST access, and the
last active owner cannot be demoted, suspended or deleted.

### Account status and sessions

- Tokens are stored under `nexora.auth.session.v1` and refreshed two minutes before expiry.
- The token provider in `src/services/api.ts` attaches the access token to API requests.
- Every protected request reloads the profile from the database. `suspended` and
  `pending` accounts are rejected even when an old access token is still valid; login and
  token refresh are rejected too.
- Clearing storage signs the browser out; server-side logout revokes the session.
- Changing a role or suspending an account takes effect on the next request without
  waiting for the token to expire.
- Private browser data (saved items, history, scripts, knowledge base, diagnostics,
  English-coach conversations and provider keys) is namespaced per account; switching
  accounts remounts those stores.

## Roles

| Role | Scope |
| --- | --- |
| `owner` | Highest authority; every permission and exclusive control of the `owner` role |
| `admin` | Platform administration: users, content (no permanent delete), settings, subscriptions, reports, audit, support |
| `super_admin` | Legacy full-administration role retained for existing deployments |
| `content_manager` | Knowledge/news/content lifecycle, reports, feedback |
| `technical_editor` | Create/update/archive content; no delete or restore |
| `support_specialist` | Support cases, content read, reports |
| `premium_member` | Member features |
| `standard_member` | Member features; no platform-key AI |
| `trial_member` | Member features during trial |
| `suspended_member` | No permissions |

## Permission matrix

| Permission | owner | admin | super | content mgr | tech editor | support | members | suspended |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `users.read` | yes | yes | yes | no | no | no | no | no |
| `users.update` | yes | yes | yes | no | no | no | no | no |
| `users.suspend` | yes | yes | yes | no | no | no | no | no |
| `users.delete` | yes | no | yes | no | no | no | no | no |
| `roles.assign` | yes | yes* | yes | no | no | no | no | no |
| `content.read` | yes | yes | yes | yes | yes | yes | no | no |
| `content.create` | yes | yes | yes | yes | yes | no | no | no |
| `content.update` | yes | yes | yes | yes | yes | no | no | no |
| `content.archive` | yes | yes | yes | yes | yes | no | no | no |
| `content.restore` | yes | yes | yes | yes | no | no | no | no |
| `content.delete` | yes | no | yes | yes | no | no | no | no |
| `news.manage` | yes | yes | yes | yes | no | no | no | no |
| `providers.manage` | yes | no | yes | no | no | no | no | no |
| `settings.manage` | yes | yes | yes | no | no | no | no | no |
| `subscriptions.manage` | yes | yes | yes | no | no | no | no | no |
| `reports.read` | yes | yes | yes | yes | no | yes | no | no |
| `audit_logs.read` | yes | yes | yes | no | no | no | no | no |
| `workspace.read` | yes | yes | yes | yes | yes | yes | yes | no |
| `workspace.write` | yes | yes | yes | yes | yes | yes | yes | no |
| `ai.use` | yes | yes | yes | yes | yes | yes | yes | no |
| `research.read` | yes | yes | yes | yes | yes | yes | yes | no |
| `support.cases.read` | yes | yes | yes | no | no | yes | no | no |
| `support.cases.update` | yes | yes | yes | no | no | yes | no | no |

\* An `admin` may assign only roles below `admin`; only an `owner` may grant or revoke
`owner`, and an `admin` cannot grant `admin`/`super_admin`.

The matrix lives in `netlify/lib/rbac.ts` and is the single source of truth. The hierarchy
(`ROLE_RANK`, `canManageRole`, `canAssignRole`) is enforced by the admin endpoint and by
the database trigger. The UI uses the same list to hide controls, but every endpoint
re-checks against the database-backed profile.

## Enforcement rules

- A suspended status overrides role permissions: the effective permission set is empty.
- Staff receive premium entitlements for AI/workspace, plus `admin: true`.
- `users.update` accepts a role only with `roles.assign` and a status only with
  `users.suspend`; an admin cannot change their own role or status, cannot modify an
  equal/higher role, and an `admin` can assign only lower roles.
- The last active `owner` cannot be demoted, suspended or deleted. The same protection
  remains for the legacy last active `super_admin` (API + trigger).
- Workspace rows are always scoped to the authenticated user, including nested message
  queries.
- Permission changes take effect on the next request because the profile is reloaded
  server-side; stale UI state cannot grant access.

## Route and API policy

| Area | Access |
| --- | --- |
| `/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify`, `/check-email`, `/about` | Public |
| Every other page (dashboard, tools, AI, knowledge, news, diagnostics, saved, settings, workspace, account) | Authenticated + verified |
| `/admin` | Requires `users.read` (owner, admin or legacy super administrator) |
| `/api/auth`, `/api/health`, `/api/content`, `/api/news`, public article reads | Public |
| `/api/ai/chat`, `/api/ai/analyze`, `/api/ai/script`, `/api/ai/test`, `/api/ai/models`, `/api/net/*`, `/api/research`, `/api/workspace` | Authenticated member; AI also enforces entitlement/quota |
| `/api/admin` | Each action checks its RBAC permission server-side |
| `/api/content/admin` | Requires `CONTENT_ADMIN_TOKEN` (server-to-server) |

The frontend guard is only a convenience. Every protected handler calls
`authenticate()`/`requireMember()` and re-checks the database-backed role, so calling a
protected API directly without a token returns `401`, and a suspended account returns
`403` even with an older token.

## Account states

- `pending` — activation not complete. Login and protected requests are rejected.
- `active` — normal access.
- `suspended` — login, token refresh and every protected request are rejected. Admins can
  reactivate the account; private data is retained.
- Deleting an account is a separate, explicit admin action that requires `users.delete`,
  cannot target the actor, cannot remove the last active administrator, and cascades only
  through the account's own Supabase rows.

## Testing status

Unit tests cover role/permission lookup, suspension override, inherited-key safety,
account-status gating, safe post-login redirects and per-user storage namespaces.
Auth/session parsing tests cover stored sessions and fragment tokens. Live Supabase
signup, email delivery, verification and password reset require a configured project; see
`docs/ADNAN_TECH_TEST_REPORT.md.
