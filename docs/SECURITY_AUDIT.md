# SECURITY AUDIT — Adnan Tech

Date 2026-10-31. Source audit plus live probes against the running site. Supersedes
`docs/ADNAN_TECH_SECURITY.md` where they disagree; that file remains useful as the design doc.
Severity vocabulary matches `docs/PROJECT_AUDIT.md` (§3), and finding IDs are shared.

## Threat model

A publicly reachable SPA where authenticated users run network diagnostics, store private
incident notes, and drive third-party AI providers with either the platform's key or their own.
The two things worth stealing are account sessions and other users' workspace records; the two
things worth abusing are the AI proxy (someone else's quota) and the network probes (turning the
platform into a scanner for hosts the caller does not own).

## 1. Injection and execution

| Vector | Verdict | Evidence |
| --- | --- | --- |
| Command injection | **N/A by construction** — no `child_process`, no `dgram`, no raw socket anywhere in `netlify/`. Probes are `net.connect`/`tls.connect`/HTTPS fetch, never a shell | grep across `netlify/` |
| SQL injection | Structurally impossible in the app path: queries are PostgREST query strings with every interpolated value run through `encodeURIComponent`, and all table access goes through the typed helpers in `netlify/lib/supabase.ts` | `netlify/lib/auth.ts:143-215`, `netlify/functions/workspace.ts:121,247-249` |
| XSS | `script-src 'self'` with no `unsafe-eval`, served live. No `dangerouslySetInnerHTML` in `src/`. Residual risk is the Markdown renderer used for AI answers — worth an explicit check before any rich rendering of model output | `netlify.toml:128`, `vercel.json:33`, live header on `/` |
| SSRF | The core control is `assertPublicHost` + connect-time recheck against loopback/RFC1918/link-local, and cloud metadata `169.254.169.254` stays blocked even when `NET_PROBE_ALLOW_PRIVATE=true` (`netlify/lib/net-probe.ts:67,128,166-219`). Custom provider base URLs are restricted to `AI_ALLOWED_HOSTS` (`netlify/lib/host.ts:94-113`). **One gap**: `net-tls.ts:22-24` validates a hostname and then reconnects by name → DNS-rebinding TOCTOU (M-3). **One sharp edge**: `NET_PROBE_ALLOW_PRIVATE=true` also enables loopback, so never set it on a hosted runtime (M-5/F-05 of the DevOps pass) |
| Path traversal | No filesystem writes from user input; the only file sink is `.local-auth/store.json` under an env-chosen directory (`netlify/lib/local-auth.ts`) |
| Prototype pollution via catalog parsing | `fast-xml-parser` with explicit options; feed items are re-validated before being returned | `netlify/functions/news.ts` |

## 2. Authentication and session

Correct:
- Passwords never touch an application table — Supabase Auth owns them, and the app only ever
  holds bearer tokens server-side (`netlify/lib/supabase.ts:authRequest`).
- Sessions are `Authorization: Bearer` only; ambient cookies are never trusted
  (`netlify/lib/auth.ts:117-121`), so CSRF is genuinely not applicable today.
- `assertActive()` blocks sign-in for `suspended`/`pending`, and a suspended account is rejected
  even when it brings its own provider key (`netlify/lib/auth.ts:475-491`).
- Brute force: register/login/recover/resend are rate-limited and keyed by IP plus an
  email-hash (`netlify/lib/auth.ts:223,339`); password length 8–128 enforced on the server
  (`local-auth.ts:LOCAL_PASSWORD_MAX_LENGTH` for the dev path).
- Open redirect closed by `safeRedirect()` and by using env `authSiteUrl` for email links
  (`src/lib/redirect.ts:7-16`, `netlify/functions/auth.ts:365,383`).

Findings:

| ID | Sev | Issue | Fix |
| --- | --- | --- | --- |
| H-2 | HIGH | Access **and refresh** tokens in `localStorage` (`src/services/authSession.ts:3,7,23`) — one XSS = durable takeover; the README already concedes this | httpOnly `SameSite=Lax` cookie + `/api/auth` refresh, which then *does* require CSRF protection. Large change — schedule deliberately, do not half-do it |
| M-4 | MEDIUM | Verification/recovery hands tokens through the URL fragment (implicit flow) before persisting them (`src/services/authSession.ts:48-63`, `VerifyEmailPage.tsx:31-33`, `ResetPasswordPage.tsx:27-29`) | PKCE `?code=` exchange; the app already clears the hash after reading |
| M-1 | MEDIUM | Weak/absent `NEXORA_HASH_PEPPER` makes trial-claim HMACs predictable (`netlify/lib/auth.ts:113`) | fail closed in production |
| F-3 | MEDIUM | Rate limiting is per-warm-instance in memory and keyed on spoofable `x-forwarded-for[0]` (`netlify/lib/rate.ts:9`, `vercel/serverless.ts:56-59`) | trust the platform's verified client IP, or move to a shared store; until then, never present quotas as hard |
| M-11 | MEDIUM | `CONTENT_ADMIN_TOKEN` is one static shared bearer with no rate limit and no user binding (`netlify/functions/content-admin.ts:28-41`) | rotate, scope per operator, rate limit |
| S-1 | INFO | `emailHash` normalizes case/trim before HMAC — correct; no enumeration oracle found in the register/recover responses (they return generic copy) | keep |

## 3. Authorization (RBAC)

Verified correct, and this is the strongest part of the platform:

- Every privileged handler re-derives the identity from the bearer token and then checks a named
  permission server-side: `authenticate` → `requireVerified` → `requirePermission`
  (`netlify/lib/auth.ts:289-311,315-343`).
- Gate map (no privileged handler is ungated): `auth` per action; `admin` and `workspace` →
  `authenticate` + permission; `ai/chat|analyze|script` → `enforceAiAccess`;
  `ai/models|test` → `requireMember`; all `net/*` and `research` → `requireMember` + per-IP rate;
  `content`, `health`, `news` public read-only; `content/admin` static token.
- A user cannot change their own role: writes only `full_name`
  (`netlify/functions/auth.ts:429-444`), signup forces `standard_member`
  (`netlify/lib/auth.ts:174`), and a DB trigger rejects non-admin role/status changes
  (`supabase/migrations/0001_nexora.sql:82-109`, `0002`, `0003`).
- Env `OWNER_EMAIL`/`ADMIN_EMAIL` never elevate at login — boolean flags only
  (`netlify/lib/auth.ts:380-381`); promotion is an explicit audited local command with
  `--confirm` that refuses unverified addresses (`scripts/promote-admin.mjs`).
- Last-owner / last-super-admin protection exists in the API **and** in a trigger
  (`netlify/functions/admin.ts:435-454`; `0002:126-142`, `0003:81-97`).
- Tenancy: every workspace query filters `user_id=eq.<authenticated id>` and RLS mirrors it —
  **no IDOR found** (`netlify/functions/workspace.ts:121,247-249`, `0001:398-410`).
- The owner's three roles map cleanly onto what already exists: Owner → `owner`, Admin →
  `admin`, User → `premium_member`/`standard_member`/`trial_member`. No new role work is needed;
  the remaining question is whether `super_admin` (legacy) should be retired.

Findings here are about *missing re-checks*, not broken ones:

| ID | Sev | Issue | Fix |
| --- | --- | --- | --- |
| M-6 | MEDIUM | `ai/models`, `ai/test`, `research` gate on `workspace.read` instead of `ai.use`/`research.read`, and never record usage | gate correctly + `recordUsage` |
| M-5 | MEDIUM | `verifyProviderAuth()` treats `custom`/OpenAI-compatible catalogs as authenticated, so a garbage key can "pass" (`netlify/lib/ai.ts:422-427`) | probe an authenticated completion |

## 4. Secrets handling

Verified: no `VITE_*`/`NEXT_PUBLIC_*` exists anywhere; `serverConfig` is never imported by client
code; provider keys live in memory or (opt-in) `sessionStorage` scoped
`nexora.key.<user>.<id>` (`src/context/ProvidersContext.tsx:8,53,66-69`); `usage_events` has no
key column; audit writes strip `pass|token|secret|key|authorization|credential|session` keys and
truncate strings (`netlify/lib/auth.ts:402-418`); `[nexora]` logs print path, method, code and an
authored message — never a body, header or query string (`netlify/lib/http.ts:121-123`).

| ID | Sev | Issue | Fix |
| --- | --- | --- | --- |
| M-7 | MEDIUM | `netlify/lib/ai.ts:178` forwards raw upstream error text (≤300–500 chars) into `error.detail` and hence the browser; a provider that echoes the submitted prompt, an image fragment or a key leaks. `netlify/lib/gemini.ts:278` already does this right with `redact()` | redact `config.apiKey` + strip echo in `postJson` |
| S-2 | INFO | `.local-auth/store.json` holds scrypt hashes and session tokens in a git-ignored file; correct for dev, but a shared machine can read it | keep git-ignored (done: `.gitignore:8`), warn in docs |

## 5. Headers, transport, platform

| Check | Netlify live | Vercel config | Note |
| --- | --- | --- | --- |
| CSP | served | identical string (`vercel.json:33`) | `style-src 'unsafe-inline'` is required by the runtime-appearance/inline-style approach; `script-src` has no `unsafe-inline`/`unsafe-eval` — do not weaken further |
| HSTS | `max-age=31536000; includeSubDomains; preload` | set | good |
| X-Frame-Options / frame-ancestors | `DENY` / `'none'` | same | good |
| Referrer-Policy, X-Content-Type-Options, Permissions-Policy, COOP | present | present | good |
| `/api/*` `Cache-Control: no-store` | configured | configured | HTML on NETLIVE comes back `public,max-age=0,must-revalidate` — acceptable, but revisit after auth changes |
| M-13 | preview console error: `script-src 'self'` + `connect-src 'self' https:` (no `wss:`) blocks the Vercel Toolbar (`vercel.live`, `wss://ws-us3.pusher.com`) | — | **cosmetic only** — the app has no websocket client, no external fonts, no Worker. Fix with a preview-scoped header (`has`/`missing` condition) or `Content-Security-Policy-Report-Only` on previews. Do **not** add `vercel.live` to the production CSP |
| Vercel SSO protection | n/a | on: anonymous preview = 302 to `vercel.com/sso-api` | correct default; verification through an authenticated CLI instead of disabling it |

## 6. Dependency and supply chain

- `npm audit --omit=dev` → **0 vulnerabilities** (LOCAL, Node 24.22, 2026-10-31).
- `npm ls --depth=0` clean, 29 top-level packages, no `UNMET`/`invalid`.
- All nine production dependencies are actually imported (`clsx` 1 file, `tailwind-merge` 1,
  `yaml` 4, `lucide-react` 56, `react-router-dom` 40, `fast-xml-parser` 1, `zod` 6).
- Lockfile pins what `package.json` leaves as `^`; only `typescript` uses `~`. Acceptable for an
  app; keep `npm ci` (already the Vercel install command).
- M-12: Node 22 (Netlify build) vs 24 (Vercel + local) vs `engines >=20.19` vs esbuild target
  `node22` — one drift away from a runtime-specific bug (`X509Certificate` options are the
  realistic one). **Fixed locally (2026-10-31) on 22.x, not 24 as first recommended**: Netlify is
  the host that actually serves traffic, its build already declares 22, and the bundle is compiled
  for `node22`, so moving the working host was the larger risk. `engines.node`, `.nvmrc`,
  `netlify.toml` and the esbuild target now name one major and `tests/runtime-pin.test.ts` fails if
  they disagree. Flipping the canonical version later is a four-line change the test will police.

## 7. Data protection

| Item | Verdict |
| --- | --- |
| Passwords | never in app tables; Supabase Auth owns them |
| Private workspace | RLS + service-role queries filtered by owner; `workspace` storage bucket is private (`0001`) |
| Audit redaction | present and key-based (`netlify/lib/auth.ts:402-418`) |
| Usage events | stores user id, provider, model, token counts, cost — no prompt text |
| **H-7** | **FAIL**: `signOut()` leaves every account-scoped `localStorage` record behind (`src/context/AuthContext.tsx:213-222`), and `nexora.net.ip.v1` + `certdecode.prefs` are not account-scoped at all (`DdnsPortAnalyzer.tsx:126`, `CertDecodeTool.tsx:35`) — on a shared browser, the next user inherits the previous user's diagnostic history |
| M-9 | Settings export/clear uses a hand-written key list that omits five real stores → a user who "clears everything" leaves data behind |
| Input caps | request size, `maxBytes` per response, timeouts, and a provider-host allowlist all exist (`netlify/lib/fetch.ts:20-37`, `netlify/lib/http.ts:93-98`) |

## 8. Honest-status failures (a security-adjacent trust issue)

| ID | Issue |
| --- | --- |
| H-1 | Analysis mode renders model-asserted URLs as citations without fetching them (`ai-analyze.ts:32-34` → `TroubleshootingLabPage.tsx:579-592`). For a platform whose promise is "evidence-based", an invented Microsoft Learn link is worse than no link |
| M-8 | `/api/health` returns `news.configured: true` **hardcoded** (`netlify/functions/health.ts:33`) — an operator dashboard reading a fabricated flag makes fabricated decisions |
| I-2 | `docs/ADNAN_TECH_TEST_REPORT.md` claimed `typecheck PASS` while the build was broken — stale status is how a broken deploy slips through |

## 9. What needs a live credential before it can be called verified

- Actual RLS behaviour and the `0003` service-role trigger path (needs `SUPABASE_*` or D7).
- Email verification/recovery round trip and the Supabase redirect allowlist.
- Whether `NEXORA_HASH_PEPPER` is set on NETLIVE (not observable through the API).
- Real multi-instance rate-limit behaviour and XFF spoofing.
- SSRF/rebinding proof against a live egress target.
- Any AI provider round trip (no key configured on any host).
