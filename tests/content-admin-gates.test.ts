import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_BODY_BYTES } from '../shared/upload-limits'

/**
 * `/api/content/admin` is the only writer of the `articles` table and the one endpoint guarded by a
 * shared bearer token rather than a session (M-11). Until this file it had no test: whether a missing
 * `CONTENT_ADMIN_TOKEN` fails closed, whether a wrong-length token is refused by the guard that exists
 * precisely because `timingSafeEqual()` throws on a length mismatch, and whether the delete path can be
 * widened through its `id` parameter were all code-read claims.
 *
 * The whole Supabase client is left real — `authorize()`, `supabaseDelete()`'s encoding, `rest()`'s
 * header selection and both zod schemas all execute — and only `fetchText()` is stubbed, so nothing
 * reaches the network while every assertion reads the URL, method and headers the handler actually
 * asked for. That distinction matters here: which credential each path sends — all three now go out
 * with the service role, which is what closes H-11 — is only visible to a client-left-real test.
 * `serverConfig` is
 * mutated rather than mocked, so `supabaseAdminConfigured()` is production code reading
 * production-shaped fields.
 */

interface FetchCall {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

const mocks = vi.hoisted(() => ({
  fetchText: vi.fn(async (_url: string, _options?: unknown): Promise<unknown> => ({ status: 200, ok: true, headers: new Headers(), text: '[]' })),
}))

vi.mock('../netlify/lib/fetch', async (importActual) => {
  const actual = await importActual<typeof import('../netlify/lib/fetch')>()
  return { ...actual, fetchText: mocks.fetchText }
})

import { handler } from '../netlify/functions/content-admin'
import { serverConfig } from '../netlify/lib/env'
import type { NetlifyEvent, NetlifyResponse } from '../netlify/lib/http'

/** `serverConfig` is a mutable object literal, so the four fields the handler reads are snapshotted and restored. */
const ORIGINAL_CONFIG = { contentAdminToken: serverConfig.contentAdminToken, supabaseUrl: serverConfig.supabaseUrl, supabaseServiceRoleKey: serverConfig.supabaseServiceRoleKey, supabaseAnonKey: serverConfig.supabaseAnonKey }

const TOKEN = 'content-admin-token-32-chars-ABCD'
const ARTICLE_ID = 'kb-dns-1'
const SUPABASE_URL = 'https://project.supabase.co'
const SERVICE_KEY = 'service-role-key-never-in-a-browser'
const ANON_KEY = 'anon-key-safe-for-a-browser'

function article(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ARTICLE_ID,
    slug: 'dns-troubleshooting',
    title_en: 'DNS troubleshooting',
    title_ar: 'استكشاف مشاكل DNS',
    summary_en: 'A short English summary.',
    summary_ar: 'ملخص قصير بالعربية.',
    body_en: 'The article body.',
    body_ar: 'نص المقال.',
    domain: 'networking',
    ...overrides,
  }
}

interface EventOptions {
  method?: string
  body?: string | null
  authorization?: string | null
  items?: Record<string, unknown>[]
  queryStringParameters?: Record<string, string | null>
}

function event(options: EventOptions = {}): NetlifyEvent {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (options.authorization !== null) headers.authorization = options.authorization ?? `Bearer ${TOKEN}`
  const body = options.body !== undefined ? options.body : options.items ? JSON.stringify({ items: options.items }) : null
  return {
    httpMethod: options.method ?? 'POST',
    headers,
    body,
    path: '/api/content/admin',
    ...(options.queryStringParameters ? { queryStringParameters: options.queryStringParameters } : {}),
  }
}

function payload(response: NetlifyResponse): Record<string, unknown> {
  return JSON.parse(response.body ?? '{}') as Record<string, unknown>
}

function errorOf(response: NetlifyResponse): { code?: string; message?: string } {
  return (payload(response).error ?? {}) as { code?: string; message?: string }
}

/** Everything the handler asked the database for, in order. */
function calls(): FetchCall[] {
  return mocks.fetchText.mock.calls.map((call) => ({ url: String(call[0]), ...(call[1] as FetchCall | undefined) }))
}

function lastCall(): FetchCall {
  const call = calls().at(-1)
  if (!call) throw new Error('the handler reached no database call at all')
  return call
}

/** The rows a POST tried to write, read back out of the request body the client serialised. */
function upsertedRows(): Array<Record<string, unknown>> {
  const body = lastCall().body
  if (!body) return []
  return JSON.parse(body) as Array<Record<string, unknown>>
}

function filterOf(url: string): string {
  return url.split('?')[1] ?? ''
}

beforeEach(() => {
  // `wrap()` logs every rejection; silenced because the cleanup below un-stubs the variable.
  vi.stubEnv('LOG_LEVEL', 'silent')
  serverConfig.contentAdminToken = TOKEN
  serverConfig.supabaseUrl = SUPABASE_URL
  serverConfig.supabaseServiceRoleKey = SERVICE_KEY
  serverConfig.supabaseAnonKey = ANON_KEY
  mocks.fetchText.mockReset().mockImplementation(async () => ({ status: 200, ok: true, headers: new Headers(), text: '[]' }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  Object.assign(serverConfig, ORIGINAL_CONFIG)
})

describe('the method gate', () => {
  it.each(['PUT', 'PATCH', 'HEAD', 'OPTIONS'])('refuses %s before the token is ever compared', async (method) => {
    const response = await handler(event({ method, authorization: 'wrong-on-purpose', body: '{}' }), {})
    expect(response.statusCode).toBe(405)
    expect(errorOf(response).message).toBe(`Method ${method} is not allowed.`)
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it.each(['GET', 'POST', 'DELETE'])('routes %s', async (method) => {
    const options: EventOptions = { method }
    if (method === 'POST') options.items = [article()]
    if (method === 'DELETE') options.queryStringParameters = { id: ARTICLE_ID }
    const response = await handler(event(options), {})
    expect(response.statusCode).toBe(200)
  })
})

describe('the shared token gate fails closed', () => {
  it('refuses everything when CONTENT_ADMIN_TOKEN is unset, rather than allowing anonymous writes', async () => {
    serverConfig.contentAdminToken = ''
    const response = await handler(event({ items: [article()], authorization: `Bearer ${TOKEN}` }), {})
    expect(response.statusCode).toBe(503)
    expect(errorOf(response)).toMatchObject({ code: 'not_configured', message: 'CONTENT_ADMIN_TOKEN is not configured on the server.' })
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it('reports the same 503 on the read path, so an unconfigured host never publishes a partial catalog', async () => {
    serverConfig.contentAdminToken = ''
    const response = await handler(event({ method: 'GET' }), {})
    expect(response.statusCode).toBe(503)
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it('refuses a request with no Authorization header', async () => {
    const response = await handler(event({ items: [article()], authorization: null }), {})
    expect(response.statusCode).toBe(401)
    expect(errorOf(response)).toMatchObject({ code: 'invalid_key', message: 'Invalid content admin token.' })
  })

  it('refuses a wrong token of exactly the right length, which is the case timingSafeEqual exists for', async () => {
    const sameLength = 'X'.repeat(TOKEN.length)
    expect(sameLength).toHaveLength(TOKEN.length)
    const response = await handler(event({ items: [article()], authorization: `Bearer ${sameLength}` }), {})
    expect(response.statusCode).toBe(401)
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it.each([
    ['shorter', TOKEN.slice(0, TOKEN.length - 4)],
    ['longer', `${TOKEN}tail`],
    ['empty', ''],
    ['whitespace only', ' '],
    ['the real token with a trailing space', `${TOKEN} `],
  ])('refuses a %s token instead of throwing on the length mismatch', async (_label, supplied) => {
    const response = await handler(event({ items: [article()], authorization: `Bearer ${supplied}` }), {})
    expect(response.statusCode).toBe(401)
    expect(errorOf(response).code).toBe('invalid_key')
  })

  it('accepts the bare token and a lowercase scheme, because header parsing is not the security control', async () => {
    const bare = await handler(event({ method: 'GET', authorization: TOKEN }), {})
    const lower = await handler(event({ method: 'GET', authorization: `bearer ${TOKEN}` }), {})
    expect([bare.statusCode, lower.statusCode]).toEqual([200, 200])
  })

  it('refuses a token that only matches the configured one as a prefix', async () => {
    serverConfig.contentAdminToken = `${TOKEN}-longer`
    const response = await handler(event({ method: 'GET', authorization: `Bearer ${TOKEN}` }), {})
    expect(response.statusCode).toBe(401)
  })

  it('answers 503 when the token is right but Supabase is not configured, and never falls back to another store', async () => {
    serverConfig.supabaseServiceRoleKey = ''
    const response = await handler(event({ method: 'GET' }), {})
    expect(response.statusCode).toBe(503)
    expect(errorOf(response).message).toBe('Supabase service role credentials are not configured.')
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it('checks the token before reading the body, so an unauthenticated caller cannot trigger parsing', async () => {
    const response = await handler(event({ body: 'this is not json at all', authorization: 'Bearer nope' }), {})
    expect(response.statusCode).toBe(401)
    expect(errorOf(response).message).toBe('Invalid content admin token.')
  })
})

describe('the read and delete paths', () => {
  it('reads the 200 most recent articles and labels the source honestly', async () => {
    const response = await handler(event({ method: 'GET' }), {})
    expect(filterOf(lastCall().url)).toBe('select=*&order=updated_at.desc&limit=200')
    expect(lastCall().url).toBe(`${SUPABASE_URL}/rest/v1/articles?select=*&order=updated_at.desc&limit=200`)
    expect(payload(response)).toMatchObject({ source: 'supabase' })
  })

  it('needs only the service key, so a deployment with no anon key can still list its own drafts', async () => {
    // H-11 was the opposite shape: the read gated on url + anon key while the write gated on
    // url + service role, so a service-key-only deployment could save an article and then see an
    // empty list. Both paths gate on `supabaseAdminConfigured()` in `authorize()` now.
    serverConfig.supabaseAnonKey = ''
    const read = await handler(event({ method: 'GET' }), {})
    expect(read.statusCode).toBe(200)
    expect(payload(read)).toMatchObject({ source: 'supabase' })
    expect((await handler(event({ items: [article()] }), {})).statusCode).toBe(200)
    for (const call of calls()) expect(call.headers).not.toHaveProperty('apikey', '')
  })

  it('sends the service-role key on every path, including the read, and never the browser key', async () => {
    // This is the deliberate trade in the H-11 fix: the admin read bypasses RLS, so it can list what
    // it writes, and the price is that the service role now leaves the server on GET too.
    // The bearer must be tested exactly, not with `toMatch`: PostgREST answers a missing
    // `Authorization` with the anon key from its own config, which is the failure mode being closed.
    await handler(event({ method: 'GET' }), {})
    expect(lastCall().headers).toMatchObject({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })
    await handler(event({ items: [article()] }), {})
    expect(lastCall().headers).toMatchObject({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })
    await handler(event({ method: 'DELETE', queryStringParameters: { id: ARTICLE_ID } }), {})
    expect(lastCall().headers).toMatchObject({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })
    expect(calls().map((call) => call.method)).toEqual(['GET', 'POST', 'DELETE'])
    for (const call of calls()) expect(JSON.stringify(call.headers)).not.toContain(ANON_KEY)
    const rejected = await handler(event({ method: 'GET', authorization: 'Bearer wrong' }), {})
    expect(rejected.statusCode).toBe(401)
    expect(calls()).toHaveLength(3)
  })

  it('refuses a delete with no id rather than dropping the whole table', async () => {
    const noIds: Record<string, string | null>[] = [{}, { id: '' }, { id: '   ' }, { id: null }]
    for (const params of noIds) {
      const response = await handler(event({ method: 'DELETE', queryStringParameters: params }), {})
      expect(response.statusCode).toBe(400)
      expect(errorOf(response).message).toBe('A content id query parameter is required.')
    }
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it('deletes exactly one row, matched on its id, and nothing else on the query', async () => {
    const response = await handler(event({ method: 'DELETE', queryStringParameters: { id: ARTICLE_ID } }), {})
    expect(response.statusCode).toBe(200)
    expect(payload(response)).toMatchObject({ ok: true, id: ARTICLE_ID })
    expect(lastCall().method).toBe('DELETE')
    expect(filterOf(lastCall().url)).toBe(`id=eq.${ARTICLE_ID}`)
  })

  it('keeps an id carrying filter syntax inert instead of widening the delete', async () => {
    const hostile = 'kb-1&or=1=1'
    const response = await handler(event({ method: 'DELETE', queryStringParameters: { id: hostile } }), {})
    expect(response.statusCode).toBe(200)
    const filter = filterOf(lastCall().url)
    expect(filter).toBe(`id=eq.${encodeURIComponent(hostile)}`)
    // A raw `&` would have made this a second filter — `or=1=1` — and the delete would match every row.
    expect(filter.split('&')).toHaveLength(1)
    expect(filter.split('=')).toHaveLength(2)
  })

  it('encodes an id that is not URL-safe rather than sending it raw', async () => {
    const odd = 'مس article#1'
    await handler(event({ method: 'DELETE', queryStringParameters: { id: odd } }), {})
    const filter = filterOf(lastCall().url)
    expect(filter).toBe(`id=eq.${encodeURIComponent(odd)}`)
    expect(filter).not.toContain(' ')
    expect(filter).not.toContain('#')
    expect(filter).not.toContain('مس')
  })

  it('reports an upstream failure as a structured 502 rather than a success', async () => {
    mocks.fetchText.mockImplementation(async () => ({ status: 500, ok: false, headers: new Headers(), text: 'boom' }))
    const response = await handler(event({ method: 'DELETE', queryStringParameters: { id: ARTICLE_ID } }), {})
    expect(response.statusCode).toBe(502)
    expect(errorOf(response).code).toBe('upstream_error')
  })
})

describe('the article schema', () => {
  it('stamps every accepted item with the server clock and sends one upsert for the batch', async () => {
    const before = Date.now()
    const response = await handler(event({ items: [article(), article({ id: 'kb-2', slug: 'print-queue' })] }), {})
    expect(response.statusCode).toBe(200)
    expect(calls()).toHaveLength(1)
    expect(lastCall().method).toBe('POST')
    expect(filterOf(lastCall().url)).toBe('on_conflict=id')
    expect(lastCall().headers?.Prefer).toContain('merge-duplicates')
    const rows = upsertedRows()
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      const stamp = String(row.updated_at)
      expect(Date.parse(stamp)).not.toBeNaN()
      expect(Date.parse(stamp)).toBeGreaterThanOrEqual(before - 1000)
    }
    expect(rows[0]).toMatchObject({ id: ARTICLE_ID, slug: 'dns-troubleshooting' })
  })

  it('drops a field the schema does not declare instead of storing it', async () => {
    await handler(event({ items: [article({ published: true, is_featured: true, id_unknown: 1 })] }), {})
    const row = upsertedRows()[0] ?? {}
    expect(Object.keys(row)).not.toContain('published')
    expect(Object.keys(row)).not.toContain('is_featured')
    expect(Object.keys(row)).not.toContain('id_unknown')
  })

  it('applies the documented defaults when the optional fields are absent', async () => {
    await handler(event({ items: [article()] }), {})
    expect(upsertedRows()[0]).toMatchObject({
      tags: [],
      product_version: 'all',
      difficulty: 'intermediate',
      verification: 'draft',
      author: 'editorial',
      sources: [],
      related_script_ids: [],
    })
  })

  it.each([
    ['draft', 'draft'],
    ['ai-generated', 'ai-generated'],
    ['source-verified', 'source-verified'],
    ['syntax-checked', 'syntax-checked'],
    ['lab-tested', 'lab-tested'],
    ['production-validated', 'production-validated'],
  ])('accepts the honesty label %s', async (_label, verification) => {
    const response = await handler(event({ items: [article({ verification })] }), {})
    expect(response.statusCode).toBe(200)
    expect(upsertedRows()[0]).toMatchObject({ verification })
  })

  it('refuses a verification label outside the closed list, so no one can coin a stronger claim', async () => {
    for (const verification of ['verified', 'human-reviewed', 'PRODUCTION-VALIDATED', '']) {
      const response = await handler(event({ items: [article({ verification })] }), {})
      expect(response.statusCode).toBe(400)
      expect(errorOf(response).message).toContain('verification')
    }
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it('refuses a domain outside the closed list', async () => {
    const response = await handler(event({ items: [article({ domain: 'quantum' })] }), {})
    expect(response.statusCode).toBe(400)
    expect(errorOf(response).message).toContain('domain')
  })

  it.each([
    ['an uppercase slug', article({ slug: 'DNS-Troubleshooting' })],
    ['a slug with a space', article({ slug: 'dns troubleshooting' })],
    ['a slug with a slash', article({ slug: '../etc/passwd' })],
    ['an empty slug', article({ slug: '' })],
  ])('refuses %s, because the slug becomes a URL', async (_label, item) => {
    const response = await handler(event({ items: [item] }), {})
    expect(response.statusCode).toBe(400)
    expect(errorOf(response).message).toContain('slug')
  })

  it('refuses an empty title or body in either language', async () => {
    for (const item of [article({ title_en: '' }), article({ title_ar: '' }), article({ body_en: '' }), article({ summary_ar: '' })]) {
      const response = await handler(event({ items: [item] }), {})
      expect(response.statusCode).toBe(400)
    }
  })

  it('refuses a body past the declared ceiling', async () => {
    const response = await handler(event({ items: [article({ body_en: 'x'.repeat(100_001) })] }), {})
    expect(response.statusCode).toBe(400)
    expect(errorOf(response).message).toContain('body_en')
  })

  it('refuses an empty batch and a batch past fifty', async () => {
    expect((await handler(event({ items: [] }), {})).statusCode).toBe(400)
    const fiftyOne = Array.from({ length: 51 }, (_, index) => article({ id: `kb-${index}`, slug: `article-${index}` }))
    const response = await handler(event({ items: fiftyOne }), {})
    expect(response.statusCode).toBe(400)
    expect(errorOf(response).message).toContain('items')
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it('refuses more than thirty tags', async () => {
    const response = await handler(event({ items: [article({ tags: Array.from({ length: 31 }, (_, index) => `t${index}`) })] }), {})
    expect(response.statusCode).toBe(400)
    expect(errorOf(response).message).toContain('tags')
  })

  it('requires a real URL on every source, because a citation the reader cannot open is not a citation', async () => {
    for (const sources of [[{ title: 'Vendor docs', url: 'not-a-url' }], [{ title: 'Vendor docs' }], [{ title: 'a'.repeat(301), url: 'https://example.com' }]]) {
      const response = await handler(event({ items: [article({ sources })] }), {})
      expect(response.statusCode).toBe(400)
      expect(errorOf(response).message).toContain('sources')
    }
    const accepted = await handler(event({ items: [article({ sources: [{ title: 'Vendor docs', url: 'https://example.com/docs', publisher: 'Example', retrievedAt: '2026-11-01' }] })] }), {})
    expect(accepted.statusCode).toBe(200)
    expect(upsertedRows()[0]).toMatchObject({ sources: [{ title: 'Vendor docs', url: 'https://example.com/docs', publisher: 'Example', retrievedAt: '2026-11-01' }] })
  })

  it('reports three of the five wrong fields, each prefixed with its path, and stops there', async () => {
    const response = await handler(
      event({
        items: [
          article({
            slug: 'BAD SLUG',
            title_en: '',
            verification: 'made-up',
            domain: 'quantum',
            tags: Array.from({ length: 31 }, (_, index) => `t${index}`),
          }),
        ],
      }),
      {},
    )
    expect(response.statusCode).toBe(400)
    const message = errorOf(response).message ?? ''
    const parts = message.split('; ')
    // Five fields are wrong here, and exactly three of them are reported — the cap is a real cap.
    expect(parts).toHaveLength(3)
    for (const part of parts) expect(part).toMatch(/^items\.0\.[\w.]+: /)
  })

  it('refuses a body that is absent, unparseable, or past the shared byte cap', async () => {
    const missing = await handler(event({ body: null }), {})
    expect(errorOf(missing).message).toBe('A JSON request body is required.')

    const broken = await handler(event({ body: '{"items": [' }), {})
    expect(errorOf(broken).message).toBe('The request body is not valid JSON.')

    const huge = await handler(event({ body: JSON.stringify({ items: [article({ body_en: 'x'.repeat(MAX_BODY_BYTES + 1024) })] }) }), {})
    expect(huge.statusCode).toBe(413)
    expect(errorOf(huge)).toMatchObject({ code: 'payload_too_large', message: 'The request body is too large.' })
    expect(mocks.fetchText).not.toHaveBeenCalled()
  })

  it('refuses an envelope that is not the declared shape', async () => {
    for (const body of ['{}', '[]', '"items"', '{"items":{}}', '{"items":"nope"}']) {
      const response = await handler(event({ body }), {})
      expect(response.statusCode).toBe(400)
      expect(errorOf(response).code).toBe('invalid_input')
    }
  })
})
