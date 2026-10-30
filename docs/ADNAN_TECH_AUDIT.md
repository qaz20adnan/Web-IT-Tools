# TechNexus AI â€” Audit

Scope: the existing repository at `D:\Adnan-Web`. This is a repair audit, not a
rewrite. Findings were confirmed against the code and, where possible, the running
app.

## 1. AI endpoints returned 404 (critical)

**Symptom:** `/api/ai/models` and `/api/ai/test` returned `404` in both local dev and
in the expected Netlify layout.

**Root causes (two independent issues):**

1. **Nested function layout.** Handlers lived under `netlify/functions/ai/` and
   `netlify/functions/net/`. Netlify does not expose nested directories as nested
   endpoint paths, so `/.netlify/functions/ai/models` did not exist. The redirect
   wildcard `/api/* â†’ /.netlify/functions/:splat` therefore resolved to a
   non-existent function.
2. **No dev backend.** Plain `vite` has no serverless runtime, so every `POST /api/*`
   request fell through to the SPA handler and returned 404, even with a correct
   Netlify layout.

**Fix:** flattened handlers to `ai-models.ts`, `ai-test.ts`, `ai-chat.ts`,
`ai-analyze.ts`, `ai-script.ts`, `net-dns.ts`, `net-tls.ts`; added explicit
`netlify.toml` redirects (specific routes before the wildcard); added a Vite
middleware plugin that loads the same handlers in-process for `npm run dev`.

**Evidence:** `/api/health` 200, `/api/news` 200 with real items, `/api/ai/models`
and `POST /api/ai/test` now return structured `400 not_configured` instead of 404
when no key is present.

## 2. Model discovery was unreliable (high)

- The client assembled provider URLs itself while the server did too, so a pasted
  base URL such as `https://openrouter.ai/api/v1/models` produced
  `/v1/models/models` â†’ upstream 404.
- The connectivity test listed models to "verify" a key. The OpenRouter catalog is
  **public**, so an invalid key could still appear to work.
- Gemini's preset base URL was `https://generativelanguage.googleapis.com/v1beta/openai`,
  but the native adapter calls `models/{id}:generateContent`, which lives under
  `/v1beta`. The preset was wrong for the adapter in use.

**Fix:** `normalizeBaseUrl()` strips endpoint suffixes (including Gemini
`.../models/<id>:generateContent`); endpoints are assembled once in
`PROVIDER_ENDPOINTS`; catalog responses are enriched with modalities, supported
parameters, context and formatted pricing; OpenRouter auth is verified against the
authenticated `GET /api/v1/key` endpoint instead of the public catalog.

**Live verification (no key required):** `GET /api/ai/models` returned 468 models
with capabilities and pricing. Invalid key against OpenRouter â†’ `401 invalid_key`.
Missing key â†’ `400 not_configured`.

## 3. Error handling hid the real problem (medium)

Every upstream failure was reported as a generic upstream error. Status codes were
not distinguished, and raw upstream bodies could leak into responses.

**Fix:** `mapUpstreamStatus()` maps 400/401/402/403/404/408/422/429/5xx to distinct
`ApiErrorCode` values (`invalid_input`, `invalid_key`, `insufficient_credits`,
`forbidden`, `not_found`, `timeout`, `rate_limited`, `upstream_error`), and
`sanitizeUpstreamDetail()` caps and sanitizes detail text. Retries now apply only to
transient statuses.

## 4. News pipeline pointed at dead feeds (medium)

Several defaults no longer returned valid RSS (`microsoft.com/security/blog/feed`
404, Azure updates 503, NVD RSS 404, GitHub advisories Atom 406). The ingest also
used a 3 MB cap, which rejected CISA's advisory feed.

**Fix:** replaced defaults with a verified feed set, recorded a default category per
source, added keyword-based classification, raised the per-feed cap to 8 MB, and
exposed partial-source failures to the UI instead of failing silently.

**Verification:** `GET /api/news?refresh=1` returned 120 items from **19 of 19**
sources with zero errors.

## 5. UI / UX gaps (medium)

- Provider Hub had no model discovery, no capability display, no diagnostics and no
  way to distinguish a missing key from an invalid key.
- Tech Pulse had no source or date filters and no visibility into failed sources.
- The initial JS bundle was ~950 kB because every page was imported eagerly.

**Fix:** rebuilt Provider Hub (model catalog with search/capability filters,
fallback model, connectivity vs. chat tests, diagnostics), added source/date/severity
filters and error surfacing to Tech Pulse, and code-split all non-landing routes via
`React.lazy` + `Suspense` (main bundle ~466 kB).

## 6. Tests and documentation (medium)

Only 30 tests existed, none covering the provider adapter or news parsing, and there
was no README, deployment guide, or provider setup guide.

**Fix:** added `tests/ai-adapter.test.ts`, `tests/news.test.ts` and `tests/i18n.test.ts` (29 tests) plus the
`docs/` set. Current total: **59 tests passing**.

## Not verified in this environment

- Real provider completions: no valid API key was available. Adapter behavior is
  covered with mocked fetch tests; connectivity failures were verified against
  OpenRouter with an intentionally invalid key.
- Deployed Netlify routing: no Netlify CLI or site credentials. Local Vite routing
  and the `netlify.toml` rules were reviewed, not deployed.
- Scheduled functions: not executable locally.

