import { createHash } from 'node:crypto'
import { fetchText } from '../lib/fetch'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, researchRequestSchema } from '../lib/schema'

const OFFICIAL_DOMAINS = [
  'microsoft.com',
  'learn.microsoft.com',
  'support.microsoft.com',
  'docs.microsoft.com',
  'azure.microsoft.com',
  'aws.amazon.com',
  'docs.aws.amazon.com',
  'cloud.google.com',
  'developers.google.com',
  'cisco.com',
  'docs.redhat.com',
  'access.redhat.com',
  'ubuntu.com',
  'documentation.ubuntu.com',
  'broadcom.com',
  'techdocs.broadcom.com',
  'pve.proxmox.com',
  'kubernetes.io',
  'nist.gov',
  'nvd.nist.gov',
  'cisa.gov',
  'msrc.microsoft.com',
]

interface ResearchItem {
  id: string
  title: string
  url: string
  source: string
  sourceType: 'official' | 'community' | 'informal'
  snippet: string
  publishedAt: string | null
  retrievedAt: string
}

function classify(url: string): ResearchItem['sourceType'] {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return 'informal'
  }
  if (OFFICIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return 'official'
  if (['github.com', 'stackoverflow.com', 'serverfault.com', 'superuser.com', 'learn.microsoft.com'].some((domain) => host === domain || host.endsWith(`.${domain}`))) return 'community'
  return 'informal'
}

function itemId(url: string): string {
  return `research-${createHash('sha1').update(url).digest('hex').slice(0, 12)}`
}

async function tavily(query: string, officialOnly: boolean): Promise<ResearchItem[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return []
  const response = await fetchText('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      max_results: 10,
      include_answer: false,
      ...(officialOnly ? { include_domains: OFFICIAL_DOMAINS.slice(0, 20) } : {}),
    }),
    timeoutMs: 20000,
    maxBytes: 3 * 1024 * 1024,
  })
  if (!response.ok) throw new HttpError(502, 'upstream_error', `Tavily returned HTTP ${response.status}.`)
  const data = JSON.parse(response.text) as { results?: Array<Record<string, unknown>> }
  const retrievedAt = new Date().toISOString()
  return (data.results ?? []).flatMap((entry) => {
    const url = typeof entry.url === 'string' ? entry.url : ''
    if (!url) return []
    return [{
      id: itemId(url),
      title: String(entry.title ?? url),
      url,
      source: new URL(url).hostname.replace(/^www\./, ''),
      sourceType: classify(url),
      snippet: String(entry.content ?? '').slice(0, 500),
      publishedAt: typeof entry.published_date === 'string' ? entry.published_date : null,
      retrievedAt,
    }]
  })
}

async function brave(query: string, officialOnly: boolean): Promise<ResearchItem[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY
  if (!key) return []
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&safesearch=moderate`
  const response = await fetchText(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': key },
    timeoutMs: 20000,
    maxBytes: 3 * 1024 * 1024,
  })
  if (!response.ok) throw new HttpError(502, 'upstream_error', `Brave Search returned HTTP ${response.status}.`)
  const data = JSON.parse(response.text) as { web?: { results?: Array<Record<string, unknown>> } }
  const retrievedAt = new Date().toISOString()
  return (data.web?.results ?? []).flatMap((entry) => {
    const link = typeof entry.url === 'string' ? entry.url : ''
    if (!link) return []
    const sourceType = classify(link)
    if (officialOnly && sourceType !== 'official') return []
    return [{
      id: itemId(link),
      title: String(entry.title ?? link),
      url: link,
      source: String((entry.profile as Record<string, unknown> | undefined)?.name ?? new URL(link).hostname.replace(/^www\./, '')),
      sourceType,
      snippet: String(entry.description ?? '').slice(0, 500),
      publishedAt: typeof entry.page_age === 'string' ? entry.page_age : null,
      retrievedAt,
    }]
  })
}

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['POST'])
  enforceRateLimit(`research:${clientIp(event, context)}`, 15)
  const parsed = researchRequestSchema.safeParse(readJsonBody(event, 32 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const { query, officialOnly } = parsed.data

  const providers: string[] = []
  if (process.env.TAVILY_API_KEY) providers.push('Tavily')
  if (process.env.BRAVE_SEARCH_API_KEY) providers.push('Brave Search')
  if (providers.length === 0) {
    return json(200, {
      results: [],
      providers: [],
      note: 'No research provider is configured. Use the official search links below, or set TAVILY_API_KEY / BRAVE_SEARCH_API_KEY.',
    })
  }

  const settled = await Promise.allSettled([tavily(query, officialOnly), brave(query, officialOnly)])
  const merged = new Map<string, ResearchItem>()
  const errors: string[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      for (const item of result.value) {
        if (officialOnly && item.sourceType !== 'official') continue
        if (!merged.has(item.url)) merged.set(item.url, item)
      }
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : 'A research provider failed.')
    }
  }
  const results = [...merged.values()].sort((a, b) => (a.sourceType === 'official' ? -1 : 1) - (b.sourceType === 'official' ? -1 : 1)).slice(0, 20)
  if (results.length === 0 && errors.length === settled.length) {
    throw new HttpError(502, 'upstream_error', 'All research providers failed.', errors.join(' | '))
  }
  return json(200, {
    results,
    providers,
    ...(errors.length ? { note: `Some providers failed: ${errors.join(' | ')}` } : {}),
  })
})
