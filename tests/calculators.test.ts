import { describe, expect, it } from 'vitest'
import {
  assessRecovery,
  backupEstimate,
  certStatus,
  classifyIPv6,
  classifyIPv4,
  compressIPv6,
  expandIPv6,
  formatDuration,
  hasAmbiguousOctet,
  ipv4ToNumber,
  numberToIPv4,
  parseIPv4,
  raidCapacity,
  subnetInfo,
  transferSeconds,
} from '@/lib/calculators'

describe('IPv4 helpers', () => {
  it('parses valid addresses and rejects invalid ones', () => {
    expect(parseIPv4('192.168.1.10')).toEqual([192, 168, 1, 10])
    expect(parseIPv4('256.1.1.1')).toBeNull()
    expect(parseIPv4('not-an-ip')).toBeNull()
  })

  it('rejects leading-zero octets instead of reading them as octal', () => {
    expect(parseIPv4('010.1.1.1')).toBeNull()
    expect(parseIPv4('192.168.00.1')).toBeNull()
    expect(parseIPv4('0.0.0.0')).toEqual([0, 0, 0, 0])
    expect(hasAmbiguousOctet('010.1.1.1')).toBe(true)
    expect(hasAmbiguousOctet('10.1.1.1')).toBe(false)
    expect(subnetInfo('010.1.1.1', 24)).toBeNull()
  })

  it('round-trips addresses through numbers', () => {
    const bytes = parseIPv4('10.20.30.40')
    expect(bytes).not.toBeNull()
    expect(numberToIPv4(ipv4ToNumber(bytes!))).toBe('10.20.30.40')
  })

  it('computes a /24 subnet', () => {
    const result = subnetInfo('192.168.1.10', 24)
    expect(result).not.toBeNull()
    expect(result!.network).toBe('192.168.1.0')
    expect(result!.broadcast).toBe('192.168.1.255')
    expect(result!.firstHost).toBe('192.168.1.1')
    expect(result!.lastHost).toBe('192.168.1.254')
    expect(result!.usableHosts).toBe(254)
    expect(result!.scope).toBe('private')
  })

  it('rejects a missing or out-of-range prefix', () => {
    expect(subnetInfo('192.168.1.10', Number.NaN)).toBeNull()
    expect(subnetInfo('192.168.1.10', 33)).toBeNull()
    expect(subnetInfo('192.168.1.10', 2.5)).toBeNull()
    expect(subnetInfo('192.168.1.10', 0)?.prefix).toBe(0)
  })

  it('classifies special ranges', () => {
    expect(classifyIPv4(ipv4ToNumber([127, 0, 0, 1]), 8)).toBe('loopback')
    expect(classifyIPv4(ipv4ToNumber([169, 254, 1, 1]), 16)).toBe('link-local')
    expect(classifyIPv4(ipv4ToNumber([8, 8, 8, 8]), 24)).toBe('public')
  })
})

describe('IPv6 helpers', () => {
  it('expands and compresses an address', () => {
    const expanded = expandIPv6('2001:db8::1')
    expect(expanded).toBe('2001:0db8:0000:0000:0000:0000:0000:0001')
    expect(compressIPv6(expanded!)).toBe('2001:db8::1')
    expect(classifyIPv6(expanded!)).toBe('documentation')
  })

  it('handles loopback and rejects malformed input', () => {
    expect(expandIPv6('::1')).toBe('0000:0000:0000:0000:0000:0000:0000:0001')
    expect(classifyIPv6(expandIPv6('::1')!)).toBe('loopback')
    expect(expandIPv6('2001:db8:::1')).toBeNull()
  })
})

describe('capacity helpers', () => {
  it('computes transfer time from a binary GiB payload over a decimal Mbps link', () => {
    const seconds = transferSeconds(10, 1000, 0)
    expect(seconds).toBeCloseTo(85.899, 2)
    expect(transferSeconds(10, 1000, 0)).toBeCloseTo((10 * 1024 ** 3 * 8) / 1_000_000_000, 3)
    expect(transferSeconds(0, 1000, 0)).toBeNull()
    expect(transferSeconds(Number.NaN, 1000, 0)).toBeNull()
    expect(transferSeconds(10, 1000, 100)).toBeNull()
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(3661)).toBe('1h 1m 1s')
    expect(formatDuration(-1)).toBeTruthy()
  })

  it('applies RAID capacity rules and reports guaranteed fault tolerance', () => {
    expect(raidCapacity('5', 4, 2)).toMatchObject({ usableTB: 6, tolerance: 1, bestCaseTolerance: 1 })
    expect(raidCapacity('6', 6, 2)).toMatchObject({ usableTB: 8, tolerance: 2, bestCaseTolerance: 2 })
    expect(raidCapacity('10', 4, 2)).toMatchObject({ usableTB: 4, tolerance: 1, bestCaseTolerance: 2 })
    expect(raidCapacity('10', 8, 2)).toMatchObject({ tolerance: 1, bestCaseTolerance: 4 })
    expect(raidCapacity('1', 4, 2)).toBeNull()
    expect(raidCapacity('5', 2, 2)).toBeNull()
  })

  it('estimates backup storage and recovery warnings', () => {
    const backup = backupEstimate(1000, 10, 30, 0)
    expect(backup).not.toBeNull()
    expect(backup!.dailyChangeGB).toBe(100)
    expect(backup!.fullCopies).toBe(5)
    expect(backup!.incrementGB).toBe(3000)
    expect(backup!.peakGB).toBeCloseTo(8000, 6)

    // Growth is applied once across the series: (5 x 1000 full + 3000 incremental) x 1.2^(30/365).
    const grown = backupEstimate(1000, 10, 30, 20)
    expect(grown!.growthFactor).toBeCloseTo(1.015098, 6)
    expect(grown!.incrementGB).toBe(3000)
    expect(grown!.peakGB).toBeCloseTo(8120.785, 3)
    expect(backupEstimate(1000, 10, 30, Number.NaN)).toBeNull()

    const recovery = assessRecovery([
      { id: '1', system: 'Domain controllers', tier: '0', rpoHours: 2, rtoHours: 6 },
      { id: '2', system: 'File server', tier: '1', rpoHours: 24, rtoHours: 8 },
    ])
    expect(recovery.tier0Count).toBe(1)
    expect(recovery.warnings.length).toBeGreaterThan(0)
  })

  it('evaluates certificate expiry from a date-only value in local time', () => {
    const noon = new Date(2026, 0, 20, 12, 0, 0)
    const today = certStatus('2026-01-20', 30, noon)
    expect(today).toMatchObject({ daysRemaining: 0, expired: false, warning: true })
    expect(today!.renewBy).toBe('2025-12-21')
    expect(certStatus('2026-02-19', 30, noon)).toMatchObject({ daysRemaining: 30, expired: false, warning: true })
    expect(certStatus('2026-01-19', 30, noon)?.expired).toBe(true)
    expect(certStatus('2026-02-31', 30, noon)).toBeNull()
    expect(certStatus('', 30, noon)).toBeNull()
    expect(certStatus('2026-01-20', Number.NaN, noon)).toBeNull()

    const now = new Date('2026-01-01T00:00:00Z')
    expect(certStatus('2026-01-20T00:00:00Z', 30, now)).toMatchObject({ daysRemaining: 19, expired: false, warning: true })
    expect(certStatus('2025-01-01T00:00:00Z', 30, now)?.expired).toBe(true)
    expect(certStatus('not-a-date')).toBeNull()
  })
})
