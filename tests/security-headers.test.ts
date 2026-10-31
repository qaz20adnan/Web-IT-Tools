import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const EXPECTED = [
  'X-Content-Type-Options',
  'X-Frame-Options',
  'Referrer-Policy',
  'Permissions-Policy',
  'Cross-Origin-Opener-Policy',
  'Content-Security-Policy',
  'Strict-Transport-Security',
] as const

function netlifyHeaders(): Map<string, string> {
  const toml = readFileSync(join(ROOT, 'netlify.toml'), 'utf8')
  const block = toml.split('[[headers]]').slice(1).find((chunk) => chunk.includes('for = "/*"'))
  if (!block) throw new Error('netlify.toml has no [[headers]] block for /*')
  const map = new Map<string, string>()
  for (const [, key, value] of block.matchAll(/^\s{4}([\w-]+) = "([^"]*)"/gm)) map.set(key, value)
  return map
}

function vercelHeaders(): Map<string, string> {
  const config = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>
  }
  const root = config.headers.find((entry) => entry.source === '/(.*)')
  if (!root) throw new Error('vercel.json has no headers entry for /(.*)')
  return new Map(root.headers.map(({ key, value }) => [key, value]))
}

describe('both hosts ship the same security headers', () => {
  it('sets every expected header on both', () => {
    for (const [host, headers] of [['netlify', netlifyHeaders()], ['vercel', vercelHeaders()]] as const) {
      for (const name of EXPECTED) expect(headers.get(name), `${host}: ${name}`).toBeTruthy()
    }
  })

  it('sends byte-identical values, so a fix to one host is not silently half-applied', () => {
    const netlify = netlifyHeaders()
    const vercel = vercelHeaders()
    for (const name of EXPECTED) expect(vercel.get(name), name).toBe(netlify.get(name))
  })

  it('keeps the CSP hardening that makes the policy worth having', () => {
    const csp = netlifyHeaders().get('Content-Security-Policy')
    expect(csp).toBeDefined()
    const directives = new Map(
      csp!.split(';').map((part) => {
        const [name, ...rest] = part.trim().split(/\s+/)
        return [name, rest.join(' ')]
      })
    )
    expect(directives.get('default-src')).toBe("'self'")
    expect(directives.get('script-src')).toBe("'self'")
    expect(directives.get('object-src')).toBe("'none'")
    expect(directives.get('base-uri')).toBe("'self'")
    expect(directives.get('form-action')).toBe("'self'")
    expect(directives.get('frame-ancestors')).toBe("'none'")
    expect(csp).not.toContain('unsafe-eval')
  })

  it('has nothing in the app that would need wss: in connect-src', () => {
    // connect-src is 'self' https: — no websocket scheme. The only known casualty is Vercel's
    // own preview Toolbar; the app itself must not grow a client that silently 403s (finding M-13).
    const sources = ['src', 'netlify', 'vercel', 'shared'].flatMap((dir) => collect(join(ROOT, dir)))
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')
      expect(/new WebSocket\(|["`]wss?:\/\//.test(text), file).toBe(false)
      expect(text, file).not.toContain('new EventSource(')
    }
  })
})

function collect(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collect(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : []
  })
}
