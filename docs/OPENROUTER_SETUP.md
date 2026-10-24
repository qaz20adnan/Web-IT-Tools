# OpenRouter setup

## 1. Create a key

1. Sign in at <https://openrouter.ai/>.
2. Open **Keys** and create a key.
3. Add credits or use a free-tier model if available.

Keys look like `sk-or-v1-...`. They are secrets: never commit one and never put one
in a `VITE_*` variable (those are embedded in the browser bundle).

## 2. Choose one configuration path

### A. Server default (recommended for a shared deployment)

Copy `.env.example` to `.env` locally (or set these in Netlify → Site configuration →
Environment variables):

```bash
AI_PROVIDER=openrouter
AI_BASE_URL=https://openrouter.ai/api/v1
AI_MODEL=openai/gpt-4.1-mini
AI_API_KEY=sk-or-v1-...
AI_FALLBACK_MODEL=openai/gpt-4.1-mini
```

Restart the dev server after editing `.env`.

### B. Per-browser key (Provider Hub)

1. Go to `/providers`.
2. Select **OpenRouter**.
3. Keep the base URL `https://openrouter.ai/api/v1`.
4. Paste the key, press **Refresh models**, choose a model, then **Test connection**.
5. Optionally choose a **Chat test** to verify a real completion.

The key is sent only to this app's `/api/ai/*` proxy in the `x-tn-key` header. It is
not added to the bundle and the server does not log it. Clearing the provider removes
the stored key.

## 3. Base URL rules

Use the API base, not an endpoint:

| Correct | Wrong (double path → 404) |
| --- | --- |
| `https://openrouter.ai/api/v1` | `https://openrouter.ai/api/v1/models` |
| | `https://openrouter.ai/api/v1/chat/completions` |

The app normalizes pasted endpoint URLs, but the base URL is the supported form.

## 4. Model IDs

Use the exact catalog ID, for example `openai/gpt-4.1-mini`,
`anthropic/claude-sonnet-4.5`, `google/gemini-2.0-flash-001`. **Refresh models** lists
available IDs, context length, modalities, supported parameters and pricing.

The catalog (`GET /api/v1/models`) is public: it loads even before a key is entered.
That is why the connection test uses the authenticated `GET /api/v1/key` endpoint to
validate credentials instead of relying on the catalog.

## 5. Error reference

| Status | App code | Meaning | What to do |
| --- | --- | --- | --- |
| 400 | `invalid_input` | Malformed request / unsupported parameter | Check model and payload |
| 401 | `invalid_key` | Missing, revoked or invalid key | Re-paste the key |
| 402 | `insufficient_credits` | Account out of credits | Add credits |
| 403 | `forbidden` | Key lacks access to model/region | Try another model or check account settings |
| 404 | `not_found` | Wrong path or unknown model | Fix base URL / model ID |
| 408 | `timeout` | Provider timed out | Retry |
| 422 | `invalid_input` | Model cannot process the input (e.g. image to text-only) | Change model or input |
| 429 | `rate_limited` | Too many requests | Wait and retry (automatic retry is limited) |
| 5xx | `upstream_error` | Provider-side failure | Retry later |

## 6. Notes

- `AI_FALLBACK_MODEL` is used automatically only when the primary model is reported
  missing/unsupported. Auth, credit and rate-limit failures are never retried on a
  different model.
- Attribution headers can be customized with `AI_APP_REFERER` and `AI_APP_TITLE`.
- Host validation: only built-in provider hosts and hosts listed in
  `AI_ALLOWED_HOSTS` are allowed. Private/reserved addresses are blocked.
