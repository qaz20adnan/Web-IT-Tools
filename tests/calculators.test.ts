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
  it('computes transfer time with overhead', () => {
    const seconds = transferSeconds(10, 1000, 0)
    expect(seconds).toBeCloseTo(85.899, 2)
    expect(transferSeconds(0, 1000, 0)).toBeNull()
  })

  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(3661)).toBe('1h 1m 1s')
    expect(formatDuration(-1)).toBeTruthy()
  })

  it('applies RAID capacity rules', () => {
    expect(raidCapacity('5', 4, 2)).toMatchObject({ usableTB: 6, tolerance: 1 })
    expect(raidCapacity('6', 6, 2)).toMatchObject({ usableTB: 8, tolerance: 2 })
    expect(raidCapacity('10', 4, 2)).toMatchObject({ usableTB: 4, tolerance: 2 })
    expect(raidCapacity('1', 4, 2)).toBeNull()
    expect(raidCapacity('5', 2, 2)).toBeNull()
  })

  it('estimates backup storage and recovery warnings', () => {
    const backup = backupEstimate(1000, 10, 30, 0)
    expect(backup).not.toBeNull()
    expect(backup!.dailyChangeGB).toBe(100)
    expect(backup!.fullCopies).toBe(5)
    expect(backup!.peakGB).toBeGreaterThan(5000)

    const recovery = assessRecovery([
      { id: '1', system: 'Domain controllers', tier: '0', rpoHours: 2, rtoHours: 6 },
      { id: '2', system: 'File server', tier: '1', rpoHours: 24, rtoHours: 8 },
    ])
    expect(recovery.tier0Count).toBe(1)
    expect(recovery.warnings.length).toBeGreaterThan(0)
  })

  it('evaluates certificate expiry', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const status = certStatus('2026-01-20T00:00:00Z', 30, now)
    expect(status).toMatchObject({ daysRemaining: 19, expired: false, warning: true })
    expect(certStatus('2025-01-01T00:00:00Z', 30, now)?.expired).toBe(true)
    expect(certStatus('not-a-date')).toBeNull()
  })
})
