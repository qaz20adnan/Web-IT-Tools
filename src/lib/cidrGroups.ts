import { ipv4ToNumber, numberToIPv4, parseIPv4 } from '@/lib/calculators'

export interface CidrInput {
  id?: string
  cidr: string
  name?: string
  gateway?: string | null
  dns?: string[]
  line?: number
  source?: string
}

export interface CidrNetwork {
  id: string
  line: number
  source: string
  name: string
  rawCidr: string
  cidr: string
  prefix: number
  network: string
  mask: string
  broadcast: string
  start: number
  end: number
  size: number
  enteredStart: number
  enteredEnd: number
  aligned: boolean
  gateway: string | null
  dns: string[]
}

export type InvalidReason = 'empty' | 'address' | 'prefix' | 'range'

export interface CidrInvalid {
  id: string
  line: number
  source: string
  value: string
  reason: InvalidReason
}

export type CidrFindingKind =
  | 'invalid'
  | 'misaligned'
  | 'identical'
  | 'containment'
  | 'partial'
  | 'address-outside'
  | 'address-reserved'
  | 'duplicate-address'
  | 'foreign-address'
  | 'default-route'

export type CidrSeverity = 'error' | 'warning'

export interface CidrFinding {
  id: string
  kind: CidrFindingKind
  severity: CidrSeverity
  networkIds: string[]
  addresses: string[]
  detail: string
}

export interface CidrOverlapPair {
  id: string
  kind: 'identical' | 'containment' | 'partial'
  a: string
  b: string
  sharedFrom: number
  sharedTo: number
  sharedSize: number
}

export interface CidrAnalysis {
  networks: CidrNetwork[]
  invalid: CidrInvalid[]
  overlaps: CidrOverlapPair[]
  clusters: string[][]
  findings: CidrFinding[]
  errorCount: number
  warningCount: number
  passed: boolean
}

export const MAX_IPV4 = 0xffffffff

export function maskForPrefix(prefix: number): number {
  if (prefix === 0) return 0
  return (0xffffffff << (32 - prefix)) >>> 0
}

export function parseCidrBlock(value: string): { address: number; prefix: number } | { reason: InvalidReason; value: string } {
  const text = value.trim()
  if (!text) return { reason: 'empty', value: text }
  const parts = text.split('/')
  if (parts.length > 2) return { reason: 'prefix', value: text }
  const bytes = parseIPv4(parts[0])
  if (!bytes) return { reason: 'address', value: parts[0] }
  if (parts.length === 1) return { address: ipv4ToNumber(bytes), prefix: 32 }
  if (!/^\d{1,2}$/.test(parts[1])) return { reason: 'prefix', value: text }
  const prefix = Number(parts[1])
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return { reason: 'range', value: text }
  return { address: ipv4ToNumber(bytes), prefix }
}

function toNumber(value: string): number {
  const bytes = parseIPv4(value)
  return bytes ? ipv4ToNumber(bytes) : 0
}

export function buildNetwork(input: CidrInput, index: number): { network?: CidrNetwork; invalid?: CidrInvalid } {
  const id = input.id ?? `net-${index + 1}`
  const line = input.line ?? index + 1
  const source = input.source ?? input.cidr
  const parsed = parseCidrBlock(input.cidr)
  if ('reason' in parsed) {
    return { invalid: { id, line, source, value: input.cidr.trim(), reason: parsed.reason } }
  }

  const mask = maskForPrefix(parsed.prefix)
  const start = (parsed.address & mask) >>> 0
  const end = (start | (~mask >>> 0)) >>> 0
  const size = 2 ** (32 - parsed.prefix)
  const network = numberToIPv4(start)
  const broadcast = numberToIPv4(end)
  const gateway = input.gateway?.trim() ? input.gateway.trim() : null
  const dns = (input.dns ?? []).map((entry) => entry.trim()).filter(Boolean)

  return {
    network: {
      id,
      line,
      source,
      name: input.name?.trim() || network,
      rawCidr: input.cidr.trim(),
      cidr: `${network}/${parsed.prefix}`,
      prefix: parsed.prefix,
      network,
      mask: numberToIPv4(mask),
      broadcast,
      start,
      end,
      size,
      enteredStart: parsed.address,
      enteredEnd: Math.min(parsed.address + size - 1, MAX_IPV4),
      aligned: start === parsed.address,
      gateway,
      dns,
    },
  }
}

export function analyzeCidrs(inputs: CidrInput[]): CidrAnalysis {
  const networks: CidrNetwork[] = []
  const invalid: CidrInvalid[] = []

  inputs.forEach((input, index) => {
    const built = buildNetwork(input, index)
    if (built.invalid) invalid.push(built.invalid)
    if (built.network) networks.push(built.network)
  })

  const findings: CidrFinding[] = []
  let counter = 0
  const push = (finding: Omit<CidrFinding, 'id'>) => {
    counter += 1
    findings.push({ id: `f-${counter}`, ...finding })
  }

  for (const entry of invalid) {
    push({
      kind: 'invalid',
      severity: 'error',
      networkIds: [],
      addresses: [entry.value],
      detail: `${entry.value} — line ${entry.line}`,
    })
  }

  for (const network of networks) {
    if (!network.aligned) {
      push({
        kind: 'misaligned',
        severity: 'error',
        networkIds: [network.id],
        addresses: [network.rawCidr, network.cidr],
        detail: `${network.rawCidr} → ${network.cidr} (host bits set)`,
      })
    }
  }

  const defaults = networks.filter((network) => network.prefix === 0)
  for (const network of defaults) {
    push({
      kind: 'default-route',
      severity: 'warning',
      networkIds: [network.id],
      addresses: [network.cidr],
      detail: `${network.cidr} — every address falls inside it`,
    })
  }

  const overlaps: CidrOverlapPair[] = []
  const recordOverlap = (
    a: CidrNetwork,
    b: CidrNetwork,
    kind: CidrOverlapPair['kind'],
    sharedFrom: number,
    sharedTo: number,
    operator: string,
  ) => {
    overlaps.push({
      id: `ov-${overlaps.length + 1}`,
      kind,
      a: a.id,
      b: b.id,
      sharedFrom,
      sharedTo,
      sharedSize: sharedTo - sharedFrom + 1,
    })
    push({
      kind,
      severity: 'error',
      networkIds: [a.id, b.id],
      addresses: [a.cidr, b.cidr, `${numberToIPv4(sharedFrom)}-${numberToIPv4(sharedTo)}`],
      detail: `${a.cidr} ${operator} ${b.cidr} → ${numberToIPv4(sharedFrom)}–${numberToIPv4(sharedTo)}`,
    })
  }

  for (let i = 0; i < networks.length; i += 1) {
    for (let j = i + 1; j < networks.length; j += 1) {
      const a = networks[i]
      const b = networks[j]
      if (a.prefix === 0 || b.prefix === 0) continue

      if (a.start <= b.end && b.start <= a.end) {
        const sharedFrom = Math.max(a.start, b.start)
        const sharedTo = Math.min(a.end, b.end)
        const identical = a.start === b.start && a.end === b.end
        const containment = !identical && (a.start <= b.start && a.end >= b.end || b.start <= a.start && b.end >= a.end)
        recordOverlap(a, b, identical ? 'identical' : containment ? 'containment' : 'partial', sharedFrom, sharedTo, identical ? '=' : containment ? '⊃/⊂' : '∩')
        continue
      }

      // Two correctly aligned blocks can only be nested or disjoint, so a partial
      // intersection of the ranges as typed means one entry is misaligned.
      if (a.aligned && b.aligned) continue
      if (a.enteredStart > b.enteredEnd || b.enteredStart > a.enteredEnd) continue
      recordOverlap(
        a,
        b,
        'partial',
        Math.max(a.enteredStart, b.enteredStart),
        Math.min(a.enteredEnd, b.enteredEnd),
        '∩(as typed)',
      )
    }
  }

  const reserved = (network: CidrNetwork, address: string): boolean =>
    network.prefix <= 30 && (address === network.network || address === network.broadcast)

  const ownersOf = (address: string): CidrNetwork[] => networks.filter((network) => toNumber(address) >= network.start && toNumber(address) <= network.end)

  const addressUsers: Map<string, Array<{ network: CidrNetwork; role: string }>> = new Map()
  for (const network of networks) {
    const entries: Array<{ address: string; role: string }> = []
    if (network.gateway) entries.push({ address: network.gateway, role: 'GW' })
    for (const address of network.dns) entries.push({ address, role: 'DNS' })

    for (const entry of entries) {
      const value = entry.address
      const parsedAddress = parseIPv4(value)
      if (!parsedAddress) {
        push({
          kind: 'invalid',
          severity: 'error',
          networkIds: [network.id],
          addresses: [value],
          detail: `${value} (${entry.role}) — line ${network.line}`,
        })
        continue
      }
      const bucket = addressUsers.get(value) ?? []
      bucket.push({ network, role: entry.role })
      addressUsers.set(value, bucket)

      const number = ipv4ToNumber(parsedAddress)
      if (number < network.start || number > network.end) {
        push({
          kind: 'address-outside',
          severity: 'error',
          networkIds: [network.id],
          addresses: [value, network.cidr],
          detail: `${value} (${entry.role}) ∉ ${network.cidr}`,
        })
      } else if (reserved(network, value)) {
        push({
          kind: 'address-reserved',
          severity: 'error',
          networkIds: [network.id],
          addresses: [value, network.cidr],
          detail: `${value} (${entry.role}) = ${value === network.network ? 'network' : 'broadcast'} of ${network.cidr}`,
        })
      }

      for (const other of ownersOf(value)) {
        if (other.id === network.id) continue
        const sharesRange = !(other.start > network.end || network.start > other.end)
        if (sharesRange) continue
        push({
          kind: 'foreign-address',
          severity: 'warning',
          networkIds: [network.id, other.id],
          addresses: [value, other.cidr],
          detail: `${value} (${entry.role} of ${network.cidr}) ∈ ${other.cidr}`,
        })
      }
    }
  }

  const sortedAddresses = [...addressUsers.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  for (const [address, users] of sortedAddresses) {
    const unique = new Map<string, string>()
    for (const user of users) {
      const key = `${user.network.id}:${user.role}`
      if (!unique.has(key)) unique.set(key, `${user.network.cidr} (${user.role})`)
    }
    if (unique.size < 2) continue
    push({
      kind: 'duplicate-address',
      severity: 'error',
      networkIds: users.map((user) => user.network.id),
      addresses: [address],
      detail: `${address} = ${[...unique.values()].join(' = ')}`,
    })
  }

  const parent = new Map<string, string>()
  const find = (value: string): string => {
    let current = value
    while (parent.get(current) && parent.get(current) !== current) current = parent.get(current) as string
    return current
  }
  for (const network of networks) parent.set(network.id, network.id)
  for (const overlap of overlaps) {
    const rootA = find(overlap.a)
    const rootB = find(overlap.b)
    if (rootA !== rootB) parent.set(rootA, rootB)
  }
  const groups = new Map<string, string[]>()
  for (const network of networks) {
    const root = find(network.id)
    const bucket = groups.get(root) ?? []
    bucket.push(network.id)
    groups.set(root, bucket)
  }
  const clusters = [...groups.values()].filter((group) => group.length > 1)

  const errorCount = findings.filter((finding) => finding.severity === 'error').length
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length

  return {
    networks,
    invalid,
    overlaps,
    clusters,
    findings,
    errorCount,
    warningCount,
    passed: networks.length > 0 && errorCount === 0,
  }
}

const FIELD_SPLIT = /[,;|\t]+/

export function parseCidrText(text: string): CidrInput[] {
  const inputs: CidrInput[] = []
  const lines = text.split(/\r?\n/)
  lines.forEach((raw, index) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    const parts = line.includes(',') || line.includes(';') || line.includes('|') || line.includes('\t')
      ? line.split(FIELD_SPLIT).map((part) => part.trim())
      : (() => {
          const tokens = line.split(/\s+/)
          return [tokens[0], tokens.slice(1).join(' ')]
        })()

    const dnsField = parts[3] ?? ''
    inputs.push({
      line: index + 1,
      source: line,
      cidr: parts[0] ?? '',
      name: parts[1] || undefined,
      gateway: parts[2] || null,
      dns: dnsField ? dnsField.split(/[\s/]+/).filter(Boolean) : [],
    })
  })
  return inputs
}

export function analyzeCidrText(text: string): CidrAnalysis {
  return analyzeCidrs(parseCidrText(text))
}

export function canonicalCidr(value: string): string | null {
  const parsed = parseCidrBlock(value)
  if ('reason' in parsed) return null
  const mask = maskForPrefix(parsed.prefix)
  return `${numberToIPv4((parsed.address & mask) >>> 0)}/${parsed.prefix}`
}

export function addressInCidr(address: string, cidr: string): boolean {
  const host = parseIPv4(address)
  const block = parseCidrBlock(cidr)
  if (!host || 'reason' in block) return false
  const mask = maskForPrefix(block.prefix)
  return (ipv4ToNumber(host) & mask) === (block.address & mask)
}
