# News sources

Tech Pulse ingests third-party RSS/Atom feeds on the server. The list below was
verified by fetching each feed through `GET /api/news?refresh=1` during the repair:
**19 of 19 sources responded and the endpoint returned 120 items with zero errors.**

Feeds are fetched in parallel with a 15 s timeout and an 8 MB per-feed cap. A source
failure never breaks the page: successful sources are still shown and failures appear
in `errors[]` (visible in the UI with a retry button). Results are cached server-side
for 5 minutes; `?refresh=1` bypasses the cache.

| Source | Feed URL | Default category |
| --- | --- | --- |
| Microsoft Security Blog | `https://www.microsoft.com/en-us/security/blog/feed/` | security |
| Microsoft Security Response Center | `https://api.msrc.microsoft.com/update-guide/rss` | security |
| CISA Advisories | `https://www.cisa.gov/cybersecurity-advisories/all.xml` | security |
| Ubuntu Security Notices | `https://ubuntu.com/security/notices/rss.xml` | security |
| Red Hat Security | `https://www.redhat.com/en/rss/blog/channel/security` | security |
| AWS Security Blog | `https://aws.amazon.com/blogs/security/feed/` | security |
| Cisco Talos | `https://blog.talosintelligence.com/rss/` | security |
| The Hacker News | `https://feeds.feedburner.com/TheHackersNews` | security |
| BleepingComputer | `https://www.bleepingcomputer.com/feed/` | security |
| Azure Updates | `https://www.microsoft.com/releasecommunications/api/v2/azure/rss` | cloud |
| Windows Server Tech Community | `https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=WindowsServer` | windows-server |
| Google Cloud Blog | `https://cloudblog.withgoogle.com/rss/` | cloud |
| AWS What's New | `https://aws.amazon.com/about-aws/whats-new/recent/feed/` | cloud |
| Docker Blog | `https://www.docker.com/blog/feed/` | cloud |
| Kubernetes Blog | `https://kubernetes.io/feed.xml` | cloud |
| Cloudflare Blog | `https://blog.cloudflare.com/rss/` | networking |
| GitHub Blog | `https://github.blog/feed/` | industry |
| OpenAI News | `https://openai.com/news/rss.xml` | ai-models |
| Google AI Blog | `https://blog.google/technology/ai/rss/` | ai |

## Removed feeds

These were in the previous defaults but no longer return usable feeds:

| Feed URL | Observed result |
| --- | --- |
| `https://www.microsoft.com/security/blog/feed/` | 404 (replaced by the `/en-us/` URL) |
| `https://azure.microsoft.com/en-us/updates/feed/` | 503 (replaced by the release-communications RSS) |
| `https://nvd.nist.gov/feeds/xml/cve/misc/nvd-rss.xml` | 404 |
| `https://github.com/advisories.atom` | 406 |

## Categories

`security`, `networking`, `windows-server`, `cloud`, `backup-dr`, `ai`, `ai-models`,
`microsoft`, `industry`.

Each feed declares a default category. Headlines are then re-classified by keyword in
this order: security/CVE → model release → AI → backup/DR → Windows Server → Microsoft
365 → cloud/DevOps → networking → feed default.

In the UI, categories are translated (`news.category.*` in `src/i18n/en.ts` and
`src/i18n/ar.ts`). Unknown categories fall back to their raw identifier rather than
showing a missing-key placeholder.

## Custom feeds

Set `NEWS_FEEDS` to a comma-separated list to **replace** the defaults:

```bash
NEWS_FEEDS=https://example.com/security.xml,https://example.com/cloud.xml
```

Custom feeds use the `industry` default category and are still keyword-classified.

## Adding a source

1. Confirm the URL returns XML (not HTML) and is not paywalled.
2. Add it to `DEFAULT_FEEDS` in `netlify/functions/news.ts` with a default category.
3. If the feed is large, confirm it fits under the 8 MB cap.
4. Run `npm test` (news parsing) and refresh `/api/news?refresh=1`.
5. Update the table above.
