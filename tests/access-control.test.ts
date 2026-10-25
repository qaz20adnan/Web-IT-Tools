import { afterEach, describe, expect, it } from 'vitest'
import { canSignIn, enforceAiAccess } from '../netlify/lib/auth'
import type { NetlifyEvent } from '../netlify/lib/http'
import { safeRedirect } from '../src/lib/redirect'
import { scopedStorageKey, setActiveStorageUser } from '../src/lib/storage'

afterEach(() => setActiveStorageUser(null))

function event(overrides: Partial<NetlifyEvent> = {}): NetlifyEvent {
  return { httpMethod: 'POST', headers: {}, body: '{}', path: '/api/test', ...overrides }
}

describe('account status gate', () => {
  it('only allows active accounts to hold a session', () => {
    expect(canSignIn('active')).toBe(true)
    expect(canSignIn('suspended')).toBe(false)
    expect(canSignIn('pending')).toBe(false)
  })
})

describe('guest rejection on protected server paths', () => {
  it('rejects AI access without a bearer token', async () => {
    await expect(enforceAiAccess(event())).rejects.toMatchObject({ statusCode: 401, code: 'unauthorized' })
  })
})

describe('post-login redirects', () => {
  it('keeps internal paths, including query strings', () => {
    expect(safeRedirect('/diagnostics?tab=ping')).toBe('/diagnostics?tab=ping')
    expect(safeRedirect('/workspace')).toBe('/workspace')
  })

  it('falls back for external, protocol-relative and malformed targets', () => {
    expect(safeRedirect('https://evil.example')).toBe('/account')
    expect(safeRedirect('//evil.example')).toBe('/account')
    expect(safeRedirect('/\\evil.example')).toBe('/account')
    expect(safeRedirect('\\\\evil.example')).toBe('/account')
    expect(safeRedirect('javascript:alert(1)')).toBe('/account')
    expect(safeRedirect('/path\\with\\backslash')).toBe('/account')
    expect(safeRedirect(null)).toBe('/account')
    expect(safeRedirect(undefined, '/login')).toBe('/login')
  })

  it('rejects control characters', () => {
    expect(safeRedirect('/account\nnext')).toBe('/account')
    expect(safeRedirect('/account\u0000')).toBe('/account')
  })
})

describe('private browser storage namespaces', () => {
  it('separates accounts and keeps guests in their own namespace', () => {
    expect(scopedStorageKey('nexora.saved.v1', 'user-a')).toBe('nexora.saved.v1.u.user-a')
    expect(scopedStorageKey('nexora.saved.v1', 'user-b')).not.toBe(scopedStorageKey('nexora.saved.v1', 'user-a'))
    expect(scopedStorageKey('nexora.saved.v1', null)).toBe('nexora.saved.v1.u.guest')
    expect(scopedStorageKey('nexora.saved.v1', '  ')).toBe('nexora.saved.v1.u.guest')
  })

  it('defaults untagged calls to the active account and never to another user', () => {
    setActiveStorageUser('user-a')
    expect(scopedStorageKey('nexora.kb.v1')).toBe('nexora.kb.v1.u.user-a')
    setActiveStorageUser('user-b')
    expect(scopedStorageKey('nexora.kb.v1')).toBe('nexora.kb.v1.u.user-b')
    setActiveStorageUser(null)
    expect(scopedStorageKey('nexora.kb.v1')).toBe('nexora.kb.v1.u.guest')
  })
})
