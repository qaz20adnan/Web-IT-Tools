import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_SESSION_KEY,
  clearAuthHash,
  readHashValue,
  readSessionFromHash,
  readStoredSession,
  writeStoredSession,
} from '../src/services/authSession'

class MemoryStorage {
  private data = new Map<string, string>()
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  clear() {
    this.data.clear()
  }
}

function setHash(hash: string) {
  vi.stubGlobal('window', { location: { hash } })
}

describe('stored auth session', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('round-trips a valid session', () => {
    const tokens = { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1_800_000_000_000 }
    writeStoredSession(tokens)
    expect(readStoredSession()).toEqual(tokens)
  })

  it('removes the session when writing null', () => {
    writeStoredSession({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() })
    writeStoredSession(null)
    expect(localStorage.getItem(AUTH_SESSION_KEY)).toBeNull()
    expect(readStoredSession()).toBeNull()
  })

  it('rejects malformed or incomplete stored sessions', () => {
    localStorage.setItem(AUTH_SESSION_KEY, '{not-json')
    expect(readStoredSession()).toBeNull()
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ accessToken: 'a' }))
    expect(readStoredSession()).toBeNull()
    localStorage.setItem(
      AUTH_SESSION_KEY,
      JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: 'never' }),
    )
    expect(readStoredSession()).toBeNull()
  })
})

describe('implicit-flow URL fragments', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses access and refresh tokens with expires_at seconds', () => {
    setHash('#access_token=abc&refresh_token=def&expires_at=1800000000&type=signup')
    expect(readSessionFromHash()).toEqual({
      accessToken: 'abc',
      refreshToken: 'def',
      expiresAt: 1_800_000_000_000,
    })
    expect(readHashValue('type')).toBe('signup')
  })

  it('falls back to expires_in when expires_at is missing', () => {
    setHash('#access_token=abc&refresh_token=def&expires_in=120')
    const before = Date.now()
    const session = readSessionFromHash()
    expect(session?.accessToken).toBe('abc')
    expect(session?.expiresAt).toBeGreaterThanOrEqual(before + 119_000)
    expect(session?.expiresAt).toBeLessThanOrEqual(Date.now() + 121_000)
  })

  it('defaults to one hour for unusable expiry values', () => {
    setHash('#access_token=abc&refresh_token=def&expires_at=nope&expires_in=-5')
    const before = Date.now()
    const session = readSessionFromHash()
    expect(session?.expiresAt).toBeGreaterThanOrEqual(before + 3_599_000)
    expect(session?.expiresAt).toBeLessThanOrEqual(Date.now() + 3_601_000)
  })

  it('clears the fragment without dropping the path or query', () => {
    const replaceState = vi.fn()
    vi.stubGlobal('window', {
      location: { hash: '#access_token=a&refresh_token=b', pathname: '/reset-password', search: '?ready=1' },
      history: { replaceState },
    })
    clearAuthHash()
    expect(replaceState).toHaveBeenCalledWith(null, '', '/reset-password?ready=1')
  })

  it('ignores fragments without both tokens', () => {
    setHash('#access_token=abc&type=signup')
    expect(readSessionFromHash()).toBeNull()
    setHash('#error=access_denied&error_description=nope')
    expect(readSessionFromHash()).toBeNull()
    setHash('')
    expect(readSessionFromHash()).toBeNull()
  })
})
