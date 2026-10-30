import net from 'node:net'

/**
 * DNS-over-HTTPS resolution.
 *
 * The platform used to call `dns.resolve*`, which returns no TTL at all (the
 * previous handler reported `ttl: 0` for every record) and cannot be pinned to a
 * chosen public resolver. DoH gives real TTLs, authoritative RCODEs, and lets one
 * query be compared across two resolvers, which is what a propagation or DDNS
 * staleness check actually needs.
 */

export type DohResolver = 'cloudflare' | 'google'
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'NS' | 'SOA' | 'TXT' | 'CAA' | 'SRV' | 'PTR'

const TYPE_CODES: Record<DnsRecordType, number> = {
  A: 1,
  NS: 2,
  CNAME: 5,
  SOA: 6,
  PTR: 12,
  MX: 15,
  TXT: 16,
  AAAA: 28,
  SRV: 33,
  CAA: 257,
}

const CODE_TYPES: Record<number, DnsRecordType> = Object.fromEntries(
  Object.entries(TYPE_CODES).map(([name, code]) => [code, name as DnsRecordType]),
)

const ENDPOINTS: Record<DohResolver, string> = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/resolve',
}

const MAX_NAME_LENGTH = 253
const DEFAULT_TIMEOUT_MS = 4000

export type DnsOutcome = 'answered' | 'nxdomain' | 'no-data' | 'servfail' | 'refused' | 'error'

export interface DohAnswer {
  name: string
  type: DnsRecordType
  ttl: number
  data: string
}

export interface DohResolution {
  resolver: DohResolver
  name: string
  type: DnsRecordType
  outcome: DnsOutcome
  /** DNS RCODE when a resolver answered; null when the request itself failed. */
  rcode: number | null
  answers: DohAnswer[]
  elapsedMs: number
  /** Safe, fixed-size reason code — never a raw resolver or transport message. */
  errorCode: string | null
}

/**
 * DNS names accept service labels such as `_dmarc` and `_smtp._tls`, which the
 * connect-target validator deliberately rejects. Nothing here ever opens a socket
 * to the queried name, so underscores are safe and must be allowed.
 */
export function normalizeDnsName(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/\.$/, '')
  if (!value || value.length > MAX_NAME_LENGTH) throw new Error('Enter a hostname between 1 and 253 characters.')
  if (/\s/.test(value) || value.includes('/') || value.includes('://') || value.includes(':')) {
    throw new Error('Enter a hostname or a reverse-DNS name, not a URL.')
  }
  if (net.isIP(value)) return value
  if (!/^(?=.{1,253}$)[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*\.[a-z][a-z0-9-]{0,62}\.?$/.test(value)) {
    throw new Error('Enter a valid hostname.')
  }
  return value
}

function toArpa(address: string): string | null {
  const family = net.isIP(address)
  if (family === 4) {
    return `${address.split('.').reverse().join('.')}.in-addr.arpa`
  }
  if (family !== 6) return null
  const expanded = expandIpv6(address)
  if (!expanded) return null
  return `${expanded.replace(/:/g, '').split('').reverse().join('.')}.ip6.arpa`
}

function expandIpv6(address: string): string | null {
  const halves = address.toLowerCase().split('::')
  if (halves.length > 2) return null
  const toGroups = (part: string): string[] => (part ? part.split(':').filter(Boolean) : [])
  if (halves.length === 2) {
    const left = toGroups(halves[0])
    const right = toGroups(halves[1])
    // `::` stands for at least one all-zero group, and any embedded IPv4 tail
    // would arrive as decimal octets rather than hex groups.
    const missing = 8 - left.length - right.length
    if (missing < 1 || left.some((group) => !/^[0-9a-f]{1,4}$/.test(group)) || right.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) {
      return null
    }
    const fill = Array.from({ length: missing }, () => '0000')
    return [...left, ...fill, ...right].map((group) => group.padStart(4, '0')).join(':')
  }
  const groups = toGroups(address)
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.map((group) => group.padStart(4, '0')).join(':')
}

/** Reverse-DNS name for an address, or null when the value is not an IP. */
export function pointerName(address: string): string | null {
  return toArpa(address)
}

function tidyText(value: string): string {
  // Resolvers deliver TXT as one string with the octet-join marker escaped.
  const unescaped = value.replace(/\\;/g, ';').replace(/\\"/g, '"')
  const quoted = unescaped.match(/^"([\s\S]*)"$/)
  return (quoted ? quoted[1] : unescaped).trim()
}

interface WireAnswer {
  name?: string
  type?: number
  TTL?: number
  data?: string
}

interface WireBody {
  Status?: number
  Answer?: WireAnswer[]
  Authority?: WireAnswer[]
}

function outcomeFor(rcode: number | undefined, answers: number): DnsOutcome {
  if (rcode === 3) return 'nxdomain'
  if (rcode === 2) return 'servfail'
  if (rcode === 5) return 'refused'
  if (rcode !== 0) return 'error'
  return answers > 0 ? 'answered' : 'no-data'
}

async function query(resolver: DohResolver, name: string, type: DnsRecordType, timeoutMs: number): Promise<DohResolution> {
  const startedAt = Date.now()
  const base: Omit<DohResolution, 'outcome' | 'rcode' | 'answers' | 'elapsedMs' | 'errorCode'> = {
    resolver,
    name,
    type,
  }
  try {
    const url = `${ENDPOINTS[resolver]}?name=${encodeURIComponent(name)}&type=${TYPE_CODES[type]}`
    const response = await fetch(url, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) {
      return { ...base, outcome: 'error', rcode: null, answers: [], elapsedMs: Date.now() - startedAt, errorCode: `resolver-http-${response.status}` }
    }
    const body = (await response.json()) as WireBody
    const answers = (body.Answer ?? []).flatMap((entry) => {
      if (typeof entry.data !== 'string') return []
      const typeName = CODE_TYPES[entry.type ?? 0] ?? type
      return [{
        name: (entry.name ?? name).replace(/\.$/, ''),
        type: typeName,
        ttl: Number.isFinite(entry.TTL) ? (entry.TTL as number) : 0,
        data: typeName === 'TXT' ? tidyText(entry.data) : entry.data.replace(/\.$/, ''),
      }]
    })
    return {
      ...base,
      outcome: outcomeFor(body.Status, answers.length),
      rcode: typeof body.Status === 'number' ? body.Status : null,
      answers,
      elapsedMs: Date.now() - startedAt,
      errorCode: null,
    }
  } catch {
    // Never forward a transport or resolver string to the caller.
    return { ...base, outcome: 'error', rcode: null, answers: [], elapsedMs: Date.now() - startedAt, errorCode: 'resolver-unavailable' }
  }
}

export async function resolveDoh(
  rawName: string,
  type: DnsRecordType,
  resolvers: DohResolver[] = ['cloudflare', 'google'],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DohResolution[]> {
  const name = normalizeDnsName(rawName)
  const budget = Math.min(8000, Math.max(1000, timeoutMs))
  return Promise.all(resolvers.map((resolver) => query(resolver, name, type, budget)))
}

export async function resolvePointer(
  address: string,
  resolvers: DohResolver[] = ['cloudflare'],
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DohResolution | null> {
  const name = toArpa(address)
  if (!name) return null
  const [result] = await resolveDoh(name, 'PTR', resolvers.slice(0, 1), timeoutMs)
  return result ?? null
}
