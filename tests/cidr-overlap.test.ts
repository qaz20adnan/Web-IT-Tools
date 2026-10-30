import { describe, expect, it } from 'vitest'
import { addressInCidr, analyzeCidrText, analyzeCidrs, canonicalCidr, parseCidrBlock, parseCidrText } from '@/lib/cidrGroups'

const kindsOf = (inputs: Parameters<typeof analyzeCidrs>[0]) => analyzeCidrs(inputs).findings.map((finding) => finding.kind)

describe('CIDR parsing', () => {
  it('accepts a prefix and a bare host', () => {
    expect(parseCidrBlock('10.0.0.5/24')).toMatchObject({ prefix: 24 })
    expect(parseCidrBlock('10.0.0.5')).toMatchObject({ prefix: 32 })
  })

  it('rejects malformed blocks', () => {
    expect(parseCidrBlock('10.0.0/24')).toMatchObject({ reason: 'address' })
    expect(parseCidrBlock('10.0.0.0/33')).toMatchObject({ reason: 'range' })
    expect(parseCidrBlock('10.0.0.0/abc')).toMatchObject({ reason: 'prefix' })
    expect(parseCidrBlock('')).toMatchObject({ reason: 'empty' })
  })

  it('canonicalises a misaligned block', () => {
    expect(canonicalCidr('10.0.0.5/24')).toBe('10.0.0.0/24')
    expect(addressInCidr('10.0.0.9', '10.0.0.5/24')).toBe(true)
    expect(addressInCidr('10.0.1.9', '10.0.0.0/24')).toBe(false)
  })

  it('splits pasted lines into fields', () => {
    const parsed = parseCidrText('# comment\n10.0.0.0/24, Servers, 10.0.0.1, 10.0.0.53 10.0.0.54\n10.0.1.0/24 Users')
    expect(parsed).toHaveLength(2)
    expect(parsed[0]).toMatchObject({ line: 2, cidr: '10.0.0.0/24', name: 'Servers', gateway: '10.0.0.1', dns: ['10.0.0.53', '10.0.0.54'] })
    expect(parsed[1]).toMatchObject({ cidr: '10.0.1.0/24', name: 'Users', gateway: null, dns: [] })
  })
})

describe('overlap detection', () => {
  it('flags containment', () => {
    const analysis = analyzeCidrs([{ cidr: '10.0.0.0/8', name: 'WAN' }, { cidr: '10.1.0.0/16', name: 'Lab' }])
    expect(analysis.overlaps).toHaveLength(1)
    expect(analysis.overlaps[0].kind).toBe('containment')
    expect(analysis.passed).toBe(false)
    expect(analysis.clusters).toEqual([['net-1', 'net-2']])
  })

  it('flags partial overlap only when a block is misaligned', () => {
    const analysis = analyzeCidrs([{ cidr: '10.0.1.128/24' }, { cidr: '10.0.2.0/24' }])
    expect(analysis.overlaps).toHaveLength(1)
    expect(analysis.overlaps[0].kind).toBe('partial')
    expect(analysis.overlaps[0].sharedSize).toBe(128)
    expect(analysis.overlaps[0].sharedTo - analysis.overlaps[0].sharedFrom).toBe(127)
    expect(analysis.findings.map((finding) => finding.kind)).toContain('misaligned')
  })

  it('flags identical networks', () => {
    expect(kindsOf([{ cidr: '192.168.9.0/24' }, { cidr: '192.168.9.0/24' }])).toContain('identical')
  })

  it('does not flag adjacent networks', () => {
    const analysis = analyzeCidrs([{ cidr: '10.0.1.0/24' }, { cidr: '10.0.2.0/24' }])
    expect(analysis.overlaps).toHaveLength(0)
    expect(analysis.findings).toHaveLength(0)
    expect(analysis.passed).toBe(true)
  })

  it('handles /31 point-to-point links', () => {
    const adjacent = analyzeCidrs([{ cidr: '10.0.0.0/31' }, { cidr: '10.0.0.2/31' }])
    expect(adjacent.overlaps).toHaveLength(0)
    expect(adjacent.findings).toHaveLength(0)

    const nested = analyzeCidrs([{ cidr: '10.0.0.0/31' }, { cidr: '10.0.0.1/32' }])
    expect(nested.overlaps[0].kind).toBe('containment')
  })

  it('treats both addresses of a /31 as usable', () => {
    const analysis = analyzeCidrs([{ cidr: '10.0.0.0/31', gateway: '10.0.0.0', dns: ['10.0.0.1'] }])
    expect(analysis.findings.map((finding) => finding.kind)).not.toContain('address-reserved')
  })

  it('treats a /32 host route as its own network', () => {
    const analysis = analyzeCidrs([{ cidr: '10.0.0.7/32', gateway: '10.0.0.7' }, { cidr: '10.0.1.0/24' }])
    expect(analysis.findings).toHaveLength(0)
    expect(analysis.passed).toBe(true)
  })

  it('reports a misaligned network and its canonical form', () => {
    const analysis = analyzeCidrs([{ cidr: '10.0.0.5/24' }])
    expect(analysis.networks[0]).toMatchObject({ cidr: '10.0.0.0/24', aligned: false, size: 256 })
    expect(analysis.findings[0]).toMatchObject({ kind: 'misaligned', severity: 'error' })
  })

  it('treats the default route as a note, not an overlap with everything', () => {
    const analysis = analyzeCidrs([{ cidr: '0.0.0.0/0' }, { cidr: '10.0.0.0/24' }])
    expect(analysis.overlaps).toHaveLength(0)
    expect(analysis.findings.map((finding) => finding.kind)).toEqual(['default-route'])
    expect(analysis.passed).toBe(true)
  })
})

describe('address checks', () => {
  it('flags a gateway outside its own subnet', () => {
    expect(kindsOf([{ cidr: '192.168.1.0/24', gateway: '192.168.9.1' }])).toContain('address-outside')
  })

  it('flags network and broadcast addresses in use', () => {
    const found = kindsOf([
      { cidr: '192.168.1.0/24', gateway: '192.168.1.0' },
      { cidr: '192.168.2.0/24', dns: ['192.168.2.255'] },
    ])
    expect(found.filter((kind) => kind === 'address-reserved')).toHaveLength(2)
  })

  it('flags the same address used by two subnets', () => {
    const analysis = analyzeCidrs([
      { cidr: '10.10.0.0/24', gateway: '10.10.0.1' },
      { cidr: '10.10.1.0/24', gateway: '10.10.0.1' },
    ])
    expect(analysis.findings.map((finding) => finding.kind)).toContain('duplicate-address')
  })

  it('warns when an address belongs to a foreign subnet', () => {
    const analysis = analyzeCidrs([
      { cidr: '172.16.0.0/24', gateway: '172.16.0.1' },
      { cidr: '172.16.1.0/24', dns: ['172.16.0.53'] },
    ])
    expect(analysis.findings.map((finding) => finding.kind)).toContain('foreign-address')
  })

  it('rejects a non-address gateway value', () => {
    expect(kindsOf([{ cidr: '10.0.0.0/24', gateway: '10.0.0' }])).toContain('invalid')
  })
})

describe('summary', () => {
  it('passes a clean plan', () => {
    const analysis = analyzeCidrText('10.0.0.0/24, LAN-A, 10.0.0.1\n10.0.1.0/24, LAN-B, 10.0.1.1\n10.0.2.0/30, WAN, 10.0.2.1')
    expect(analysis.networks).toHaveLength(3)
    expect(analysis.errorCount).toBe(0)
    expect(analysis.passed).toBe(true)
  })

  it('counts errors when the plan conflicts', () => {
    const analysis = analyzeCidrText('10.0.0.0/8, Core\n10.0.5.0/24, Servers, 10.9.9.1\n10.0.6.5/24, Storage')
    expect(analysis.errorCount).toBeGreaterThan(0)
    expect(analysis.warningCount).toBe(0)
    expect(analysis.passed).toBe(false)
  })

  it('reports invalid lines without dropping the rest', () => {
    const analysis = analyzeCidrText('10.0.0.0/24\nbanana/24\n10.0.1.0/24')
    expect(analysis.networks).toHaveLength(2)
    expect(analysis.invalid).toHaveLength(1)
    expect(analysis.invalid[0].reason).toBe('address')
  })
})
