import { describe, expect, it } from 'vitest'
import {
  analyzeLatency,
  assessFirewallRule,
  backupReadiness,
  planDiskCapacity,
  searchPorts,
} from '@/lib/operations'

describe('port reference', () => {
  it('finds ports by number, service and description', () => {
    expect(searchPorts('443').map((entry) => entry.service)).toContain('https')
    expect(searchPorts('rdp').map((entry) => entry.port)).toContain(3389)
    expect(searchPorts('remote desktop').map((entry) => entry.service)).toContain('rdp')
  })

  it('filters protocols while keeping dual-protocol services', () => {
    const tcp = searchPorts('dns', 'tcp')
    expect(tcp).toHaveLength(1)
    expect(tcp[0].protocol).toBe('both')
    expect(searchPorts('tftp', 'tcp')).toHaveLength(0)
  })
})

describe('latency analysis', () => {
  it('computes loss, RTT and jitter', () => {
    const result = analyzeLatency(10, [10, 20, 10, 20])
    expect(result).not.toBeNull()
    expect(result).toMatchObject({
      received: 4,
      lost: 6,
      lossPercent: 60,
      minMs: 10,
      maxMs: 20,
      avgMs: 15,
      jitterMs: 10,
      grade: 'poor',
    })
  })

  it('grades clean low-latency samples as excellent', () => {
    expect(analyzeLatency(4, [10, 11, 10, 11])?.grade).toBe('excellent')
  })

  it('rejects inconsistent or invalid input', () => {
    expect(analyzeLatency(0, [])).toBeNull()
    expect(analyzeLatency(2, [10, 12, 14])).toBeNull()
    expect(analyzeLatency(4, [10, -1])).toBeNull()
    expect(analyzeLatency(4, [10, Number.NaN])).toBeNull()
  })

  it('reports total loss when no samples succeed', () => {
    expect(analyzeLatency(5, [])).toMatchObject({ lossPercent: 100, grade: 'poor', avgMs: 0 })
  })
})

describe('disk capacity planner', () => {
  it('accounts for RAID, reserved space, filesystem overhead and growth', () => {
    const result = planDiskCapacity({
      disks: 8,
      diskSizeGiB: 1800,
      raid: '6',
      reservedPercent: 5,
      filesystemPercent: 2,
      growthReservePercent: 20,
    })
    expect(result).toMatchObject({
      rawGiB: 14400,
      usableGiB: 10800,
      reservedGiB: 540,
      filesystemGiB: 205,
      growthHeadroomGiB: 2011,
      currentCapacityGiB: 8044,
      efficiency: 75,
      tolerance: 2,
    })
  })

  it('rejects impossible RAID layouts and invalid percentages', () => {
    expect(planDiskCapacity({ disks: 2, diskSizeGiB: 1000, raid: '6', reservedPercent: 0, filesystemPercent: 0, growthReservePercent: 0 })).toBeNull()
    expect(planDiskCapacity({ disks: 5, diskSizeGiB: 1000, raid: '10', reservedPercent: 0, filesystemPercent: 0, growthReservePercent: 0 })).toBeNull()
    expect(planDiskCapacity({ disks: 4, diskSizeGiB: 1000, raid: '5', reservedPercent: 80, filesystemPercent: 0, growthReservePercent: 0 })).toBeNull()
  })
})

describe('firewall rule documentation', () => {
  const base = {
    name: 'Allow HTTPS',
    direction: 'inbound' as const,
    action: 'allow' as const,
    protocol: 'tcp' as const,
    ports: '443',
    remoteScope: '10.20.0.0/16',
    profile: 'Domain',
    purpose: 'Intranet portal',
    enabled: true,
  }

  it('accepts a scoped rule and emits markdown', () => {
    const result = assessFirewallRule(base)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.markdown).toContain('Allow HTTPS')
    expect(result.markdown).toContain('| Local ports | 443 |')
  })

  it('requires explicit ports for TCP and UDP', () => {
    const result = assessFirewallRule({ ...base, ports: 'any' })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('explicit ports')
  })

  it('flags broad inbound allow rules and missing purpose', () => {
    const result = assessFirewallRule({ ...base, ports: '1-65535', remoteScope: '*', purpose: '' })
    expect(result.valid).toBe(true)
    expect(result.warnings.join(' ')).toContain('all networks')
    expect(result.warnings.join(' ')).toContain('purpose')
  })

  it('rejects out-of-range ports', () => {
    expect(assessFirewallRule({ ...base, ports: '70000' }).valid).toBe(false)
    expect(assessFirewallRule({ ...base, ports: '500-400' }).valid).toBe(false)
  })
})

describe('backup readiness', () => {
  const base = {
    rpoHours: 24,
    frequencyHours: 4,
    copies: 3,
    offsite: true,
    immutable: true,
    encrypted: true,
    restoreTestDays: 10,
  }

  it('scores a complete programme as ready', () => {
    expect(backupReadiness(base)).toMatchObject({ score: 100, status: 'ready' })
  })

  it('detects missing immutability and an overdue restore test', () => {
    const result = backupReadiness({ ...base, immutable: false, restoreTestDays: 45 })
    expect(result).toMatchObject({ score: 65, status: 'needs-work' })
    expect(result?.checks.find((check) => check.id === 'immutable')?.pass).toBe(false)
    expect(result?.checks.find((check) => check.id === 'restore-test')?.pass).toBe(false)
  })

  it('rejects invalid inputs', () => {
    expect(backupReadiness({ ...base, rpoHours: 0 })).toBeNull()
    expect(backupReadiness({ ...base, copies: 0 })).toBeNull()
    expect(backupReadiness({ ...base, restoreTestDays: -1 })).toBeNull()
  })
})
