import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { handler as healthHandler } from '../netlify/functions/health'
import { HttpError, json, readJsonBody, wrap, type Handler, type NetlifyEvent } from '../netlify/lib/http'
import { MAX_BODY_BYTES } from '../shared/upload-limits'
import { createVercelDispatcher, resolveRoute, toVercelEvent } from '../vercel/serverless'
import { routes } from '../vercel/dispatcher'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

beforeAll(() => {
  process.env.LOG_LEVEL = 'silent'
})
afterAll(() => {
  delete process.env.LOG_LEVEL
})

/** Every public API path the platform exposes, as netlify.toml and the frontend use them. */
const PUBLIC_ROUTES = [
  'admin', 'ai/analyze', 'ai/chat', 'ai/models', 'ai/script', 'ai/test', 'auth',
  'content', 'content/admin', 'health', 'net/analyzer', 'net/dns', 'net/http',
  'net/latency', 'net/path', 'net/port', 'net/printer', 'net/tls', 'net/url',
  'news', 'research', 'workspace',
]

interface Captured {
  headers: Record<string, string>
  body: string
}

function makeRequest(init: { method?: string; url?: string; headers?: Record<string, string | string[]>; body?: string | Buffer }) {
  const chunk = init.body === undefined ? [] : [Buffer.isBuffer(init.body) ? init.body : Buffer.from(init.body, 'utf8')]
  return {
    method: init.method ?? 'GET',
    url: init.url ?? '/api/index?_fn=/health',
    headers: init.headers ?? {},
    socket: { remoteAddress: '203.0.113.9' },
    async *[Symbol.asyncIterator]() {
      for (const value of chunk) yield value
    },
  } as unknown as IncomingMessage
}

function makeResponse(): { res: ServerResponse; read: () => Captured } {
  const captured: Captured = { headers: {}, body: '' }
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      captured.headers[name.toLowerCase()] = String(value)
    },
    end(chunk?: string) {
      captured.body = chunk ?? ''
    },
  } as unknown as ServerResponse
  return { res, read: () => captured }
}

async function dispatch(tables: Record<string, Handler>, init: Parameters<typeof makeRequest>[0]) {
  const { res, read } = makeResponse()
  await createVercelDispatcher(tables)(makeRequest(init), res)
  const captured = read()
  return {
    status: (res as unknown as { statusCode: number }).statusCode,
    headers: captured.headers,
    json: JSON.parse(captured.body || 'null') as Record<string, unknown>,
  }
}

describe('resolveRoute', () => {
  it('reads the public path handed over by the vercel.json rewrite', () => {
    const url = new URL('http://localhost/api/index?_fn=/ai/chat&mode=expert')
    expect(resolveRoute(url)).toEqual({ route: 'ai/chat', path: '/api/ai/chat', query: { mode: 'expert' } })
  })

  it('keeps working when the function is called by its own path', () => {
    const url = new URL('http://localhost/api/net/port?host=example.com')
    expect(resolveRoute(url)).toEqual({ route: 'net/port', path: '/api/net/port', query: { host: 'example.com' } })
  })

  it('finds no route for a path outside the API tree', () => {
    expect(resolveRoute(new URL('http://localhost/copilot')).route).toBeNull()
  })
})

describe('toVercelEvent', () => {
  it('builds a Lambda-shaped event from a Node request', async () => {
    const event = await toVercelEvent(
      makeRequest({ method: 'POST', url: '/api/index?_fn=/net/port&refresh=1&tag=a%2Cb', headers: { 'content-type': 'application/json', cookie: ['a=1', 'b=2'] }, body: '{"host":"example.com"}' }),
    )
    expect(event.httpMethod).toBe('POST')
    expect(event.path).toBe('/api/net/port')
    expect(event.queryStringParameters).toEqual({ refresh: '1', tag: 'a,b' })
    expect(event.headers.cookie).toBe('a=1, b=2')
    expect(event.isBase64Encoded).toBe(true)
    expect(Buffer.from(event.body ?? '', 'base64').toString('utf8')).toBe('{"host":"example.com"}')
  })

  it('sends a null body when there is no payload', async () => {
    expect((await toVercelEvent(makeRequest({}))).body).toBeNull()
  })

  it('carries a body that is not valid UTF-8 byte for byte', async () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x42])
    const event = await toVercelEvent(makeRequest({ method: 'POST', url: '/api/index?_fn=/echo', body: binary }))
    expect(Buffer.from(event.body ?? '', 'base64')).toEqual(binary)
  })

  it('keeps multibyte text intact through the same path', async () => {
    const arabic = JSON.stringify({ note: 'محاولة رفع صورة — تحليل الشبكة' })
    const event = await toVercelEvent(makeRequest({ method: 'POST', url: '/api/index?_fn=/echo', body: arabic }))
    expect(Buffer.from(event.body ?? '', 'base64').toString('utf8')).toBe(arabic)
  })

  it('measures the payload cap on raw bytes, not on the base64 form', async () => {
    // 4 MB of binary becomes ≈5.33 MB of base64; the limit is about what the edge accepted.
    const event = await toVercelEvent(makeRequest({ method: 'POST', url: '/api/index?_fn=/echo', body: Buffer.alloc(4 * 1024 * 1024, 0xff) }))
    const body = event.body ?? ''
    expect(body.length).toBeGreaterThan(MAX_BODY_BYTES)
    expect(Buffer.from(body, 'base64').length).toBe(4 * 1024 * 1024)
  })
})

describe('createVercelDispatcher', () => {
  it('runs the real health handler through the rewritten path', async () => {
    const result = await dispatch({ health: healthHandler }, { url: '/api/index?_fn=/health' })
    expect(result.status).toBe(200)
    expect(result.headers['content-type']).toContain('application/json')
    expect(result.headers['cache-control']).toBe('no-store')
    expect((result.json as { ok: boolean }).ok).toBe(true)
  })

  it('runs the same handler through the direct path', async () => {
    const result = await dispatch({ health: healthHandler }, { url: '/api/health' })
    expect(result.status).toBe(200)
  })

  it('answers an unknown route with a JSON 404 instead of the SPA shell', async () => {
    const result = await dispatch({ health: healthHandler }, { url: '/api/index?_fn=/typo' })
    expect(result.status).toBe(404)
    expect(result.json).toEqual({ error: { code: 'not_found', message: 'No API function matches /api/typo.' } })
  })

  it('passes the client IP through x-forwarded-for instead of the socket address', async () => {
    const echo: Handler = async (event: NetlifyEvent, context) =>
      json(200, { ip: context.ip, method: event.httpMethod, path: event.path, query: event.queryStringParameters })
    const result = await dispatch({ echo }, { url: '/api/index?_fn=/echo&x=2', headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } })
    expect(result.json).toMatchObject({ ip: '198.51.100.7', method: 'GET', path: '/api/echo', query: { x: '2' } })
  })

  it('hands a handler the decoded JSON body, since the event itself is base64', async () => {
    const echo: Handler = async (event) => json(200, { body: readJsonBody<{ note: string; imageDataUrl?: string }>(event, MAX_BODY_BYTES) })
    const payload = { note: 'تحليل', imageDataUrl: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}` }
    const result = await dispatch({ echo }, { method: 'POST', url: '/api/index?_fn=/echo', body: JSON.stringify(payload) })
    expect(result.json).toEqual({ body: payload })
  })

  it('rejects bodies above the Vercel payload limit before calling the handler', async () => {
    let reached = false
    const echo: Handler = async () => {
      reached = true
      return json(200, { ok: true })
    }
    const result = await dispatch({ echo }, { method: 'POST', url: '/api/index?_fn=/echo', body: 'a'.repeat(5 * 1024 * 1024) })
    expect(result.status).toBe(413)
    expect(result.json).toMatchObject({ error: { code: 'payload_too_large' } })
    expect(reached).toBe(false)
  })

  it('preserves the handler status code and error envelope', async () => {
    const blocked = wrap(async () => {
      throw new HttpError(403, 'blocked_host', 'Private or reserved addresses are not allowed.')
    })
    const result = await dispatch({ 'net/dns': blocked }, { url: '/api/index?_fn=/net/dns' })
    expect(result.status).toBe(403)
    expect(result.json).toEqual({ error: { code: 'blocked_host', message: 'Private or reserved addresses are not allowed.' } })
  })

  it('converts a failure outside a wrapped handler into a 500 JSON response', async () => {
    const broken: Handler = async () => {
      throw new Error('runtime exploded')
    }
    const result = await dispatch({ broken }, { url: '/api/index?_fn=/broken' })
    expect(result.status).toBe(500)
    expect(result.json).toMatchObject({ error: { code: 'unknown' } })
  })
})

describe('Vercel route table', () => {
  it('exposes every documented public API path', () => {
    expect(Object.keys(routes).sort()).toEqual([...PUBLIC_ROUTES].sort())
  })

  it('points every entry in the dispatcher table at a handler that exists', () => {
    const source = readFileSync(join(ROOT, 'vercel', 'dispatcher.ts'), 'utf8')
    const imports = [...source.matchAll(/import \{ handler as (\w+) \} from '([^']+)'/g)]
    expect(imports).toHaveLength(PUBLIC_ROUTES.length)
    for (const [, alias, specifier] of imports) {
      expect(existsSync(`${resolve(join(ROOT, 'vercel'), specifier)}.ts`), alias).toBe(true)
    }
    for (const handler of Object.values(routes)) expect(typeof handler).toBe('function')
  })

  it('resolves every public path through the rewrite and keeps api/ generated', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      buildCommand: string
      rewrites: Array<{ source: string; destination: string }>
      functions: Record<string, { maxDuration: number }>
    }
    const apiRewrite = config.rewrites[0]
    expect(apiRewrite.source).toBe('/api/:match*')
    expect(apiRewrite.destination).toBe('/api/index?_fn=/:match*')
    // The bundle step must run inside `npm run build` so Vercel finds api/index.js
    // and a local build can never leave a stale bundle behind.
    expect(config.buildCommand).toBe('npm run build')
    const scripts = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
    expect(scripts.build).toContain('build:vercel-api')
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n')).toContain('/api')
    expect(config.functions['api/index.js'].maxDuration).toBe(60)
    // Vercel rejects the whole config with "should NOT have additional property
    // `toolbar`"; the toolbar is a dashboard-only project setting.
    expect(config).not.toHaveProperty('toolbar')
    for (const route of PUBLIC_ROUTES) {
      const resolved = resolveRoute(new URL(`http://localhost/api/index?_fn=/${route}`))
      expect(resolved.route, route).toBe(route)
      expect(routes[route], route).toBeDefined()
    }
  })

  it('never lets the SPA fallback swallow the API', () => {
    const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as { rewrites: Array<{ source: string; destination: string }> }
    const fallback = config.rewrites.at(-1)
    expect(fallback?.destination).toBe('/index.html')
    expect(fallback?.source).toContain('(?!api/)')
  })
})
