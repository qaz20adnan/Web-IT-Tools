# TechNexus AI â€” Repair Report

Date: 2026-10-23

## Change summary

### Routing / serverless

- Flattened all handlers: `ai-models.ts`, `ai-test.ts`, `ai-chat.ts`,
  `ai-analyze.ts`, `ai-script.ts`, `net-dns.ts`, `net-tls.ts`. Removed the
  non-routable `netlify/functions/ai/` and `netlify/functions/net/` directories.
- `netlify.toml`: explicit `/api/...` redirects before the generic wildcard; added
  `/api/content/admin`, security headers and API `no-store`.
- `scripts/dev-api-plugin.ts`: Vite middleware that loads handlers with
  `server.ssrLoadModule`, accepts Netlify-style events and maps `/api/a/b` to
  `a-b.ts`. Registered in `vite.config.ts`.

### Provider adapter (`netlify/lib/ai.ts`)

- `PROVIDER_ENDPOINTS` table and `normalizeBaseUrl()` (strips `/chat/completions`,
  `/models`, `/api/tags`, `/messages`, `/completions`, and Gemini
  `.../models/<id>:generateContent`).
- `listModels()` normalizes OpenAI/OpenRouter, Anthropic, Gemini (`displayName`,
  `inputTokenLimit`) and Ollama shapes; adds pricing (`in $x/1M آ· out $y/1M`),
  input/output modalities and supported parameters.
- `withRetry()` retries transient failures only (2 attempts).
- `completeWithFallback()` retries once with `fallbackModel` only for
  `not_found | invalid_input | forbidden | upstream_error`.
- `verifyProviderAuth()`: OpenRouter â†’ authenticated `GET /key`, Ollama â†’
  `/api/tags`, others â†’ authenticated model listing.
- `resolveAiConfig({ allowAnonymous })` permits key-less catalog discovery for the
  public OpenRouter model list while completions still require a key.
- OpenRouter attribution headers (`HTTP-Referer`, `X-Title`, `X-OpenRouter-Title`)
  from `AI_APP_REFERER` / `AI_APP_TITLE`.

### Error semantics

- `netlify/lib/fetch.ts`: `mapUpstreamStatus()` distinguishes 400, 401, 402, 403,
  404, 408, 422, 429 and 5xx; `sanitizeUpstreamDetail()` truncates and sanitizes
  upstream text. `netlify/lib/http.ts` and `src/types/index.ts` gained the matching
  codes.

### News

- 19 verified feeds across security, cloud/DevOps, Windows Server, networking,
  AI and AI-model releases (`docs/NEWS_SOURCES.md`).
- Default category per feed plus keyword classification; critical detection now
  requires a CVE/exploit signal.
- Per-feed cap raised to 8 MB; partial failures returned in `errors[]` while
  successful items are still served; 120-item cap; 5-minute server cache.
- Tech Pulse UI: source filter, date range, severity toggle, category labels in both
  languages, source-health counter, retrieval timestamps, failed-source list with
  retry.

### Providers UI

- Rebuilt `ProviderHubPage`: provider cards with status dots and inline test;
  model discovery with refresh, search, capability filters, context and pricing;
  use-model / use-as-vision actions; fallback model field; separate connectivity and
  chat tests; diagnostic alerts; honest note about key storage.
- Gemini preset corrected to `https://generativelanguage.googleapis.com/v1beta`.
- Ollama preset is local HTTP and only works when `ALLOW_LOCAL_AI=true`.

### Radar / dashboard / performance

- AI Model Radar: live catalog query, capability badges, fetch timestamp, upstream
  detail in errors.
- Route-level code splitting with `React.lazy` + `Suspense`. Main bundle dropped from
  ~950 kB to ~466 kB; each page is its own chunk.

### Tests

- `tests/ai-adapter.test.ts` (17): base-URL normalization (including double-path
  prevention), OpenAI/Anthropic/Gemini URL construction and headers, catalog parsing
  and pricing, 401/404/429/non-JSON mapping, auth verification via `/key`, fallback
  behavior, anonymous config.
- `tests/news.test.ts` (8): RSS and Atom parsing, date/summary handling, category
  classification order, unsafe-link rejection, empty feeds.
- Total suite: **59 passing** (was 30).

## Verification performed

| Check | Command | Result |
| --- | --- | --- |
| Types | `npm run typecheck` | pass |
| Lint | `npm run lint` | 0 errors, 10 pre-existing Fast Refresh/exhaustive-deps warnings |
| Tests | `npm test` | 9 files, 59 tests passed |
| Build | `npm run build` | pass; largest initial chunk 466 kB |
| Health route | `GET /api/health` | 200 |
| News route | `GET /api/news?refresh=1` | 200, 120 items, 19/19 sources, 0 errors |
| Model catalog | `GET /api/ai/models` (openrouter, no key) | 200, 468 models, pricing/capabilities parsed |
| Invalid key | `POST /api/ai/test` connectivity | 401 `invalid_key` |
| Missing key | `POST /api/ai/test` connectivity | 400 `not_configured` |

## Known limitations

- No valid provider key was available, so a real completion was not executed.
- Netlify deployment/routing was not exercised (no CLI/site credentials).
- Scheduled functions (news refresh) cannot be run locally.
- Lint still reports React Fast Refresh warnings for context modules that export
  hooks alongside providers, and two `exhaustive-deps` warnings; these are
  pre-existing and non-breaking.

