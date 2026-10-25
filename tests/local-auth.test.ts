import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LOCAL_PASSWORD_MAX_LENGTH,
  changeLocalPassword,
  deleteLocalAccount,
  localAccountForAccessToken,
  localAuthEnabled,
  loginLocalAccount,
  logoutLocalSession,
  refreshLocalSession,
  registerLocalAccount,
} from '../netlify/lib/local-auth'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nexora-local-auth-'))
  vi.stubEnv('NEXORA_LOCAL_AUTH', '1')
  vi.stubEnv('NEXORA_LOCAL_AUTH_DIR', dir)
  vi.stubEnv('NODE_ENV', 'development')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  await rm(dir, { recursive: true, force: true })
})

async function register(password = 'abc') {
  return registerLocalAccount({
    username: 'adnan_92',
    email: 'adnan@example.com',
    password,
  })
}

describe('local development authentication', () => {
  it('registers a short password without a minimum length and stores only a scrypt hash', async () => {
    const { account, tokens } = await register('abc')

    expect(account.email).toBe('adnan@example.com')
    expect(account.role).toBe('standard_member')
    expect(account.status).toBe('active')
    expect(tokens.accessToken).toBeTruthy()
    expect(tokens.refreshToken).toBeTruthy()

    const stored = await readFile(join(dir, 'store.json'), 'utf8')
    expect(stored).not.toContain('"password": "abc"')
    expect(stored).not.toContain('"abc"')
    expect(stored).toContain('"algorithm": "scrypt"')
    expect(stored).not.toContain(tokens.accessToken)
    expect(stored).not.toContain(tokens.refreshToken)
  })

  it('signs in with the correct password and rejects a wrong one', async () => {
    await register('short')

    const session = await loginLocalAccount('ADNAN@example.com', 'short')
    expect(await localAccountForAccessToken(session.tokens.accessToken)).toMatchObject({
      email: 'adnan@example.com',
    })

    await expect(loginLocalAccount('adnan@example.com', 'wrong')).rejects.toMatchObject({
      statusCode: 401,
      code: 'invalid_credentials',
    })
  })

  it('rejects a duplicate email case-insensitively', async () => {
    await register('short')
    await expect(
      registerLocalAccount({ username: 'other', email: 'ADNAN@EXAMPLE.COM', password: 'another' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'already_exists' })
  })

  it('rotates and revokes sessions on refresh and logout', async () => {
    const { tokens } = await register('short')

    const refreshed = await refreshLocalSession(tokens.refreshToken)
    expect(refreshed.tokens.accessToken).not.toBe(tokens.accessToken)
    expect(await localAccountForAccessToken(tokens.accessToken)).toBeNull()
    expect(await localAccountForAccessToken(refreshed.tokens.accessToken)).not.toBeNull()

    await logoutLocalSession(refreshed.tokens.accessToken)
    expect(await localAccountForAccessToken(refreshed.tokens.accessToken)).toBeNull()
    await expect(refreshLocalSession(refreshed.tokens.refreshToken)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('keeps sessions valid across a fresh store read', async () => {
    const { tokens } = await register('short')
    const stored = await readFile(join(dir, 'store.json'), 'utf8')
    expect(stored).toContain('accessHash')
    expect(await localAccountForAccessToken(tokens.accessToken)).not.toBeNull()
  })

  it('changes and verifies the password without silent truncation', async () => {
    const { account, tokens } = await register('short')

    await changeLocalPassword(account.id, 'short', 'x')
    await expect(loginLocalAccount('adnan@example.com', 'short')).rejects.toMatchObject({ statusCode: 401 })
    await expect(loginLocalAccount('adnan@example.com', 'x')).resolves.toBeTruthy()
    expect(await localAccountForAccessToken(tokens.accessToken)).not.toBeNull()
  })

  it('rejects only passwords above the documented technical maximum', async () => {
    await expect(register('x'.repeat(LOCAL_PASSWORD_MAX_LENGTH + 1))).rejects.toMatchObject({
      statusCode: 400,
      code: 'invalid_input',
    })
  })

  it('deletes the account and its sessions', async () => {
    const { account, tokens } = await register('short')
    await deleteLocalAccount(account.id, 'short')
    expect(await localAccountForAccessToken(tokens.accessToken)).toBeNull()
    await expect(loginLocalAccount('adnan@example.com', 'short')).rejects.toMatchObject({ statusCode: 401 })
  })

  it('serves the full auth API locally without any network fetch', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network access is not allowed in this test')
    })
    vi.stubGlobal('fetch', fetchSpy)
    const { handler } = await import('../netlify/functions/auth')

    const call = async (body: unknown, accessToken?: string) => {
      const response = await handler(
        {
          httpMethod: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(body),
          path: '/api/auth',
          isBase64Encoded: false,
        },
        { ip: '10.20.30.40' },
      )
      return { status: response.statusCode, body: JSON.parse(response.body) as Record<string, unknown> }
    }

    const configResponse = await handler(
      { httpMethod: 'GET', headers: {}, body: null, path: '/api/auth' },
      { ip: '10.20.30.40' },
    )
    expect(configResponse.statusCode).toBe(200)
    expect(JSON.parse(configResponse.body)).toMatchObject({
      configured: true,
      provider: 'local',
      localMode: true,
      passwordMinLength: 1,
    })

    const registration = await call({
      action: 'register',
      username: 'local_user',
      email: 'local@example.com',
      password: '1',
    })
    expect(registration.status).toBe(200)
    const tokens = registration.body.tokens as { accessToken: string; refreshToken: string }

    const me = await call({ action: 'me' }, tokens.accessToken)
    expect(me.status).toBe(200)
    expect(me.body.account).toMatchObject({
      profile: { email: 'local@example.com', role: 'standard_member', emailVerified: true },
    })

    const wrongLogin = await call({ action: 'login', email: 'local@example.com', password: 'wrong' })
    expect(wrongLogin.status).toBe(401)

    const login = await call({ action: 'login', email: 'local@example.com', password: '1' })
    expect(login.status).toBe(200)

    const logout = await call({ action: 'logout' }, tokens.accessToken)
    expect(logout.status).toBe(200)
    expect((await call({ action: 'me' }, tokens.accessToken)).status).toBe(401)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is disabled in production and on serverless platforms', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(localAuthEnabled()).toBe(false)

    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'nexora')
    expect(localAuthEnabled()).toBe(false)

    vi.unstubAllEnvs()
    vi.stubEnv('NEXORA_LOCAL_AUTH_DIR', dir)
    vi.stubEnv('NEXORA_LOCAL_AUTH', '1')
    vi.stubEnv('NODE_ENV', 'development')
    expect(localAuthEnabled()).toBe(true)
  })
})
