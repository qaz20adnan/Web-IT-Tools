import { afterEach, describe, expect, it } from 'vitest'
import type { NetlifyEvent } from '../netlify/lib/http'

const event = { httpMethod: 'GET', headers: {}, body: '', path: '/api/health' } as NetlifyEvent

afterEach(() => {
  delete process.env.NEWS_FEEDS
  delete process.env.GEMINI_API_KEY
  delete process.env.GEMINI_WEB_SEARCH_ENABLED
  delete process.env.TAVILY_API_KEY
  delete process.env.BRAVE_SEARCH_API_KEY
})

describe('news feed selection', () => {
  it('uses the built-in list when NEWS_FEEDS is unset', async () => {
    const { feedDefinitions } = await import('../netlify/functions/news')
    expect(feedDefinitions().length).toBeGreaterThan(3)
  })

  it('replaces the built-in list only with valid custom URLs', async () => {
    process.env.NEWS_FEEDS = 'https://example.com/feed.xml, not-a-url, ftp://nope'
    const { feedDefinitions } = await import('../netlify/functions/news')
    expect(feedDefinitions().map((feed) => feed.url)).toEqual(['https://example.com/feed.xml'])
  })

  it('keeps the built-in list when every custom entry is invalid, and says so', async () => {
    process.env.NEWS_FEEDS = 'garbage'
    const { feedDefinitions, invalidFeedCount } = await import('../netlify/functions/news')
    expect(feedDefinitions().length).toBeGreaterThan(3)
    expect(invalidFeedCount()).toBe(1)
  })
})

describe('/api/health reports what is actually configured', () => {
  it('counts the feeds it will read and surfaces invalid custom entries', async () => {
    process.env.NEWS_FEEDS = 'garbage, https://ok.example.com/feed.xml'
    const { handler } = await import('../netlify/functions/health')
    const body = JSON.parse((await handler(event, {} as never)).body ?? '{}')
    expect(body.services.news).toMatchObject({ configured: true, sources: 1, invalidCustomFeeds: 1 })
  })

  it('treats Gemini grounding as a research provider', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    const { handler } = await import('../netlify/functions/health')
    const body = JSON.parse((await handler(event, {} as never)).body ?? '{}')
    expect(body.services.research.configured).toBe(true)
    expect(body.services.research.grounded.configured).toBe(true)
    expect(body.services.research.providers).toEqual([])
  })

  it('reports research as unconfigured when no provider exists', async () => {
    const { handler } = await import('../netlify/functions/health')
    const body = JSON.parse((await handler(event, {} as never)).body ?? '{}')
    expect(body.services.research.configured).toBe(false)
    expect(body.services.news.configured).toBe(true)
  })
})
