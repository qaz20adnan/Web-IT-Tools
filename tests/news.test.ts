import { describe, expect, it } from 'vitest'
import { categoryFor, parseFeed } from '../netlify/functions/news'

const feed = { name: 'Test Feed', url: 'https://example.com/feed.xml', category: 'industry' }
const fetchedAt = '2026-01-02T03:04:05.000Z'

describe('categoryFor', () => {
  it('classifies security advisories and CVE identifiers', () => {
    expect(categoryFor('CVE-2026-1234 affects Exchange Server', '', 'industry')).toBe('security')
    expect(categoryFor('Ransomware gang exploits zero-day', '', 'industry')).toBe('security')
  })

  it('classifies model releases before generic AI', () => {
    expect(categoryFor('OpenAI releases a new model family', '', 'ai')).toBe('ai-models')
    expect(categoryFor('Claude gets better at reasoning', '', 'industry')).toBe('ai-models')
  })

  it('classifies infrastructure topics', () => {
    expect(categoryFor('Windows Server 2025 update guide', '', 'industry')).toBe('windows-server')
    expect(categoryFor('Kubernetes 1.34 released', '', 'industry')).toBe('cloud')
    expect(categoryFor('BGP hijack disrupts routing', '', 'industry')).toBe('networking')
    expect(categoryFor('Immutable backup strategy for disaster recovery', '', 'industry')).toBe('backup-dr')
  })

  it('falls back to the feed category when nothing matches', () => {
    expect(categoryFor('A completely neutral headline', '', 'windows-server')).toBe('windows-server')
  })
})

describe('parseFeed', () => {
  it('parses RSS items with dates, summaries and critical flags', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel><title>Test</title>
        <item>
          <title><![CDATA[Critical: CVE-2026-9999 remote code execution]]></title>
          <link>https://example.com/advisory-1?utm=1</link>
          <description><![CDATA[<p>Patch now.</p>]]></description>
          <pubDate>Wed, 01 Jan 2026 10:00:00 GMT</pubDate>
          <category>Security</category>
        </item>
        <item>
          <title>Routine release notes</title>
          <link>https://example.com/release-2</link>
          <description>Nothing urgent.</description>
          <pubDate>not-a-date</pubDate>
        </item>
      </channel></rss>`
    const items = parseFeed(xml, feed, fetchedAt)
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      title: 'Critical: CVE-2026-9999 remote code execution',
      url: 'https://example.com/advisory-1?utm=1',
      source: 'Test Feed',
      summary: 'Patch now.',
      category: 'security',
      critical: true,
      publishedAt: '2026-01-01T10:00:00.000Z',
      fetchedAt,
    })
    expect(items[0].id).toMatch(/^news-[0-9a-f]{16}$/)
    expect(items[1]).toMatchObject({ publishedAt: null, critical: false })
  })

  it('parses Atom entries and prefers the alternate link', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom feed</title>
        <entry>
          <title>Kubernetes patch release</title>
          <link rel="alternate" href="https://example.com/atom-1"/>
          <summary>Maintenance release.</summary>
          <updated>2026-01-01T12:00:00Z</updated>
        </entry>
      </feed>`
    const items = parseFeed(xml, feed, fetchedAt)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: 'Kubernetes patch release',
      url: 'https://example.com/atom-1',
      publishedAt: '2026-01-01T12:00:00.000Z',
      category: 'cloud',
    })
  })

  it('drops entries without an http(s) link instead of surfacing unsafe URLs', () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0"><channel>
        <item><title>Pasted script</title><link>javascript:alert(1)</link></item>
        <item><title>No link at all</title></item>
        <item><title>Valid</title><link>https://example.com/ok</link></item>
      </channel></rss>`
    const items = parseFeed(xml, feed, fetchedAt)
    expect(items.map((item) => item.url)).toEqual(['https://example.com/ok'])
  })

  it('returns an empty list for a document with no entries', () => {
    expect(parseFeed('<?xml version="1.0"?><rss version="2.0"><channel/></rss>', feed, fetchedAt)).toEqual([])
  })
})
