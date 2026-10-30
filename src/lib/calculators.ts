export interface SubnetResult {
  network: string
  broadcast: string
  firstHost: string
  lastHost: string
  usableHosts: number
  totalAddresses: number
  mask: string
  wildcard: string
  prefix: number
  scope: 'private' | 'public' | 'loopback' | 'link-local' | 'multicast' | 'reserved' | 'documentation'
}

export function parseIPv4(value: string): number[] | null {
  const parts = value.trim().split('.')
  if (parts.length !== 4) return null
  const bytes: number[] = []
  for (const part of parts) {
    // Leading zeros are rejected: some stacks read "010" as octal, so the value is ambiguous.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const byte = Number(part)
    if (byte < 0 || byte > 255) return null
    bytes.push(byte)
  }
  return bytes
}

export function hasAmbiguousOctet(value: string): boolean {
  return value.trim().split('.').some((part) => /^0\d/.test(part))
}

export function ipv4ToNumber(bytes: number[]): number {
  return ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0
}

export function numberToIPv4(value: number): string {
  const n = value >>> 0
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export function subnetInfo(address: string, prefix: number): SubnetResult | null {
  const bytes = parseIPv4(address)
  if (!bytes || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  const ip = ipv4ToNumber(bytes)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = (ip & mask) >>> 0
  const broadcast = (network | (~mask >>> 0)) >>> 0
  const total = 2 ** (32 - prefix)

  let usable = total - 2
  if (prefix === 32) usable = 1
  if (prefix === 31) usable = 2
  if (usable < 0) usable = 0

  const firstHost = prefix >= 31 ? network : (network + 1) >>> 0
  const lastHost = prefix >= 31 ? broadcast : (broadcast - 1) >>> 0

  return {
    network: numberToIPv4(network),
    broadcast: numberToIPv4(broadcast),
    firstHost: numberToIPv4(firstHost),
    lastHost: numberToIPv4(lastHost),
    usableHosts: usable,
    totalAddresses: total,
    mask: numberToIPv4(mask),
    wildcard: numberToIPv4(~mask >>> 0),
    prefix,
    scope: classifyIPv4(network, prefix),
  }
}

export function classifyIPv4(network: number, prefix: number): SubnetResult['scope'] {
  const first = network >>> 24
  const second = (network >>> 16) & 255
  if (first === 10) return 'private'
  if (first === 172 && second >= 16 && second <= 31) return 'private'
  if (first === 192 && second === 168) return 'private'
  if (first === 127) return 'loopback'
  if (first === 169 && second === 254) return 'link-local'
  if (first >= 224 && first <= 239) return 'multicast'
  if (first === 192 && second === 0 && ((network >>> 8) & 255) === 2) return 'documentation'
  if (first === 198 && second === 51 && ((network >>> 8) & 255) === 100) return 'documentation'
  if (first === 203 && second === 0 && ((network >>> 8) & 255) === 113) return 'documentation'
  if (first === 100 && second >= 64 && second <= 127) return 'private'
  if (first === 0 || first >= 240) return 'reserved'
  void prefix
  return 'public'
}

export function expandIPv6(input: string): string | null {
  let value = input.trim().toLowerCase()
  if (value.startsWith('[') && value.includes(']')) value = value.slice(1, value.indexOf(']'))
  value = value.split('%')[0]
  if (!value.includes(':')) return null
  const halves = value.split('::')
  if (halves.length > 2) return null

  const parseGroups = (part: string): string[] | null => {
    if (!part) return []
    const groups = part.split(':')
    if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
    return groups.map((group) => group.padStart(4, '0'))
  }

  const left = parseGroups(halves[0])
  const right = halves.length === 2 ? parseGroups(halves[1]) : []
  if (!left || !right) return null

  const missing = 8 - left.length - right.length
  if (halves.length === 2) {
    if (missing < 1) return null
    return [...left, ...Array.from({ length: missing }, () => '0000'), ...right].join(':')
  }
  if (left.length !== 8) return null
  return left.join(':')
}

export function compressIPv6(expanded: string): string | null {
  const groups = expanded.split(':')
  if (groups.length !== 8) return null
  let bestStart = -1
  let bestLength = 0
  let start = -1
  for (let index = 0; index <= groups.length; index += 1) {
    if (index < groups.length && groups[index] === '0000') {
      if (start === -1) start = index
    } else if (start !== -1) {
      const length = index - start
      if (length > bestLength && length >= 2) {
        bestStart = start
        bestLength = length
      }
      start = -1
    }
  }
  const trimmed = groups.map((group) => group.replace(/^0+/, '') || '0')
  if (bestStart === -1) return trimmed.join(':')
  const before = trimmed.slice(0, bestStart).join(':')
  const after = trimmed.slice(bestStart + bestLength).join(':')
  return `${before}::${after}`
}

export function classifyIPv6(expanded: string): 'loopback' | 'unspecified' | 'link-local' | 'unique-local' | 'multicast' | 'global' | 'documentation' {
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0000') return 'unspecified'
  if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001') return 'loopback'
  const first = parseInt(expanded.slice(0, 4), 16)
  if ((first & 0xffc0) === 0xfe80) return 'link-local'
  if ((first & 0xfe00) === 0xfc00) return 'unique-local'
  if ((first & 0xff00) === 0xff00) return 'multicast'
  if (first === 0x2001 && expanded.slice(5, 9) === '0db8') return 'documentation'
  return 'global'
}

export function transferSeconds(sizeGiB: number, speedMbps: number, overheadPercent: number): number | null {
  if (!Number.isFinite(sizeGiB) || !Number.isFinite(speedMbps) || !Number.isFinite(overheadPercent)) return null
  if (sizeGiB <= 0 || speedMbps <= 0 || overheadPercent < 0 || overheadPercent >= 100) return null
  // Payload is binary (GiB, 1024^3) while the link rate is decimal Mbps; the UI labels the field GiB.
  const bits = sizeGiB * 1024 ** 3 * 8
  const effectiveBps = speedMbps * 1_000_000 * (1 - overheadPercent / 100)
  return bits / effectiveBps
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.round(seconds)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  if (secs && !days) parts.push(`${secs}s`)
  return parts.join(' ') || '0s'
}

export type RaidLevel = '0' | '1' | '5' | '6' | '10'

export interface RaidResult {
  usableTB: number
  efficiency: number
  /** Disks that are guaranteed to survive; the worst-case figure to plan against. */
  tolerance: number
  /** Only reachable when failures land in different mirrors, so it is not a planning number. */
  bestCaseTolerance: number
}

export function raidCapacity(level: RaidLevel, disks: number, diskTB: number): RaidResult | null {
  if (!Number.isInteger(disks) || disks < 2 || diskTB <= 0) return null
  const total = disks * diskTB
  switch (level) {
    case '0':
      return { usableTB: total, efficiency: 100, tolerance: 0, bestCaseTolerance: 0 }
    case '1':
      if (disks !== 2) return null
      return { usableTB: diskTB, efficiency: 50, tolerance: 1, bestCaseTolerance: 1 }
    case '5':
      if (disks < 3) return null
      return { usableTB: (disks - 1) * diskTB, efficiency: ((disks - 1) / disks) * 100, tolerance: 1, bestCaseTolerance: 1 }
    case '6':
      if (disks < 4) return null
      return { usableTB: (disks - 2) * diskTB, efficiency: ((disks - 2) / disks) * 100, tolerance: 2, bestCaseTolerance: 2 }
    case '10':
      if (disks < 4 || disks % 2 !== 0) return null
      return { usableTB: (disks / 2) * diskTB, efficiency: 50, tolerance: 1, bestCaseTolerance: disks / 2 }
    default:
      return null
  }
}

export interface BackupEstimate {
  fullGB: number
  dailyChangeGB: number
  fullCopies: number
  /** Growth is applied once, to the whole series in peakGB, so this is the ungrown increment total. */
  incrementGB: number
  peakGB: number
  growthFactor: number
}

export function backupEstimate(
  fullGB: number,
  changePercent: number,
  retentionDays: number,
  growthPercentPerYear: number,
): BackupEstimate | null {
  if (![fullGB, changePercent, retentionDays, growthPercentPerYear].every(Number.isFinite)) return null
  if (fullGB <= 0 || retentionDays <= 0 || changePercent < 0 || changePercent > 100 || growthPercentPerYear < 0) return null
  const growthFactor = (1 + growthPercentPerYear / 100) ** (retentionDays / 365)
  const fullCopies = Math.max(1, Math.ceil(retentionDays / 7))
  const dailyChangeGB = fullGB * (changePercent / 100)
  const incrementGB = dailyChangeGB * retentionDays
  const peakGB = (fullCopies * fullGB + incrementGB) * growthFactor
  return { fullGB, dailyChangeGB, fullCopies, incrementGB, peakGB, growthFactor }
}

export interface RecoveryRow {
  id: string
  system: string
  tier: '0' | '1' | '2'
  rpoHours: number
  rtoHours: number
}

export interface RecoveryAssessment {
  maxRpo: number
  maxRto: number
  tier0Count: number
  warnings: string[]
}

export function assessRecovery(rows: RecoveryRow[]): RecoveryAssessment {
  const maxRpo = rows.reduce((max, row) => Math.max(max, row.rpoHours), 0)
  const maxRto = rows.reduce((max, row) => Math.max(max, row.rtoHours), 0)
  const tier0Count = rows.filter((row) => row.tier === '0').length
  const warnings: string[] = []
  for (const row of rows) {
    if (row.tier === '0' && row.rpoHours > 1) warnings.push(`${row.system}: Tier 0 RPO above 1 hour`)
    if (row.tier === '0' && row.rtoHours > 4) warnings.push(`${row.system}: Tier 0 RTO above 4 hours`)
    if (row.tier === '1' && row.rpoHours > 24) warnings.push(`${row.system}: Tier 1 RPO above 24 hours`)
    if (row.rtoHours < row.rpoHours) warnings.push(`${row.system}: RTO is shorter than RPO, which is unusual`)
  }
  return { maxRpo, maxRto, tier0Count, warnings }
}

export interface CertStatus {
  daysRemaining: number
  expired: boolean
  warning: boolean
  renewBy: string
}

function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export function certStatus(expiryISO: string, warningDays = 30, now = new Date()): CertStatus | null {
  if (!Number.isFinite(warningDays) || warningDays < 0) return null
  const text = expiryISO.trim()
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  let expiry: Date
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    // A date-only value from <input type="date"> means the certificate is valid through that local day.
    expiry = new Date(year, month - 1, day, 23, 59, 59, 999)
    const rolledOver = expiry.getFullYear() !== year || expiry.getMonth() !== month - 1 || expiry.getDate() !== day
    if (Number.isNaN(expiry.getTime()) || rolledOver) return null
  } else {
    expiry = new Date(text)
    if (Number.isNaN(expiry.getTime())) return null
  }
  const dayIndex = (value: Date): number =>
    Math.round(new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime() / 86_400_000)
  const daysRemaining = dayIndex(expiry) - dayIndex(now)
  const expired = expiry.getTime() < now.getTime()
  const renew = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate() - warningDays)
  return {
    daysRemaining,
    expired,
    warning: !expired && daysRemaining <= warningDays,
    renewBy: formatLocalDate(renew),
  }
}
