# Adnan Tech Security

## Threat model

Primary risks: credential theft, privilege escalation, cross-user data access, secret
leakage, abusive AI usage, malicious provider URLs, and destructive admin mistakes.

## Controls

### Credentials and secrets

- Supabase Auth owns password storage. No password hashes exist in application tables.
- `SUPABASE_SERVICE_ROLE_KEY`, provider keys, `NEXORA_HASH_PEPPER` and SMTP credentials
  are server-only environment variables.
- Provider keys entered in the UI are sent per request (`x-tn-key`) to the app proxy and
  are not logged or persisted server-side.
- Audit writes redact keys matching `pass|token|secret|key|authorization|credential|session`.
- The client bundle contains no secrets; only the public app name and version.

### Authorization

- Every privileged endpoint authenticates the bearer token against Supabase Auth, reloads
  the profile, and re-checks permissions. UI hiding is not treated as authorization.
- Roles: `owner`, `admin`, `super_admin` (legacy), `content_manager`,
  `technical_editor`, `support_specialist`, `premium_member`, `standard_member`,
  `trial_member`, `suspended_member`.
- Suspended accounts receive no permissions and no entitlements, even with a valid token
  or a user-supplied provider key.
- Admin actions reject self-demotion, self-suspension and self-deletion.
- Only an `owner` may grant or revoke `owner`; an `admin` cannot modify an equal/higher
  role or grant administrative roles. The API and a database trigger both enforce this.
- The last active owner cannot be demoted, suspended or deleted. The same protection
  remains for the legacy last active super administrator (checked in the API and by a
  database trigger).

### Tenant isolation

- Workspace reads/writes always include `user_id=eq.<authenticated id>`.
- Conversation messages are additionally constrained by conversation ownership.
- RLS policies mirror these rules for direct database access with a user token.
- Profiles can be read/updated only by their owner (staff can read); privilege columns are
  protected by `protect_profile_privileges()`.
- Trial claims, subscriptions, usage and billing rows are service-role writes; users can
  read only their own rows.

### Input and transport

- Zod schemas validate every function body; unknown actions are rejected.
- Body limits: 256 KB auth/admin, 512 KB workspace, 2–8 MB AI.
- Request timeouts, provider-host allowlists and per-IP/per-email rate limits are applied.
- CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, restrictive `Permissions-Policy` and
  `Cache-Control: no-store` on APIs are set in `netlify.toml`.
- Upstream provider responses are sanitized before being returned.

### Auditability

`audit_events` records registration, profile/password changes, admin role/status changes,
user deletion, manual subscription changes, settings updates, workspace deletions and
feedback resolution. Failed audit writes do not block the main operation, but failures are
logged server-side.

## Residual risks

- Session tokens are stored in `localStorage`. Any XSS could exfiltrate them. Mitigations:
  strict CSP, no `dangerouslySetInnerHTML` for user data, dependency review, and a future
  migration to httpOnly same-site cookies with CSRF protection.
- Rate limiting is in-memory per function instance, not a global distributed limiter.
  Netlify may run multiple instances; add a shared store for strict production quotas.
- Email verification/recovery depends on Supabase template and SMTP correctness.
- No payment provider is connected. Manual plans must not be presented as paid receipts.
- No independent penetration test or live Supabase RLS verification has been performed.

## Operational checklist

- [ ] Rotate service-role and provider keys if they were ever exposed.
- [ ] Set `NEXORA_HASH_PEPPER` to 32+ random bytes and keep it stable.
- [ ] Configure Supabase redirect allowlist and email templates.
- [ ] Confirm Supabase email verification is enabled before the first sign-in.
- [ ] Register and verify the owner address, then run `npm run owner:promote`. There is
      no automatic promotion from `OWNER_EMAIL`/`ADMIN_EMAIL`.
- [ ] Use `npm run admin:promote` only for a deliberate platform administrator, and
      `npm run super-admin:promote` only when retaining the legacy role is required.
- [ ] Verify that guest requests to `/api/ai/*`, `/api/net/*` and `/api/research` return `401`.
- [ ] Review audit events after every administrative change.
- [ ] Back up the database before running migrations.
