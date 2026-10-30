import net from 'node:net'
import { resolveDoh, resolvePointer, type DohResolution } from './net-doh'

/**
 * Internet-side identity of a target — the replacement for hop-by-hop traceroute.
 *
 * Traceroute needs raw sockets, which no serverless runtime grants. What this
 * platform *can* answer honestly is who owns the address the name resolves to,
 * where it is hosted, whether the record set is consistent between resolvers, and
 * which of our own edges the query was served from.
 */

const TRACE_ENDPOINT = 'https://www.cloudflare.com/cdn-cgi/trace'
const GEO_TIMEOUT_MS = 3500
const AUTHORITY_TIMEOUT_MS = 2500
/** The walk is bounded so one stubborn name cannot consume the function budget. */
const AUTHORITY_MAX_ZONES = 4

export interface PathOwnership {
  ip: string | null
  asn: string | null
  organisation: string | null
  internetServiceProvider: string | null
  domain: string | null
  country: string | null
  region: string | null
  city: string | null
  errorCode: string | null
}

export interface PathProbeResult {
  target: string
  resolvedAt: string
  addresses: { v4: string[]; v6: string[] }
  canonicalName: string[]
  reverse: Array<{ address: string; names: string[]; outcome: string }>
  authority: { zone: string | null; nameservers: string[]; soaSerial: string | null; soaRefresh: number | null }
  crossResolver: { resolver: string; outcome: string; answers: number; lowestTtl: number | null }[]
  disagreement: boolean
  ownership: PathOwnership | null
  probeOrigin: { ip: string | null; pointOfPresence: string | null; location: string | null; tls: string | null }
  note: string
}

/** Answers carry their own record type, because an A query also returns the CNAME chain. */
function answersOf(results: DohResolution[], recordType: string): string[] {
  return results.flatMap((entry) => entry.answers.filter((answer) => answer.type === recordType).map((answer) => answer.data))
}

async function readOwnership(ip: string | null): Promise<PathOwnership | null> {
  if (!ip) return null
  const empty: PathOwnership = {
    ip,
    asn: null,
    organisation: null,
    internetServiceProvider: null,
    domain: null,
    country: null,
    region: null,
    city: null,
    errorCode: 'geo-unavailable',
  }
  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(GEO_TIMEOUT_MS) })
    if (!response.ok) return { ...empty, errorCode: `geo-http-${response.status}` }
    const body = (await response.json()) as Record<string, unknown>
    if (body.success !== true) return { ...empty, errorCode: 'geo-unknown-address' }
    const connection = (body.connection ?? {}) as Record<string, unknown>
    const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, 80) : null)
    const asn = connection.asn
    return {
      ip,
      asn: typeof asn === 'number' ? `AS${asn}` : text(asn),
      organisation: text(connection.org),
      internetServiceProvider: text(connection.isp),
      domain: text(connection.domain),
      country: text(body.country),
      region: text(body.region),
      city: text(body.city),
      errorCode: null,
    }
  } catch {
    return empty
  }
}

async function readOrigin(): Promise<PathProbeResult['probeOrigin']> {
  const blank = { ip: null, pointOfPresence: null, location: null, tls: null }
  try {
    const response = await fetch(TRACE_ENDPOINT, { signal: AbortSignal.timeout(GEO_TIMEOUT_MS) })
    if (!response.ok) return blank
    const fields: Record<string, string> = {}
    for (const line of (await response.text()).split('\n')) {
      const [key, value] = line.split('=')
      if (key && value) fields[key.trim()] = value.trim()
    }
    return {
      ip: fields.ip ?? null,
      pointOfPresence: fields.colo ? `${fields.colo}${fields.gateway && fields.gateway !== 'off' ? ` (${fields.gateway})` : ''}` : null,
      location: fields.loc ?? null,
      tls: fields.tls ?? null,
    }
  } catch {
    return blank
  }
}

function soaFields(answers: { data: string }[]): { serial: string | null; refresh: number | null } {
  const raw = answers[0]?.data
  if (!raw) return { serial: null, refresh: null }
  const parts = raw.split(/\s+/)
  const serial = Number.parseInt(parts[2] ?? '', 10)
  const refresh = Number.parseInt(parts[3] ?? '', 10)
  return {
    serial: Number.isFinite(serial) ? String(serial) : null,
    refresh: Number.isFinite(refresh) ? refresh : null,
  }
}

const NO_AUTHORITY: PathProbeResult['authority'] = { zone: null, nameservers: [], soaSerial: null, soaRefresh: null }

/**
 * Names that could be the zone cut above this host, most specific first.
 *
 * `learn.microsoft.com` has no NS or SOA of its own — those live at the zone apex —
 * so asking the full name for them always returns empty. Walking up the labels is
 * how a support engineer finds the servers that actually answer for the name.
 */
export function zoneCandidates(host: string): string[] {
  const labels = host.split('.')
  const candidates: string[] = []
  for (let index = 0; index < labels.length; index += 1) {
    const candidate = labels.slice(index).join('.')
    // A bare top-level domain is not a zone anyone registers, so stop before it.
    if (!candidate.includes('.')) break
    candidates.push(candidate)
  }
  return candidates
}

async function readAuthority(host: string): Promise<PathProbeResult['authority']> {
  const candidates = zoneCandidates(host).slice(0, AUTHORITY_MAX_ZONES)
  if (candidates.length === 0) return NO_AUTHORITY

  // Asked together rather than one after another: the answer is usually the second
  // label from the end, and a sequential walk would pay a round trip per miss.
  const lookups = await Promise.all(candidates.map((name) => resolveDoh(name, 'NS', ['cloudflare'], AUTHORITY_TIMEOUT_MS)))
  const index = lookups.findIndex((entries) => answersOf(entries, 'NS').length > 0)
  if (index < 0) return NO_AUTHORITY

  const zone = candidates[index]
  const soaLookup = await resolveDoh(zone, 'SOA', ['cloudflare'], AUTHORITY_TIMEOUT_MS)
  const soa = soaFields(soaLookup.find((entry) => entry.type === 'SOA')?.answers ?? [])
  return { zone, nameservers: [...new Set(answersOf(lookups[index], 'NS'))].sort(), soaSerial: soa.serial, soaRefresh: soa.refresh }
}

export async function probePath(rawHost: string): Promise<PathProbeResult> {
  const host = rawHost.trim().toLowerCase().replace(/\.$/, '')
  const asIp = net.isIP(host) ? host : null

  const [aRecords, aaaaRecords, authority, origin] = await Promise.all([
    asIp ? Promise.resolve([] as DohResolution[]) : resolveDoh(host, 'A', ['cloudflare', 'google']),
    asIp ? Promise.resolve([] as DohResolution[]) : resolveDoh(host, 'AAAA', ['cloudflare']),
    asIp ? Promise.resolve(NO_AUTHORITY) : readAuthority(host),
    readOrigin(),
  ])

  const v4 = asIp && net.isIP(asIp) === 4 ? [asIp] : [...new Set(answersOf(aRecords, 'A'))]
  const v6 = asIp && net.isIP(asIp) === 6 ? [asIp] : [...new Set(answersOf(aaaaRecords, 'AAAA'))]
  const canonical = asIp ? [] : [...new Set(answersOf(aRecords, 'CNAME'))]
  const address = v4[0] ?? v6[0] ?? null

  const [pointer, ownership] = await Promise.all([address ? resolvePointer(address) : Promise.resolve(null), readOwnership(address)])
  const reverse = pointer && address ? [{ address, names: pointer.answers.map((answer) => answer.data), outcome: pointer.outcome }] : []

  const crossResolver = aRecords.map((entry) => ({
    resolver: entry.resolver,
    outcome: entry.outcome,
    answers: entry.answers.length,
    lowestTtl: entry.answers.length ? Math.min(...entry.answers.map((answer) => answer.ttl)) : null,
  }))
  const outcomeKeys = new Set(crossResolver.map((entry) => `${entry.outcome}:${entry.answers}`))

  return {
    target: host,
    resolvedAt: new Date().toISOString(),
    addresses: { v4, v6 },
    canonicalName: canonical,
    reverse,
    authority,
    crossResolver,
    disagreement: crossResolver.length > 1 && outcomeKeys.size > 1,
    ownership,
    probeOrigin: origin,
    note: 'Hop-by-hop traceroute requires raw sockets, which serverless hosting does not provide. This is the internet-side view of the target.',
  }
}
