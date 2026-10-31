import { afterEach, describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HttpError, errorResponse, json } from '../netlify/lib/http'
import { enforceRateLimit } from '../netlify/lib/rate'
import { describeError } from '../src/services/apiError'
import { translate } from '../src/i18n'
import {
  ApiError,
  authMe,
  getHealth,
  setAuthTokenProvider,
  setUnauthorizedHandler,
  workspaceRequest,
} from '../src/services/api'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

interface FakeInit {
  status?: number
  headers?: Record<string, string>
  body?: unknown
}

function fakeResponse(init: FakeInit = {}): Response {
  const status = init.status ?? 200
  const headers = new Map(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]))
  if (!headers.has('content-type')) headers.set('content-type', 'application/json')
  const body = init.body ?? null
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

function errorBody(code: string, message: string, detail?: string) {
  return { error: { code, message, ...(detail ? { detail } : {}) } }
}

/** Each call returns the next scripted response, so a replay is visible as a second call. */
function stubFetch(...responses: Array<Response>) {
  const fetchMock = vi.fn(async () => responses.shift() ?? fakeResponse({ status: 500 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function authorizationOf(call: unknown[] | undefined): string | null {
  const init = call?.[1] as { headers?: Record<string, string> } | undefined
  return init?.headers?.Authorization ?? null
}

afterEach(() => {
  vi.unstubAllGlobals()
  setAuthTokenProvider(null)
  setUnauthorizedHandler(null)
})

describe('the server sends the retry window as a header, not only as prose', () => {
  it('emits Retry-After when the error carries one', () => {
    const response = errorResponse(new HttpError(429, 'rate_limited', 'Slow down.', undefined, 42))
    expect(response.statusCode).toBe(429)
    expect(response.headers['Retry-After']).toBe('42')
  })

  it('leaves the shared base headers alone, so one 429 does not stick to every later response', () => {
    errorResponse(new HttpError(429, 'rate_limited', 'Slow down.', undefined, 42))
    expect(json(200, { ok: true }).headers['Retry-After']).toBeUndefined()
    expect(errorResponse(new HttpError(404, 'not_found', 'Gone.')).headers['Retry-After']).toBeUndefined()
  })

  it('puts the limiter window in the header and keeps the prose in agreement', () => {
    let thrown: unknown = null
    try {
      for (let attempt = 0; attempt < 4; attempt += 1) enforceRateLimit('retry-after-probe', 3, 60_000)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(HttpError)
    const failure = thrown as HttpError
    expect(failure.statusCode).toBe(429)
    expect(failure.retryAfterSeconds).toBeGreaterThanOrEqual(1)
    expect(failure.message).toContain(`in ${failure.retryAfterSeconds} seconds`)
    expect(errorResponse(failure).headers['Retry-After']).toBe(String(failure.retryAfterSeconds))
  })
})

describe('ApiError carries the retry window the browser can count down from', () => {
  it('reads delta-seconds', async () => {
    stubFetch(fakeResponse({ status: 429, headers: { 'retry-after': '42' }, body: errorBody('rate_limited', 'Too many.') }))
    const failure = await getHealth().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ApiError)
    expect((failure as ApiError).retryAfterSeconds).toBe(42)
    expect((failure as ApiError).code).toBe('rate_limited')
  })

  it('reads an HTTP-date', async () => {
    const at = new Date(Date.now() + 90_000).toUTCString()
    stubFetch(fakeResponse({ status: 429, headers: { 'retry-after': at }, body: errorBody('rate_limited', 'Too many.') }))
    const failure = (await getHealth().catch((error: unknown) => error)) as ApiError
    expect(failure.retryAfterSeconds).toBeGreaterThan(60)
    expect(failure.retryAfterSeconds).toBeLessThanOrEqual(90)
  })

  it('ignores a header it cannot parse and clamps one that is absurd', async () => {
    stubFetch(fakeResponse({ status: 429, headers: { 'retry-after': 'soon' }, body: errorBody('rate_limited', 'Too many.') }))
    expect(((await getHealth().catch((error: unknown) => error)) as ApiError).retryAfterSeconds).toBeNull()

    stubFetch(fakeResponse({ status: 429, headers: { 'retry-after': '999999999' }, body: errorBody('rate_limited', 'Too many.') }))
    expect(((await getHealth().catch((error: unknown) => error)) as ApiError).retryAfterSeconds).toBe(86_400)
  })

  it('is null when the server sent no header at all', async () => {
    stubFetch(fakeResponse({ status: 503, body: errorBody('not_configured', 'Not configured.') }))
    expect(((await getHealth().catch((error: unknown) => error)) as ApiError).retryAfterSeconds).toBeNull()
  })
})

describe('a 401 on the ambient session refreshes once and replays', () => {
  it('replays with the fresh token so the caller never sees the lapse', async () => {
    let current = 'stale-token'
    setAuthTokenProvider(() => current)
    const fetchMock = stubFetch(
      fakeResponse({ status: 401, body: errorBody('unauthorized', 'Expired.') }),
      fakeResponse({ body: { ok: true } }),
    )
    const unauthorized = vi.fn(async () => {
      current = 'fresh-token'
      return current
    })
    setUnauthorizedHandler(unauthorized)

    await expect(workspaceRequest({ action: 'overview' })).resolves.toMatchObject({ ok: true })
    expect(unauthorized).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(authorizationOf(fetchMock.mock.calls[0])).toBe('Bearer stale-token')
    expect(authorizationOf(fetchMock.mock.calls[1])).toBe('Bearer fresh-token')
  })

  it('gives up after one replay instead of looping', async () => {
    setAuthTokenProvider(() => 'token')
    const fetchMock = stubFetch(
      fakeResponse({ status: 401, body: errorBody('unauthorized', 'Expired.') }),
      fakeResponse({ status: 401, body: errorBody('unauthorized', 'Expired.') }),
      fakeResponse({ body: { ok: true } }),
    )
    const unauthorized = vi.fn(async () => 'token')
    setUnauthorizedHandler(unauthorized)

    await expect(workspaceRequest({ action: 'overview' })).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces the 401 unchanged when the refresh produces no token', async () => {
    setAuthTokenProvider(() => 'token')
    const fetchMock = stubFetch(fakeResponse({ status: 401, body: errorBody('unauthorized', 'Expired.') }))
    const unauthorized = vi.fn(async () => null)
    setUnauthorizedHandler(unauthorized)

    await expect(workspaceRequest({ action: 'overview' })).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
    expect(unauthorized).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never replays the auth endpoint, where a 401 is the answer rather than a lapse', async () => {
    setAuthTokenProvider(() => 'token')
    const fetchMock = stubFetch(fakeResponse({ status: 401, body: errorBody('invalid_credentials', 'Wrong password.') }))
    const unauthorized = vi.fn(async () => 'token')
    setUnauthorizedHandler(unauthorized)

    await expect(authMe('token')).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('leaves a caller-supplied token alone, since that caller refreshed it deliberately', async () => {
    setAuthTokenProvider(() => 'ambient')
    const fetchMock = stubFetch(fakeResponse({ status: 401, body: errorBody('unauthorized', 'Expired.') }))
    const unauthorized = vi.fn(async () => 'ambient')
    setUnauthorizedHandler(unauthorized)

    await expect(authMe('explicit-token')).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).not.toHaveBeenCalled()
    expect(authorizationOf(fetchMock.mock.calls[0])).toBe('Bearer explicit-token')
  })

  it('does not call the handler for a guest who had no token to lapse', async () => {
    const fetchMock = stubFetch(fakeResponse({ status: 401, body: errorBody('unauthorized', 'Sign in.') }))
    const unauthorized = vi.fn(async () => 'token')
    setUnauthorizedHandler(unauthorized)

    await expect(workspaceRequest({ action: 'overview' })).rejects.toMatchObject({ status: 401 })
    expect(unauthorized).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not treat a 403 as a lapse, because refreshing cannot widen a role', async () => {
    setAuthTokenProvider(() => 'token')
    const fetchMock = stubFetch(fakeResponse({ status: 403, body: errorBody('forbidden', 'Not allowed.') }))
    const unauthorized = vi.fn(async () => 'token')
    setUnauthorizedHandler(unauthorized)

    await expect(workspaceRequest({ action: 'overview' })).rejects.toMatchObject({ status: 403 })
    expect(unauthorized).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('one mapping from a caught value to text, whichever page caught it', () => {
  it('replaces the operator prose behind not_configured, in both languages', () => {
    const error = new ApiError(
      'not_configured',
      'Authentication is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.',
      503,
    )
    for (const lang of ['en', 'ar'] as const) {
      const text = describeError(error, lang, 'fallback')
      expect(text, lang).toBe(translate(lang, 'errors.not_configured'))
      expect(text, lang).not.toContain('SUPABASE')
    }
  })

  it('counts a 429 down from the header instead of repeating the server sentence', () => {
    const error = new ApiError('rate_limited', 'Rate limit reached. Try again in 42 seconds.', 429, undefined, 42)
    expect(describeError(error, 'en', 'fallback')).toBe('Too many requests. Try again in 42 seconds.')
    expect(describeError(error, 'ar', 'fallback')).toContain('42')
  })

  it('does not claim "too many requests" for a 503 that happens to carry the header', () => {
    const error = new ApiError('upstream_error', 'The feed is being restarted.', 503, undefined, 30)
    expect(describeError(error, 'en', 'fallback')).toBe('The feed is being restarted.')
  })

  it('says the request never arrived, and keeps the wording for a deliberate cancel', () => {
    expect(describeError(new ApiError('unknown', 'Network request failed.', 0, 'fetch failed'), 'en', 'fallback'))
      .toBe(translate('en', 'errors.network'))
    expect(describeError(new ApiError('timeout', 'The request was aborted.', 0), 'en', 'fallback'))
      .toBe('The request was aborted.')
  })

  it('appends the server detail with one separator', () => {
    const error = new ApiError('invalid_input', 'The request was rejected.', 400, 'host: Required')
    expect(describeError(error, 'en', 'fallback')).toBe('The request was rejected. — host: Required')
  })

  it('drops the detail for sign-in outcomes, where it is the provider restating the message', () => {
    const error = new ApiError('invalid_credentials', 'The email or password is incorrect.', 401, 'invalid_grant')
    expect(describeError(error, 'en', 'fallback')).toBe('The email or password is incorrect.')
  })

  it('falls through to a plain Error, then to the caller fallback', () => {
    expect(describeError(new Error('bad JSON'), 'en', 'fallback')).toBe('bad JSON')
    expect(describeError(new Error(''), 'en', 'fallback')).toBe('fallback')
    expect(describeError('a string', 'en', 'fallback')).toBe('fallback')
    expect(describeError(null, 'en', 'fallback')).toBe('fallback')
  })

  it('is the only mapper left, so two pages cannot word the same failure differently', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : []
      })

    // speedtest.ts maps failures from third-party test endpoints, never from this
    // API, and returns '' so callers can supply their own phase-specific default.
    const allowed = join(ROOT, 'src', 'lib', 'speedtest.ts')
    const local = walk(join(ROOT, 'src')).filter(
      (file) => file !== allowed && /function errorMessage\(/.test(readFileSync(file, 'utf8')),
    )
    expect(local.map((file) => file.slice(ROOT.length))).toEqual([])
  })
})

describe('the mapper sits in the layer it is allowed to import from', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name)
      return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : []
    })

  const relative = (files: string[]) => files.map((file) => file.slice(ROOT.length + 1)).sort()

  it('keeps src/lib at the bottom of the chain, which is why describeError is not in it', () => {
    // describeError has to instanceof the ApiError that services/api.ts defines.
    // In src/lib that import would point upward and invert pages → services → lib.
    const upward = walk(join(ROOT, 'src', 'lib')).filter((file) =>
      /from '@\/(services|pages|components|context|hooks)\//.test(readFileSync(file, 'utf8')),
    )
    expect(relative(upward)).toEqual([])
  })

  it('keeps React out of src/services, so the transport stays testable without a renderer', () => {
    const react = walk(join(ROOT, 'src', 'services')).filter((file) =>
      /from 'react'|from '@\/(pages|components|context|hooks)\//.test(readFileSync(file, 'utf8')),
    )
    expect(relative(react)).toEqual([])
  })
})
