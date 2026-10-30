# Gemini live web research setup

The **Web Research** assistant mode in the Technical Copilot answers with live
Google Search grounding. It runs entirely inside the Netlify Function
`/api/ai/chat`; the browser never sees the key, the model name is chosen on the
server, and no page content is ever executed.

## 1. Create a server-side key

1. Open Google AI Studio and create an API key for the project you want billed.
2. Check which models that project can actually call. Grounding needs a model
   that supports the `google_search` tool.
3. Keep **billing disabled**. The free tier covers a bounded amount of research;
   this platform never enables billing and never switches models on its own.

The key is a secret. Never commit it, and never expose it through a
`VITE_`/`NEXT_PUBLIC_` variable — those are inlined into the browser bundle.

## 2. Local configuration

```bash
cp .env.example .env       # .env and .env.* are git-ignored
```

Then set:

```bash
GEMINI_API_KEY=your-key-here
GEMINI_MODEL=gemini-flash-latest
GEMINI_WEB_SEARCH_ENABLED=true
```

`npm run dev` loads `.env` through the Vite dev server, and the API plugin runs
the Netlify Functions in the same process, so the Copilot picks the setting up on
the next request. Restart `npm run dev` after editing `.env`.

On Netlify, add the same three variables in **Site configuration → Environment
variables** and redeploy.

### Falling back to an existing Gemini provider

If `AI_PROVIDER=gemini` is already configured, `GEMINI_API_KEY` and
`GEMINI_MODEL` are optional: the research path reuses `AI_API_KEY` / `AI_MODEL`
and the built-in `generativelanguage.googleapis.com` endpoint. Nothing is
duplicated and no second secret is required.

## 3. Variable reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | falls back to `AI_API_KEY` when `AI_PROVIDER=gemini` | Server-side credential sent only in the `x-goog-api-key` header. |
| `GEMINI_MODEL` | `gemini-flash-latest`, or `AI_MODEL` for a Gemini provider | Model used for grounded answers. |
| `GEMINI_WEB_SEARCH_ENABLED` | `false` | Master switch. While false, Web Research answers `503 not_configured` and everything else keeps working. |
| `GEMINI_BASE_URL` | Google's versioned root | Only change this for a proxy. The host must already be permitted by `AI_ALLOWED_HOSTS`. |
| `GEMINI_TIMEOUT_MS` | `45000` | Hard deadline; exceeding it returns `timeout`, never a fabricated answer. |
| `GEMINI_MAX_OUTPUT_TOKENS` | `3000` | Output cap, additionally clamped to 8192. |
| `GEMINI_CACHE_TTL_SECONDS` | `0` (off) | Opt-in reuse of identical answers inside one warm function instance. Never persisted. |

## 4. How grounding works

The request goes to `POST https://generativelanguage.googleapis.com/v1beta/interactions`:

```json
{
  "model": "gemini-flash-latest",
  "system_instruction": "…technical triage rules…",
  "input": [{ "role": "user", "parts": [{ "text": "…" }] }],
  "tools": [{ "type": "google_search" }],
  "generation_config": { "max_output_tokens": 3000, "temperature": 0.3 },
  "store": false
}
```

`store: false` means the conversation is replayed statelessly and Google retains
nothing on the server side.

The response `steps[]` are read for:

- `google_search_call` → the queries the model actually ran,
- `google_search_result` → whether the search errored,
- `model_output` → the answer text plus its `url_citation` annotations.

Only URLs present in those annotations are shown as sources. A URL that appears
in the prose but not in the API response is dropped, so the source list can never
be fabricated. `usage.grounding_tool_count` is reported back to the UI as the
number of search requests consumed.

## 5. Assistant modes

| Mode | Behaviour |
| --- | --- |
| **AI Chat** | The configured provider answers. No search is spent. |
| **Web Research** | Always routes through Gemini grounding. If Gemini is not configured this returns `503 not_configured` and says so — it never falls back to a cached or invented "search result". |
| **Auto search** | Searches only when the question looks freshness-sensitive (CVEs, updates, "latest", error codes). Falls back to normal chat when Gemini is not configured. |

## 6. Quota and cost behaviour

- Google prices search grounding per executed query: the documented free
  allowance is 5,000 search requests per month shared across Gemini 3 and newer
  models, then $14 per 1,000 requests. Verify the current numbers on
  <https://ai.google.dev/gemini-api/docs/pricing> before relying on them.
- The platform never enables billing, never upgrades a model, and never retries a
  quota (`429`) failure.
- A second limiter of 6 research requests per minute per IP sits in front of it.
- When the free allowance is gone, the Copilot keeps working in AI Chat mode and
  every other tool on the platform is unaffected.

## 7. What is deliberately not done

- The assistant never executes commands against the user's servers. It proposes
  them, explains privileges and risks, and gives a rollback path.
- Retrieved web content is treated as data. The system instruction rejects any
  instruction embedded in a page, and no fetched HTML or script is ever rendered
  or run.
- Source links open in a new tab with `rel="noopener noreferrer nofollow ugc"`.
- No search text, answer, key or user identifier is written to logs.
