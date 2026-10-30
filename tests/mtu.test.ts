import { describe, expect, it } from 'vitest'
import { ENCAP_PROFILES, MIN_IPV4_MTU, computeMtu, profileFor } from '@/lib/mtu'

const overheadOf = (encap: Parameters<typeof computeMtu>[0]['encap'], linkMtu = 1500) => computeMtu({ linkMtu, encap }).overhead

describe('encapsulation overhead table', () => {
  it('matches the standard numbers on a 1500 byte link', () => {
    expect(overheadOf('none')).toBe(0)
    expect(overheadOf('pppoe')).toBe(8)
    expect(overheadOf('gre')).toBe(24)
    expect(overheadOf('gre-key')).toBe(28)
    expect(overheadOf('vxlan')).toBe(50)
    expect(overheadOf('wireguard')).toBe(60)
    expect(overheadOf('ipsec-transport')).toBe(54)
    expect(overheadOf('ipsec-tunnel')).toBe(74)
    expect(overheadOf('ipsec-tunnel-natt')).toBe(86)
    expect(overheadOf('6in4')).toBe(20)
  })

  it('derives the payload MTU from the base interface', () => {
    expect(computeMtu({ linkMtu: 1500, encap: 'vxlan' }).payloadMtu).toBe(1450)
    expect(computeMtu({ linkMtu: 1500, encap: 'pppoe' }).payloadMtu).toBe(1492)
    expect(computeMtu({ linkMtu: 1500, encap: 'gre' }).payloadMtu).toBe(1476)
    expect(computeMtu({ linkMtu: 1500, encap: 'wireguard' }).payloadMtu).toBe(1440)
    expect(computeMtu({ linkMtu: 9000, encap: 'vxlan' }).payloadMtu).toBe(8950)
  })

  it('grows the overhead when the underlay is IPv6', () => {
    expect(overheadOf('vxlan', 1500)).toBe(50)
    expect(computeMtu({ linkMtu: 1500, encap: 'vxlan', underlay: 'ipv6' }).overhead).toBe(70)
    expect(computeMtu({ linkMtu: 1500, encap: 'gre', underlay: 'ipv6' }).payloadMtu).toBe(1456)
  })

  it('keeps 6in4 on an IPv4 underlay whatever the selector says', () => {
    const result = computeMtu({ linkMtu: 1500, encap: '6in4', underlay: 'ipv6' })
    expect(result.underlay).toBe('ipv4')
    expect(result.overhead).toBe(20)
  })

  it('sums the parts it lists', () => {
    for (const profile of ENCAP_PROFILES) {
      for (const underlay of ['ipv4', 'ipv6'] as const) {
        const parts = profile.parts(underlay)
        expect(parts.reduce((total, part) => total + part.bytes, 0)).toBe(computeMtu({ linkMtu: 1500, encap: profile.id, underlay }).overhead)
      }
    }
  })
})

describe('MSS', () => {
  it('subtracts 40 for IPv4/TCP and 60 for IPv6/TCP', () => {
    expect(computeMtu({ linkMtu: 1500, encap: 'none', innerFamily: 'ipv4' }).mss).toBe(1460)
    expect(computeMtu({ linkMtu: 1500, encap: 'none', innerFamily: 'ipv6' }).mss).toBe(1440)
    expect(computeMtu({ linkMtu: 1500, encap: 'vxlan', innerFamily: 'ipv4' }).mss).toBe(1410)
    expect(computeMtu({ linkMtu: 1500, encap: '6in4', innerFamily: 'ipv6' }).mss).toBe(1420)
  })

  it('offers a clamp command when MSS clamping is on', () => {
    const clamped = computeMtu({ linkMtu: 1500, encap: 'vxlan', mssClamp: true })
    expect(clamped.commands.join(' ')).toContain('--clamp-mss-to-pmtu')
    const explicit = computeMtu({ linkMtu: 1500, encap: 'vxlan', mssClamp: false })
    expect(explicit.commands.join(' ')).toContain('--set-mss 1410')
  })
})

describe('floors and symptoms', () => {
  it('never returns a payload MTU below the IPv4 minimum of 68', () => {
    const result = computeMtu({ linkMtu: 100, encap: '6in4' })
    expect(result.payloadMtu).toBe(80)
    expect(result.floorApplied).toBe(false)

    const tiny = computeMtu({ linkMtu: 60, encap: '6in4' })
    expect(tiny.payloadMtu).toBe(40)
    expect(tiny.effectiveMtu).toBe(MIN_IPV4_MTU)
    expect(tiny.floorApplied).toBe(true)
    expect(tiny.mss).toBe(28)
    expect(tiny.findings.map((finding) => finding.kind)).toContain('below-ipv4-minimum')
  })

  it('flags an encapsulation larger than the link', () => {
    const result = computeMtu({ linkMtu: 576, encap: 'ipsec-tunnel-natt' })
    expect(result.payloadMtu).toBe(490)
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].kind).toBe('mss-below-536')
  })

  it('warns when IPv6 traffic cannot meet the 1280 minimum', () => {
    const result = computeMtu({ linkMtu: 1280, encap: 'vxlan', innerFamily: 'ipv6' })
    expect(result.findings.map((finding) => finding.kind)).toContain('below-ipv6-minimum')
  })

  it('detects a configured tunnel MTU above what the link delivers', () => {
    const result = computeMtu({ linkMtu: 1500, encap: 'vxlan', configuredMtu: 1500 })
    const finding = result.findings.find((entry) => entry.kind === 'configured-above-available')
    expect(finding).toBeDefined()
    expect(finding?.values).toMatchObject({ configured: 1500, available: 1450 })
  })

  it('stays quiet when the configured MTU fits', () => {
    expect(computeMtu({ linkMtu: 1500, encap: 'vxlan', configuredMtu: 1400 }).findings).toHaveLength(0)
  })
})

describe('profiles', () => {
  it('every profile documents its assumptions', () => {
    for (const profile of ENCAP_PROFILES) {
      expect(profile.assumptions.length).toBeGreaterThan(0)
      for (const assumption of profile.assumptions) {
        expect(assumption.en.length).toBeGreaterThan(10)
        expect(assumption.ar.length).toBeGreaterThan(10)
      }
    }
  })

  it('falls back to no encapsulation for an unknown id', () => {
    expect(profileFor('nope' as never).id).toBe('none')
  })
})
