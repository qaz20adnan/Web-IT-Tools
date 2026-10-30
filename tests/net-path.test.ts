import { afterEach, describe, expect, it, vi } from 'vitest'
import { probePath, zoneCandidates } from '../netlify/lib/net-path'

const TRACE_TEXT = 'ip=52.1.2.3\ncolo=CDG\ngateway=off\nloc=FR\ntls=1.3\n'
const IPWHO_BODY = {
  success: true,
  connection: { asn: 16509, org: 'Amazon.com, Inc.', isp: 'AWS', domain: 'amazon.com' },
  country: 'France',
  region: 'Île-de-France',
  city: 'Paris',
}

function stubDns(table: Record<string, unknown>, status = 0) {
  const handler = vi.fn(async (raw: string) => {
    const url = new URL(raw)
    if (url.pathname.endsWith('/trace')) {
      return { ok: true, status: 200, text: async () => TRACE_TEXT, json: async () => ({}) } as unknown as Response
    }
    if (url.hostname === 'ipwho.is') {
      return { ok: true, status: 200, json: async () => IPWHO_BODY, text: async () => '' } as unknown as Response
    }
    const resolver = url.hostname.includes('google') ? 'gg' : 'cf'
    const name = url.searchParams.get('name')
    const type = url.searchParams.get('type')
    const answers = table[`${resolver}|${name}|${type}`] ?? table[`${name}|${type}`]
    return { ok: true, status: 200, json: async () => ({ Status: status, Answer: answers }), text: async () => '' } as unknown as Response
  })
  vi.stubGlobal('fetch', handler)
  return handler
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('path intelligence', () => {
  it('separates the CNAME chain from the address it points at', async () => {
    stubDns({
      'example.com|1': [
        { name: 'example.com', type: 5, TTL: 300, data: 'cdn.example.net.' },
        { name: 'cdn.example.net', type: 1, TTL: 60, data: '93.184.216.34' },
      ],
      'example.com|28': [],
      'example.com|2': [{ name: 'example.com', type: 2, TTL: 40000, data: 'a.iana-servers.net.' }],
      'example.com|6': [{ name: 'example.com', type: 6, TTL: 3600, data: 'ns1.example.com. hostmaster.example.com. 2026010101 3600 600 604800 300' }],
      '34.216.184.93.in-addr.arpa|12': [{ name: '34.216.184.93.in-addr.arpa', type: 12, TTL: 600, data: 'edge.example.net.' }],
    })
    const result = await probePath('example.com')
    expect(result.addresses.v4).toEqual(['93.184.216.34'])
    expect(result.canonicalName).toEqual(['cdn.example.net'])
    expect(result.authority.nameservers).toEqual(['a.iana-servers.net'])
    expect(result.authority.soaSerial).toBe('2026010101')
    expect(result.authority.soaRefresh).toBe(3600)
    expect(result.reverse[0]).toMatchObject({ address: '93.184.216.34', names: ['edge.example.net'], outcome: 'answered' })
    expect(result.ownership).toMatchObject({ asn: 'AS16509', country: 'France', errorCode: null })
    expect(result.probeOrigin.pointOfPresence).toBe('CDG')
  })

  it('walks up to the zone that is actually authoritative for a sub-name', async () => {
    stubDns({
      'learn.microsoft.com|1': [{ name: 'learn.microsoft.com', type: 5, TTL: 60, data: 'learn.microsoft.com.edgekey.net.' }],
      'microsoft.com|2': [
        { name: 'microsoft.com', type: 2, TTL: 172800, data: 'ns3-05.azure-dns.info.' },
        { name: 'microsoft.com', type: 2, TTL: 172800, data: 'ns1-05.azure-dns.com.' },
      ],
      'microsoft.com|6': [{ name: 'microsoft.com', type: 6, TTL: 3600, data: 'ns1-05.azure-dns.com. hostmaster.microsoft.com. 2026100101 3600 600 604800 300' }],
    })
    const result = await probePath('learn.microsoft.com')
    expect(result.authority.zone).toBe('microsoft.com')
    expect(result.authority.nameservers).toEqual(['ns1-05.azure-dns.com', 'ns3-05.azure-dns.info'])
    expect(result.authority.soaSerial).toBe('2026100101')
    expect(result.authority.soaRefresh).toBe(3600)
  })

  it('names a zone candidate no deeper than the registered name', () => {
    expect(zoneCandidates('a.b.example.com')).toEqual(['a.b.example.com', 'b.example.com', 'example.com'])
    expect(zoneCandidates('example.com')).toEqual(['example.com'])
  })

  it('flags when two public resolvers give different answers', async () => {
    stubDns({
      'cf|old.example.com|1': [{ name: 'old.example.com', type: 1, TTL: 30, data: '198.51.100.7' }],
    })
    const result = await probePath('old.example.com')
    expect(result.crossResolver.map((entry) => entry.outcome)).toEqual(['answered', 'no-data'])
    expect(result.disagreement).toBe(true)
    expect(result.crossResolver[0].lowestTtl).toBe(30)
  })

  it('reports an IP target without querying records for it', async () => {
    const handler = stubDns({})
    const result = await probePath('198.51.100.9')
    expect(result.addresses.v4).toEqual(['198.51.100.9'])
    expect(result.authority.nameservers).toEqual([])
    const queriedNames = handler.mock.calls.map((call) => new URL(String(call[0])).searchParams.get('name')).filter(Boolean)
    expect(queriedNames).not.toContain('198.51.100.9')
    expect(queriedNames).toContain('9.100.51.198.in-addr.arpa')
  })

  it('keeps a total resolution failure honest', async () => {
    stubDns({}, 3)
    const result = await probePath('missing.example')
    expect(result.addresses.v4).toEqual([])
    expect(result.disagreement).toBe(false)
    expect(result.crossResolver.every((entry) => entry.outcome === 'nxdomain')).toBe(true)
  })
})
