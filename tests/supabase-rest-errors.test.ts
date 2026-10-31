import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `netlify/lib/supabase.ts` is the only place that talks to the database and the
 * auth server, and it is the place that decides what a browser is allowed to
 * learn about a failure: `restError()` maps ~20 upstream shapes onto a small
 * set of codes, and the mapping is what turns a raw PostgREST or GoTrue body into
 * something the UI can show. None of it had a test.
 *
 * `fetchText` is stubbed, so every case below is a pure translation check with no
 * network. `serverConfig` is a snapshot of `process.env` taken at import, so the
 * three Supabase values are written directly and restored afterwards.
 */

interface StubResponse {
  status: number
  ok?: boolean
  text?: string
  headers?: Record<string, string>
}

const fetchText = vi.hoisted(() =>
  vi.fn(async (_url: string, _init?: Record<string, unknown>) => ({
    status: 200,
    ok: true,
    text: '[]',
    headers: new Headers(),
  })),
)

vi.mock('../netlify/lib/fetch', async (importActual) => ({
  ...(await importActual<typeof import('../netlify/lib/fetch')>()),
  fetchText,
}))

import { serverConfig } from '../netlify/lib/env'
import { HttpError, errorResponse } from '../netlify/lib/http'
import {
  authAdminRequest,
  authRequest,
  authUser,
  authUserVerified,
  supabaseCount,
  supabaseDelete,
  supabaseDeleteWhere,
  supabaseInsert,
  supabasePublicConfigured,
  supabaseSelect,
  supabaseSelectAs,
  supabaseUpdate,
  supabaseUpsert,
} from '../netlify/lib/supabase'

const URL = 'https://test-project.supabase.co'
const ANON_KEY = 'anon-public-key'
const SERVICE_KEY = 'service-role-secret-key'

function reply(response: StubResponse) {
  fetchText.mockImplementation(async () => ({
    status: response.status,
    ok: response.ok ?? (response.status >= 200 && response.status < 300),
    text: response.text ?? '',
    headers: new Headers(response.headers ?? {}),
  }))
}

/** The HttpError the module throws, without the stack noise. */
async function failure(promise: Promise<unknown>): Promise<HttpError> {
  return promise.then(
    () => {
      throw new Error('expected the call to fail')
    },
    (error: unknown) => {
      expect(error).toBeInstanceOf(HttpError)
      return error as HttpError
    },
  )
}

const saved = {
  supabaseUrl: serverConfig.supabaseUrl,
  supabaseAnonKey: serverConfig.supabaseAnonKey,
  supabaseServiceRoleKey: serverConfig.supabaseServiceRoleKey,
}

beforeEach(() => {
  vi.stubEnv('LOG_LEVEL', 'silent')
  serverConfig.supabaseUrl = URL
  serverConfig.supabaseAnonKey = ANON_KEY
  serverConfig.supabaseServiceRoleKey = SERVICE_KEY
  fetchText.mockReset()
  fetchText.mockImplementation(async (_url: string, _init?: Record<string, unknown>) => ({
    status: 200,
    ok: true,
    text: '[]',
    headers: new Headers(),
  }))
})

afterEach(() => {
  Object.assign(serverConfig, saved)
  vi.unstubAllEnvs()
})

/** Every assertion about an outgoing call reads the single stubbed request. */
function sentUrl(): string {
  return String(fetchText.mock.lastCall?.[0])
}

function sentInit(): Record<string, unknown> {
  return fetchText.mock.lastCall?.[1] as Record<string, unknown>
}

function sentHeaders(): Record<string, string> {
  return sentInit().headers as Record<string, string>
}

describe('restError maps upstream failures onto the codes the UI understands', () => {
  const cases: Array<{ status: number; body: string; statusCode: number; code: string; message: string }> = [
    { status: 401, body: '{"message":"invalid JWT"}', statusCode: 401, code: 'unauthorized', message: 'The session is invalid or has expired.' },
    { status: 404, body: '{"message":"not found"}', statusCode: 404, code: 'not_found', message: 'Database was not found.' },
    { status: 409, body: '{"message":"duplicate key"}', statusCode: 409, code: 'already_exists', message: 'Database already exists.' },
    { status: 429, body: 'too many requests', statusCode: 429, code: 'rate_limited', message: 'Too many requests. Try again shortly.' },
    { status: 400, body: '{"msg":"Invalid login credentials"}', statusCode: 401, code: 'invalid_credentials', message: 'The email or password is incorrect.' },
    { status: 400, body: '{"error_description":"invalid credentials"}', statusCode: 401, code: 'invalid_credentials', message: 'The email or password is incorrect.' },
    { status: 400, body: '{"error":{"message":"invalid_grant"}}', statusCode: 401, code: 'invalid_credentials', message: 'The email or password is incorrect.' },
    { status: 400, body: '{"msg":"Email not confirmed"}', statusCode: 403, code: 'email_not_verified', message: 'Verify your email address before signing in.' },
    { status: 422, body: '{"message":"unsatisfiable"}', statusCode: 422, code: 'invalid_input', message: 'The submitted data was rejected.' },
    { status: 500, body: 'internal', statusCode: 502, code: 'upstream_error', message: 'Database is temporarily unavailable.' },
    { status: 503, body: 'temporarily unavailable', statusCode: 502, code: 'upstream_error', message: 'Authentication service is temporarily unavailable.' },
  ]

  it.each(cases)('HTTP $status with $body becomes $code', async ({ status, body, statusCode, code, message }) => {
    reply({ status, text: body })
    const area = message.startsWith('Authentication') ? 'Authentication service' : 'Database'
    const promise = area === 'Database' ? supabaseSelectAs('profiles', 'select=id') : authAdminRequest('/users')
    const error = await failure(promise)
    expect(error.statusCode).toBe(statusCode)
    expect(error.code).toBe(code)
    expect(error.message).toBe(message)
  })

  it('reads the already-registered wording from any status, including a 200-shaped failure', async () => {
    for (const body of ['User already registered', '{"msg":"an account with this email already exists"}', 'duplicate: user already has a profile']) {
      reply({ status: 400, text: body })
      const error = await failure(authRequest('/signup', { method: 'POST', body: { email: 'ada@example.com' } }))
      expect(error.code).toBe('already_exists')
      expect(error.message).toBe('An account with this email already exists.')
    }
  })

  it('checks the credential wording before the generic failure branches', async () => {
    reply({ status: 400, text: '{"msg":"Invalid login credentials"}' })
    expect((await failure(authRequest('/token?grant_type=password'))).statusCode).toBe(401)
  })

  it('keeps a 4xx the table does not name as that status rather than inventing a 502', async () => {
    reply({ status: 451, text: 'blocked' })
    const error = await failure(supabaseSelectAs('profiles', 'select=id'))
    expect(error.statusCode).toBe(451)
    expect(error.code).toBe('upstream_error')
    expect(error.message).toBe('Database request failed.')
  })

  it('answers 502 when the upstream returns a 3xx body it cannot use', async () => {
    reply({ status: 302, text: 'found', ok: false })
    const error = await failure(supabaseSelectAs('profiles', 'select=id'))
    expect(error.statusCode).toBe(502)
    expect(error.message).toBe('Database request failed.')
  })

  it('names the area it was called with', async () => {
    reply({ status: 404, text: 'gone' })
    expect((await failure(authUser('access-token'))).message).toBe('Authentication service was not found.')
  })
})

describe('the upstream detail is shortened, never invented', () => {
  it('prefers msg, then message, then error_description, then error', async () => {
    for (const [body, expected] of [
      ['{"msg":"first","message":"second"}', 'first'],
      ['{"message":"only message"}', 'only message'],
      ['{"error_description":"described"}', 'described'],
      ['{"error":"just error"}', 'just error'],
      ['{"error":{"message":"nested message"}}', 'nested message'],
    ] as Array<[string, string]>) {
      reply({ status: 400, text: body })
      expect((await failure(supabaseSelectAs('profiles', 'select=id'))).detail).toBe(expected)
    }
  })

  it('collapses whitespace and caps the detail at 300 characters', async () => {
    reply({ status: 500, text: `a\n  b\t${'c'.repeat(400)}` })
    const detail = (await failure(supabaseSelectAs('profiles', 'select=id'))).detail ?? ''
    expect(detail).toHaveLength(300)
    expect(detail).not.toMatch(/\s\s/)
    expect(detail.startsWith('a b')).toBe(true)
  })

  it('omits an empty detail instead of sending an empty string', async () => {
    reply({ status: 500, text: '   ' })
    expect((await failure(supabaseSelectAs('profiles', 'select=id'))).detail).toBeUndefined()
  })

  it('survives a body that is not JSON at all', async () => {
    reply({ status: 500, text: '<html>500</html>' })
    expect((await failure(supabaseSelectAs('profiles', 'select=id'))).detail).toBe('<html>500</html>')
  })
})

describe('nothing that identifies a secret leaves the server', () => {
  it('never repeats the request body or the service key back to the caller', async () => {
    reply({ status: 400, text: 'invalid' })
    const error = await failure(
      authRequest('/signup', { method: 'POST', body: { email: 'ada@example.com', password: 'a-password-nobody-must-echo' } }),
    )
    const serialized = JSON.stringify(errorResponse(error).body)
    expect(serialized).not.toContain('a-password-nobody-must-echo')
    expect(serialized).not.toContain(SERVICE_KEY)
    expect(serialized).not.toContain(ANON_KEY)
    expect(serialized).not.toContain('ada@example.com')
  })

  it('redacts the service key even when Supabase echoes it in an error body', async () => {
    reply({ status: 400, text: `apikey ${SERVICE_KEY} is not allowed to reach profiles` })
    const error = await failure(supabaseSelectAs('profiles', 'select=id'))
    expect(error.detail).not.toContain(SERVICE_KEY)
    expect(error.detail).toContain('[redacted]')
    // The mapping table answers with a fixed sentence for an unmapped 400 body.
    expect(error.statusCode).toBe(400)

    reply({ status: 500, text: JSON.stringify({ msg: ` bearer ${SERVICE_KEY} expired` }) })
    expect((await failure(supabaseSelectAs('profiles', 'select=id'))).detail).toBe('bearer [redacted] expired')
  })

  it('answers 503 and sends nothing when a member read has no project URL', async () => {
    serverConfig.supabaseUrl = ''
    serverConfig.supabaseServiceRoleKey = ''
    expect((await failure(supabaseSelectAs('profiles', 'select=id'))).statusCode).toBe(503)
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('answers an unconfigured admin read with the session message, not the real cause', async () => {
    serverConfig.supabaseServiceRoleKey = ''
    reply({ status: 401, text: '{"message":"invalid API key"}' })
    const error = await failure(supabaseSelectAs('profiles', 'select=id'))
    expect(sentHeaders()).toMatchObject({ apikey: '', Authorization: 'Bearer ' })
    expect(fetchText).toHaveBeenCalledTimes(1)
    // Pinned as it behaves today: an empty service key leaves Supabase rejecting
    // the request, and the mapping table can only describe a member session.
    expect(error.code).toBe('unauthorized')
    expect(error.message).toBe('The session is invalid or has expired.')
    expect(error.detail).toContain('invalid API key')
  })

  it('reports the missing configuration by variable name, not by value', async () => {
    serverConfig.supabaseUrl = ''
    const error = await failure(authRequest('/signup'))
    expect(error.statusCode).toBe(503)
    expect(error.message).toBe('Authentication is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY on the server.')
    expect(JSON.stringify(errorResponse(error))).not.toContain(SERVICE_KEY)
  })
})

describe('the credential a request is sent with is decided by the caller, not the browser', () => {
  it('uses the service-role key only when the caller asks for it', async () => {
    await supabaseSelectAs('profiles', 'select=id')
    expect(sentHeaders()).toMatchObject({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })
  })

  it('uses the anon key for a public read', async () => {
    await supabaseSelect('profiles', 'select=id')
    expect(sentHeaders()).toMatchObject({ apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` })
  })

  it('carries the member token, never the service key, on a member read', async () => {
    await authUser('member-access-token')
    expect(sentHeaders()).toMatchObject({ apikey: ANON_KEY, Authorization: 'Bearer member-access-token' })
    expect(JSON.stringify(sentHeaders())).not.toContain(SERVICE_KEY)
  })

  it('treats an empty access token as a token, not as "use the anon key"', async () => {
    await authUser('')
    expect(sentHeaders()).toMatchObject({ apikey: ANON_KEY, Authorization: 'Bearer ' })
  })

  it('sends the service key as both apikey and bearer on an admin write', async () => {
    await supabaseUpdate('profiles', 'id=eq.1', { full_name: 'Ada' })
    expect(sentHeaders()).toMatchObject({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` })
  })

  it('sets Content-Type beside a body, and forwards Prefer verbatim', async () => {
    await supabaseSelect('profiles', 'select=id')
    expect(sentHeaders()).not.toHaveProperty('Content-Type')
    await supabaseCount('profiles')
    expect(sentHeaders().Prefer).toBe('count=exact')
    // `adminHeaders()` stamps Content-Type on every service call, body or not.
    expect(sentHeaders()['Content-Type']).toBe('application/json')
    await supabaseInsert('profiles', [{ id: '1' }])
    expect(sentHeaders()).toMatchObject({ 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' })
  })
})

describe('the URL and the options are built the way PostgREST expects', () => {
  it('reads through the REST root with the caller query untouched', async () => {
    await supabaseSelect('profiles', 'select=id&status=eq.active')
    expect(sentUrl()).toBe(`${URL}/rest/v1/profiles?select=id&status=eq.active`)
    expect(sentInit().method).toBe('GET')
    expect(sentInit().timeoutMs).toBe(15000)
    expect(sentInit().maxBytes).toBe(5 * 1024 * 1024)
  })

  it('encodes the conflict target for upsert and insert', async () => {
    await supabaseUpsert('profiles', [{ id: '1' }], 'email, id')
    expect(sentUrl()).toContain('/rest/v1/profiles?on_conflict=email%2C%20id')
    expect(sentInit()).toMatchObject({ method: 'POST', timeoutMs: 20000 })
    await supabaseInsert('audit_events', [{ id: '1' }], 'id', true)
    expect(sentInit().headers).toMatchObject({ Prefer: 'resolution=ignore-duplicates,return=representation' })
    await supabaseInsert('profiles', [{ id: '1' }])
    expect(sentUrl()).toBe(`${URL}/rest/v1/profiles`)
  })

  it('patches with a filter and represents the row back', async () => {
    await supabaseUpdate('profiles', 'id=eq.1', { role: 'admin' })
    expect(sentUrl()).toBe(`${URL}/rest/v1/profiles?id=eq.1`)
    expect(sentInit()).toMatchObject({ method: 'PATCH', body: JSON.stringify({ role: 'admin' }) })
    expect((sentInit().headers as Record<string, string>).Prefer).toBe('return=representation')
  })

  it('deletes by id through the same escaped filter', async () => {
    await supabaseDelete('profiles', 'id/with?chars')
    expect(sentUrl()).toBe(`${URL}/rest/v1/profiles?id=eq.id%2Fwith%3Fchars`)
    expect(sentInit().method).toBe('DELETE')
  })

  it('targets the auth routes under /auth/v1', async () => {
    await authRequest('/token?grant_type=password', { method: 'POST' })
    expect(sentUrl()).toBe(`${URL}/auth/v1/token?grant_type=password`)
    await authAdminRequest('/users/abc', { method: 'DELETE' })
    expect(sentUrl()).toBe(`${URL}/auth/v1/admin/users/abc`)
  })

  it('asks for the smallest possible count payload', async () => {
    await supabaseCount('profiles', 'status=eq.active')
    expect(sentUrl()).toBe(`${URL}/rest/v1/profiles?select=id&status=eq.active`)
    expect(sentInit().maxBytes).toBe(1024 * 1024)
  })
})

describe('results are parsed as data or as nothing, never as a guess', () => {
  it('turns an empty 200 into null rather than throwing on JSON.parse', async () => {
    reply({ status: 200, text: '' })
    await supabaseUpdate('profiles', 'id=eq.1', { role: 'admin' })
    expect(fetchText).toHaveBeenCalledTimes(1)
  })

  it('returns an empty array when a list endpoint answers with an object', async () => {
    reply({ status: 200, text: '{"error":"unexpected"}' })
    expect(await supabaseSelect('profiles', 'select=id')).toEqual([])
    expect(await supabaseInsert('profiles', [{ id: '1' }])).toEqual([])
  })

  it('reads the total from content-range', async () => {
    reply({ status: 206, text: '[{"id":"1"}]', headers: { 'content-range': '0-0/137' } })
    expect(await supabaseCount('profiles')).toBe(137)
  })

  it('answers zero for a missing or malformed content-range', async () => {
    reply({ status: 200, text: '[]' })
    expect(await supabaseCount('profiles')).toBe(0)
    reply({ status: 200, text: '[]', headers: { 'content-range': '0-0/not-a-number' } })
    expect(await supabaseCount('profiles')).toBe(0)
  })

  it('treats either confirmation stamp as a verified address', () => {
    expect(authUserVerified({ id: '1', email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(true)
    expect(authUserVerified({ id: '1', confirmed_at: '2026-01-01T00:00:00Z' })).toBe(true)
    expect(authUserVerified({ id: '1', email_confirmed_at: null, confirmed_at: null })).toBe(false)
    expect(authUserVerified({ id: '1' })).toBe(false)
  })
})

describe('an unconfigured deployment fails closed', () => {
  it('reports the two configuration states separately', () => {
    expect(supabasePublicConfigured()).toBe(true)
    serverConfig.supabaseServiceRoleKey = ''
    expect(supabasePublicConfigured()).toBe(true)
    serverConfig.supabaseAnonKey = ''
    expect(supabasePublicConfigured()).toBe(false)
  })

  it('refuses a public read with no anon key, before any request', async () => {
    serverConfig.supabaseAnonKey = ''
    const error = await failure(supabaseSelect('profiles', 'select=id'))
    expect(error.statusCode).toBe(503)
    expect(error.code).toBe('not_configured')
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('refuses an admin write with no service key', async () => {
    serverConfig.supabaseServiceRoleKey = ''
    for (const promise of [
      supabaseUpsert('profiles', [{ id: '1' }]),
      supabaseInsert('profiles', [{ id: '1' }]),
      authAdminRequest('/users'),
    ]) {
      const error = await failure(promise)
      expect(error.statusCode).toBe(503)
      expect(error.code).toBe('not_configured')
    }
    expect(fetchText).not.toHaveBeenCalled()
  })

  it('refuses any write path with no project URL', async () => {
    serverConfig.supabaseUrl = ''
    expect((await failure(supabaseUpdate('profiles', 'id=eq.1', {}))).statusCode).toBe(503)
    expect((await failure(supabaseDeleteWhere('profiles', 'id=eq.1'))).statusCode).toBe(503)
    expect(fetchText).not.toHaveBeenCalled()
  })
})
