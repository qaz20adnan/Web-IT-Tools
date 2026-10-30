import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash, createHmac } from 'node:crypto'

// `serverConfig` is read once when netlify/lib/env is imported, so every case
// re-stubs the environment and reloads the module graph.
async function loadConfig() {
  vi.resetModules()
  const mod = await import('../netlify/lib/env')
  return mod.serverConfig
}

async function loadAuth() {
  vi.resetModules()
  return import('../netlify/lib/auth')
}

const EMAIL = 'owner+claims@example.com'
const NORMALIZED = EMAIL.toLowerCase()

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('printer probe policy is opt-in', () => {
  it('leaves the public-internet printer scanner off when the variable is unset', async () => {
    vi.stubEnv('PRINTER_ALLOW_PUBLIC', '')
    expect((await loadConfig()).printerAllowPublic).toBe(false)
  })

  it('turns on only for an explicit true', async () => {
    vi.stubEnv('PRINTER_ALLOW_PUBLIC', 'true')
    expect((await loadConfig()).printerAllowPublic).toBe(true)
    vi.stubEnv('PRINTER_ALLOW_PUBLIC', 'TRUE')
    expect((await loadConfig()).printerAllowPublic).toBe(true)
    vi.stubEnv('PRINTER_ALLOW_PUBLIC', '1')
    expect((await loadConfig()).printerAllowPublic).toBe(false)
  })
})

describe('trial claim keying requires a private pepper', () => {
  it('refuses to produce an identity digest without NEXORA_HASH_PEPPER', async () => {
    vi.stubEnv('NEXORA_HASH_PEPPER', '')
    vi.stubEnv('SUPABASE_URL', 'https://leaked-project.supabase.co')
    const { emailHash, hasHashPepper } = await loadAuth()
    expect(hasHashPepper()).toBe(false)
    expect(emailHash(EMAIL)).toBeNull()
  })

  it('never falls back to the public project URL or a hard-coded pepper', async () => {
    const url = 'https://leaked-project.supabase.co'
    vi.stubEnv('NEXORA_HASH_PEPPER', '')
    vi.stubEnv('SUPABASE_URL', url)
    const { emailHash } = await loadAuth()
    expect(emailHash(EMAIL)).toBeNull()
    // with a real pepper, the digest is the pepper's, not the project URL's
    vi.stubEnv('NEXORA_HASH_PEPPER', 'pepper-one')
    const withPepper = (await loadAuth()).emailHash(EMAIL)
    expect(withPepper).toBe(createHmac('sha256', 'pepper-one').update(NORMALIZED).digest('hex'))
    expect(withPepper).not.toBe(createHmac('sha256', url).update(NORMALIZED).digest('hex'))
  })

  it('is deterministic for one pepper and different for another', async () => {
    vi.stubEnv('NEXORA_HASH_PEPPER', 'pepper-one')
    const first = (await loadAuth()).emailHash(EMAIL)
    const sameAgain = (await loadAuth()).emailHash(EMAIL)
    expect(first).toMatch(/^[0-9a-f]{64}$/)
    expect(sameAgain).toBe(first)
    vi.stubEnv('NEXORA_HASH_PEPPER', 'pepper-two')
    expect((await loadAuth()).emailHash(EMAIL)).not.toBe(first)
  })

  it('ignores case and surrounding space, so a claim cannot be dodged by typing', async () => {
    vi.stubEnv('NEXORA_HASH_PEPPER', 'pepper-one')
    const { emailHash } = await loadAuth()
    expect(emailHash('  Owner+Claims@Example.com  ')).toBe(emailHash(EMAIL))
  })
})

describe('rate-limit bucket labels do not identify an account', () => {
  it('is a stable 24-hex label within the process', async () => {
    vi.stubEnv('NEXORA_HASH_PEPPER', 'pepper-one')
    const { emailBucketKey } = await loadAuth()
    const key = emailBucketKey(EMAIL)
    expect(key).toMatch(/^[0-9a-f]{24}$/)
    expect(emailBucketKey(` ${EMAIL.toUpperCase()} `)).toBe(key)
    expect(emailBucketKey('other@example.com')).not.toBe(key)
  })

  it('is salted, so it is neither the bare digest nor the keyed claim hash', async () => {
    vi.stubEnv('NEXORA_HASH_PEPPER', 'pepper-one')
    const { emailBucketKey, emailHash } = await loadAuth()
    const unsalted = createHash('sha256').update(NORMALIZED).digest('hex').slice(0, 24)
    expect(emailBucketKey(EMAIL)).not.toBe(unsalted)
    expect(emailBucketKey(EMAIL)).not.toBe((emailHash(EMAIL) ?? '').slice(0, 24))
  })

  it('survives a missing email without throwing', async () => {
    vi.stubEnv('NEXORA_HASH_PEPPER', '')
    const { emailBucketKey } = await loadAuth()
    expect(emailBucketKey(undefined)).toMatch(/^[0-9a-f]{24}$/)
  })
})
