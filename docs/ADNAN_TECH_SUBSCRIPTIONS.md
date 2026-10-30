# NEXORA Subscriptions and Entitlements

## Plans

| Plan | Daily platform AI | Workspace items | Features |
| --- | --- | --- | --- |
| Trial (default 30 days) | 100 | 500 | AI, vision, workspace, research, exports |
| Premium | 1,000 | 2,000 | AI, vision, workspace, research, exports |
| Standard | 0 (BYO key only) | 100 | Workspace, research, exports |
| Suspended | 0 | 0 | None |

Staff (`owner`, `admin`, `super_admin`, `content_manager`, `technical_editor`,
`support_specialist`) receive premium limits and the admin feature flag.

All entitlement decisions are computed server-side in `netlify/lib/trial.ts` and attached
to the account payload. The UI only renders the result.

## Trial lifecycle

1. On first successful registration, the server creates a `trials` row using
   `NEXORA_TRIAL_DAYS` (clamped to 1–365; invalid values fall back to 1).
2. A `trial_claims` row stores `HMAC-SHA256(lowercase email, NEXORA_HASH_PEPPER)` with a
   unique constraint, preventing repeated trials for the same email.
3. `computeTrial` reports total days, days/hours remaining, `expired` and `endingSoon`
   (three days or fewer).
4. Expired trials fall back to standard entitlements; no data is deleted.
5. Admins can inspect and adjust trials; the server never trusts client-provided dates.

`NEXORA_HASH_PEPPER` must be a stable 32+ byte random secret. Rotating it invalidates
duplicate-trial detection for existing claims.

## Subscriptions

- `subscription_plans` is seeded with trial/premium/standard definitions.
- `subscriptions` records plan, status, provider and current period.
- An active `active`/`trialing` subscription with a future period end resolves to premium.
- `billing_events` records administrative changes; no payment data is invented.
- Admins use `subscriptions.set` with `provider='manual'`. The action requires
  `subscriptions.manage`, writes an audit event and a billing event, and never claims a
  real payment was processed.
- No checkout, invoice, tax or card handling exists. Paid self-service subscriptions are
  **BLOCKED** until a payment provider is integrated.

## Quotas and usage

- AI calls that use the platform key are counted in `usage_events` after a successful
  provider response.
- The daily limit is evaluated with `quotaExceeded(usageToday, dailyAiLimit)`.
- Invalid or non-finite usage/limits fail closed (treated as exhausted).
- User-supplied keys (`x-tn-key`) are not subject to platform AI quotas, but the account
  must still be active/verified and have `ai.use`. Suspended users are always rejected.
- Workspace limits are checked on create; existing records remain readable if a plan
  later shrinks, but new records are blocked.

## Status transitions

| From | Action | Result |
| --- | --- | --- |
| trial | expiry | standard entitlements |
| trial/standard | manual premium subscription | premium entitlements |
| premium | cancel/expire | trial if still valid, otherwise standard |
| any | suspend | no entitlements or permissions |
| suspended | reactivate | role/plan resolved again from data |

## Administrative guidance

- Verify the target account and plan before applying a manual subscription.
- Record the reason in the audit context; never edit billing tables by hand.
- Do not describe a manual plan as a paid receipt.
- Re-check entitlements after any plan or status change; tokens remain valid but
  permissions are reloaded per request.

## Verification status

Entitlement, quota, trial-date and subscription-active logic are unit-tested. Live
subscription purchase, renewal, cancellation and payment webhooks are **BLOCKED** because
no payment gateway or live Supabase project is configured.
