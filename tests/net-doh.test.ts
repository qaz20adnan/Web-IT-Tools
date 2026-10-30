import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeDnsName, pointerName, resolveDoh } from '../netlify/lib/net-doh'

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DNS name handling', () => {
  it('accepts service labels that a connect target would reject', () => {
    expect(normalizeDnsName('_DMARC.example.com.')).toBe('_dmarc.example.com')
    expect(normalizeDnsName('_smtp._tls.example.com')).toBe('_smtp._tls.example.com')
  })

  it('rejects URLs, whitespace, and over-long names', () => {
    expect(() => normalizeDnsName('https://example.com/a')).toThrow(/not a URL/)
    expect(() => normalizeDnsName('two words')).toThrow()
    expect(() => normalizeDnsName('x'.repeat(260))).toThrow()
    expect(() => normalizeDnsName('')).toThrow()
  })
})

describe('reverse-DNS names', () => {
  it('reverses IPv4 octets', () => {
    expect(pointerName('192.0.2.38')).toBe('38.2.0.192.in-addr.arpa')
  })

  it('expands a compressed IPv6 address into all 32 nibbles', () => {
    const name = pointerName('2001:db8::1') ?? ''
    expect(name.endsWith('.ip6.arpa')).toBe(true)
    expect(name.replace('.ip6.arpa', '').split('.')).toHaveLength(32)
    expect(name).toBe('1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa')
  })

  it('refuses malformed IPv6 instead of guessing', () => {
    expect(pointerName('2001:db8:::1')).toBeNull()
    expect(pointerName('not-an-address')).toBeNull()
  })
})

describe('DoH resolution', () => {
  it('reports real TTLs and treats NXDOMAIN as an answer, not an error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('cloudflare-dns.com')) {
        return jsonResponse({ Status: 0, Answer: [{ name: 'example.com.', type: 1, TTL: 250, data: '93.184.216.34' }] })
      }
      return jsonResponse({ Status: 3 })
    }))
    const [cloudflare, google] = await resolveDoh('example.com', 'A')
    expect(cloudflare.outcome).toBe('answered')
    expect(cloudflare.answers[0]).toMatchObject({ ttl: 250, data: '93.184.216.34' })
    expect(google.outcome).toBe('nxdomain')
    expect(google.errorCode).toBeNull()
  })

  it('surfaces a fixed code when the resolver itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, false, 503)))
    const [result] = await resolveDoh('example.com', 'A', ['cloudflare'])
    expect(result.outcome).toBe('error')
    expect(result.errorCode).toBe('resolver-http-503')
  })

  it('never forwards a transport message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('getaddrinfo EAI_AGAIN cloudflare-dns.com')
    }))
    const [result] = await resolveDoh('example.com', 'A', ['cloudflare'])
    expect(result.outcome).toBe('error')
    expect(result.errorCode).toBe('resolver-unavailable')
  })

  it('unwraps the quoted TXT payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      Status: 0,
      Answer: [{ name: '_dmarc.example.com.', type: 16, TTL: 300, data: '"v=DMARC1\\; p=reject\\;"' }],
    })))
    const [result] = await resolveDoh('_dmarc.example.com', 'TXT', ['cloudflare'])
    expect(result.answers[0].data).toBe('v=DMARC1; p=reject;')
  })
})
