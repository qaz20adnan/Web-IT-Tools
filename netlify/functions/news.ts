import { createHash } from 'node:crypto'
import { XMLParser } from 'fast-xml-parser'
import { fetchText } from '../lib/fetch'
import { HttpError, json, requireMethod, wrap, type Handler } from '../lib/http'

interface FeedDefinition {
  name: string
  url: string
  /** Default category used when keyword classification does not decide. */
  category: string
}

/**
 * Feed URLs verified to return a valid RSS/Atom document at implementation time
 * (see docs/NEWS_SOURCES.md). The ingestion pipeline tolerates individual source
 * failures and reports them, so a feed being removed upstream never breaks the
 * whole page.
 */
const DEFAULT_FEEDS: FeedDefinition[] = [
  { name: 'Microsoft Security Blog', url: 'https://www.microsoft.com/en-us/security/blog/feed/', category: 'security' },
  { name: 'Microsoft Security Response Center', url: 'https://api.msrc.microsoft.com/update-guide/rss', category: 'security' },
  { name: 'CISA Advisories', url: 'https://www.cisa.gov/cybersecurity-advisories/all.xml', category: 'security' },
  { name: 'Ubuntu Security Notices', url: 'https://ubuntu.com/security/notices/rss.xml', category: 'security' },
  { name: 'Red Hat Security', url: 'https://www.redhat.com/en/rss/blog/channel/security', category: 'security' },
  { name: 'AWS Security Blog', url: 'https://aws.amazon.com/blogs/security/feed/', category: 'security' },
  { name: 'Cisco Talos', url: 'https://blog.talosintelligence.com/rss/', category: 'security' },
  { name: 'The Hacker News', url: 'https://feeds.feedburner.com/TheHackersNews', category: 'security' },
  { name: 'BleepingComputer', url: 'https://www.bleepingcomputer.com/feed/', category: 'security' },
  { name: 'Azure Updates', url: 'https://www.microsoft.com/releasecommunications/api/v2/azure/rss', category: 'cloud' },
  { name: 'Windows Server Tech Community', url: 'https://techcommunity.microsoft.com/t5/s/gxcuf89792/rss/board?board.id=WindowsServer', category: 'windows-server' },
  { name: 'Google Cloud Blog', url: 'https://cloudblog.withgoogle.com/rss/', category: 'cloud' },
  { name: 'AWS What\'s New', url: 'https://aws.amazon.com/about-aws/whats-new/recent/feed/', category: 'cloud' },
  { name: 'Docker Blog', url: 'https://www.docker.com/blog/feed/', category: 'cloud' },
  { name: 'Kubernetes Blog', url: 'https://kubernetes.io/feed.xml', category: 'cloud' },
  { name: 'Cloudflare Blog', url: 'https://blog.cloudflare.com/rss/', category: 'networking' },
  { name: 'GitHub Blog', url: 'https://github.blog/feed/', category: 'industry' },
  { name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', category: 'ai-models' },
  { name: 'Google AI Blog', url: 'https://blog.google/technology/ai/rss/', category: 'ai' },
]

export const NEWS_CATEGORIES = ['security', 'networking', 'windows-server', 'cloud', 'backup-dr', 'ai', 'ai-models', 'microsoft', 'industry'] as const

interface NewsItem {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string | null
  summary?: string
  category: string
  critical?: boolean
  fetchedAt: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  processEntities: true,
})

function textOf(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return textOf(value[0])
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (record['#text'] !== undefined) return textOf(record['#text'])
    if (record['@_href'] !== undefined) return String(record['@_href'])
  }
  return ''
}

function clean(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function categoryFor(title: string, rawCategory: string, fallback: string): string {
  const value = `${title} ${rawCategory}`.toLowerCase()
  if (/(cve-\d|vulnerab|ransom|exploit|zero[- ]day|malware|phish|breach|threat|patch tuesday)/.test(value)) return 'security'
  if (/(model release|new model|open-?weights|gpt-|claude |gemini |llama|mistral|qwen|deepseek|grok)/.test(value)) return 'ai-models'
  if (/(\bai\b|llm|artificial intelligence|machine learning|inference|agent)/.test(value)) return 'ai'
  if (/(backup|restore|disaster recovery|replication|snapshot|immutab)/.test(value)) return 'backup-dr'
  if (/(windows server|active directory|group policy|hyper-?v|windows 11|windows 10)/.test(value)) return 'windows-server'
  if (/(microsoft 365|exchange online|sharepoint|teams|entra|defender|outlook)/.test(value)) return 'microsoft'
  if (/(aws|google cloud|gcp|azure|kubernetes|docker|serverless|terraform|devops)/.test(value)) return 'cloud'
  if (/(cisco|network|dns|bgp|vpn|firewall|wifi|routing|tls)/.test(value)) return 'networking'
  return fallback
}

function isCritical(title: string, summary: string): boolean {
  const value = `${title} ${summary}`
  if (/cve-\d{4}-\d{4,}/i.test(value)) return true
  if (/zero[- ]day|actively exploited|emergency(?:ly)? (?:patch|update)|remote code execution/i.test(value)) return true
  return /\bcritical\b/i.test(title) && /(vulnerab|patch|update|flaw|security|exploit)/i.test(value)
}

export function parseFeed(xml: string, feed: FeedDefinition, fetchedAt: string): NewsItem[] {
  const document = parser.parse(xml) as Record<string, unknown>
  const rss = document.rss as Record<string, unknown> | undefined
  const channel = rss?.channel as Record<string, unknown> | undefined
  const rawItems = channel?.item ? (Array.isArray(channel.item) ? channel.item : [channel.item]) : []
  const atom = document.feed as Record<string, unknown> | undefined
  const atomEntries = atom?.entry ? (Array.isArray(atom.entry) ? atom.entry : [atom.entry]) : []
  const entries = rawItems.length > 0 ? rawItems : atomEntries

  return entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const title = clean(textOf(record.title))
    const rawLink = record.link
    let url = ''
    if (typeof rawLink === 'string') url = rawLink
    else if (Array.isArray(rawLink)) {
      const alternate = rawLink.find((link) => {
        const recordLink = link as Record<string, unknown>
        return recordLink['@_rel'] === 'alternate' || !recordLink['@_rel']
      })
      url = textOf(alternate ?? rawLink[0])
    } else if (rawLink && typeof rawLink === 'object') {
      url = textOf(rawLink)
    }
    if (!url && typeof record.guid === 'string' && record.guid.startsWith('http')) url = record.guid
    if (!title || !/^https?:\/\//i.test(url)) return []
    const summary = clean(textOf(record.description ?? record.summary ?? record.content)).slice(0, 480)
    const rawDate = textOf(record.pubDate ?? record.published ?? record.updated ?? record.date)
    const parsedDate = rawDate ? new Date(rawDate) : null
    const category = categoryFor(title, clean(textOf(record.category)), feed.category)
    const id = createHash('sha1').update(url).digest('hex').slice(0, 16)
    return [{
      id: `news-${id}`,
      title,
      url,
      source: feed.name,
      publishedAt: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      ...(summary ? { summary } : {}),
      category,
      critical: isCritical(title, summary),
      fetchedAt,
    }]
  })
}

interface NewsCache {
  items: NewsItem[]
  fetchedAt: string
  sources: string[]
  errors: string[]
  expires: number
  stale: boolean
}

/** Feed failures arrive as free-form transport text; only the status code is worth showing. */
function describeFeedFailure(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : ''
  const status = message.match(/HTTP (\d{3})/)?.[1]
  if (status) return `returned HTTP ${status}`
  if (/timeout|timed out|abort/i.test(message)) return 'timed out'
  return 'could not be reached'
}

let cache: NewsCache | null = null

async function loadFeeds(force: boolean): Promise<NewsCache> {
  if (!force && cache && cache.expires > Date.now()) return cache
  const custom = (process.env.NEWS_FEEDS ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((url, index) => ({ name: `Custom feed ${index + 1}`, url, category: 'industry' }))
  const feeds = custom.length > 0 ? custom : DEFAULT_FEEDS
  const fetchedAt = new Date().toISOString()

  const settled = await Promise.allSettled(
    feeds.map(async (feed) => {
      const response = await fetchText(feed.url, {
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
        timeoutMs: 15000,
        maxBytes: 8 * 1024 * 1024,
      })
      if (!response.ok) throw new Error(`${feed.name}: HTTP ${response.status}`)
      return parseFeed(response.text, feed, fetchedAt)
    }),
  )

  const items: NewsItem[] = []
  const sources: string[] = []
  const errors: string[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      sources.push(feeds[index].name)
      items.push(...result.value)
    } else {
      errors.push(`${feeds[index].name} ${describeFeedFailure(result.reason)}`)
    }
  })

  const seen = new Set<string>()
  const deduped = items
    .filter((item) => {
      if (seen.has(item.url)) return false
      seen.add(item.url)
      return true
    })
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, 120)

  if (deduped.length === 0) {
    // A failed refresh must not erase what the reader already saw; serve the last
    // good list and label it honestly instead of returning an empty page.
    if (cache) return { ...cache, expires: Date.now() + 60_000, stale: true }
    throw new HttpError(502, 'upstream_error', 'All news feeds failed to load.', errors.slice(0, 3).join(' | '))
  }

  cache = {
    items: deduped,
    fetchedAt,
    sources,
    errors,
    expires: Date.now() + 5 * 60 * 1000,
    stale: false,
  }
  return cache
}

export const handler: Handler = wrap(async (event) => {
  requireMethod(event, ['GET'])
  const force = event.queryStringParameters?.refresh === '1'
  const result = await loadFeeds(force)
  return json(200, {
    items: result.items,
    fetchedAt: result.fetchedAt,
    stale: result.stale,
    sources: result.sources,
    ...(result.errors.length ? { errors: result.errors } : {}),
  })
})
