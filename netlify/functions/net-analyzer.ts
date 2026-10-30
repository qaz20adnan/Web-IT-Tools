import net from 'node:net'
import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { resolveDoh, type DohResolution } from '../lib/net-doh'
import {
  buildAnalyzerReport,
  DEFAULT_ANALYZER_PORTS,
  isCgnat,
  type AnalyzerReportInput,
  type NameResolution,
  type ProbeSourceInfo,
} from '../lib/net-analysis'
import { classifyProbeAddress, normalizeProbeHost, probePorts } from '../lib/net-probe'
import { enforceRateLimit } from '../lib/rate'
import { analyzerRequestSchema, flattenZod } from '../lib/schema'

const ORIGIN_TIMEOUT_MS = 2500
const DNS_TIMEOUT_MS = 3000
const PORT_TIMEOUT_MS = 1500
const TRACE_ENDPOINT = 'https://www.cloudflare.com/cdn-cgi/trace'
const IPV6_EGRESS_ENDPOINT = 'https://api64.ipify.org?format=json'

function assignOriginAddress(info: ProbeSourceInfo, address: string | null | undefined): void {
  if (!address) return
  const family = net.isIP(address)
  if (family === 4) info.ipv4 = info.ipv4 ?? address
  else if (family === 6) info.ipv6 = info.ipv6 ?? address
}

/**
 * The address this function ran from. Serverless hosting has one egress per
 * region, so this is the platform's own address and is labelled as such in the
 * report — it is never presented to the user as their public IP.
 */
export async function readProbeOrigin(): Promise<ProbeSourceInfo> {
  const info: ProbeSourceInfo = { ipv4: null, ipv6: null, country: null, colo: null, source: 'unavailable' }
  const sources: string[] = []

  const [trace, egress] = await Promise.allSettled([
    fetch(TRACE_ENDPOINT, { signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS) }).then(async (response) =>
      response.ok ? response.text() : Promise.reject(new Error('trace-unavailable')),
    ),
    fetch(IPV6_EGRESS_ENDPOINT, { signal: AbortSignal.timeout(ORIGIN_TIMEOUT_MS) }).then(async (response) =>
      response.ok ? ((await response.json()) as { ip?: unknown }) : Promise.reject(new Error('egress-unavailable')),
    ),
  ])

  if (trace.status === 'fulfilled') {
    const fields = new Map<string, string>()
    for (const line of trace.value.split('\n')) {
      const index = line.indexOf('=')
      if (index > 0) fields.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
    }
    assignOriginAddress(info, fields.get('ip'))
    info.country = fields.get('loc') ?? null
    info.colo = fields.get('colo') ?? null
    if (info.ipv4 || info.ipv6) sources.push('cloudflare-trace')
  }
  if (egress.status === 'fulfilled') {
    const value = egress.value.ip
    if (typeof value === 'string') {
      assignOriginAddress(info, value)
      sources.push('ipify')
    }
  }

  info.source = sources.join('+') || 'unavailable'
  return info
}

function addressesOf(results: DohResolution[], recordType: string): string[] {
  return [...new Set(results.flatMap((entry) => entry.answers.filter((answer) => answer.type === recordType).map((answer) => answer.data)))]
}

function ttlsOf(results: DohResolution[], recordType: string): number[] {
  return results.flatMap((entry) => entry.answers.filter((answer) => answer.type === recordType).map((answer) => answer.ttl))
}

/** Names are resolved through public resolvers, which is what an outside client would see. */
export async function resolveName(rawHost: string): Promise<NameResolution> {
  const host = normalizeProbeHost(rawHost)
  const family = net.isIP(host)
  if (family) {
    return { host, ipv4: family === 4 ? [host] : [], ipv6: family === 6 ? [host] : [], lowestTtl: null, error: null }
  }

  const [aRecords, aaaaRecords] = await Promise.all([
    resolveDoh(host, 'A', ['cloudflare', 'google'], DNS_TIMEOUT_MS),
    resolveDoh(host, 'AAAA', ['cloudflare'], DNS_TIMEOUT_MS),
  ])
  const ipv4 = addressesOf(aRecords, 'A')
  const ipv6 = addressesOf(aaaaRecords, 'AAAA')
  const ttls = [...ttlsOf(aRecords, 'A'), ...ttlsOf(aaaaRecords, 'AAAA')]
  const everyResolverFailed = [...aRecords, ...aaaaRecords].every((entry) => entry.outcome === 'error')
  const error =
    ipv4.length + ipv6.length > 0
      ? null
      : everyResolverFailed
        ? 'No public resolver answered from here, so the record cannot be judged. This is a resolver problem, not an answer about the name.'
        : 'The name returned no A or AAAA record.'

  return { host, ipv4, ipv6, lowestTtl: ttls.length > 0 ? Math.min(...ttls) : null, error }
}

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`analyzer:${clientIp(event, context)}`, 8, 60_000)
  const parsed = analyzerRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))

  const expectedIp = parsed.data.expectedIp?.trim() ?? ''
  if (expectedIp && !net.isIP(expectedIp)) {
    throw new HttpError(400, 'invalid_input', 'Enter the expected address as a plain IPv4 or IPv6 address.')
  }

  // The two reads are independent and both must finish before the port sweep starts.
  const [probeSource, name] = await Promise.all([readProbeOrigin(), resolveName(parsed.data.host)])

  const candidates = [...name.ipv4, ...name.ipv6]
  const reachable = candidates.filter((address) => classifyProbeAddress(address) === 'public' || isCgnat(address))
  if (candidates.length > 0 && reachable.length === 0) {
    throw new HttpError(403, 'blocked_host', 'This name resolves only to private or reserved addresses, which cannot be reached from the internet.')
  }

  // Probe the address the caller cares about, and never an address family this
  // runtime has no route to — an IPv6 attempt from an IPv4-only sandbox fails
  // locally and would be reported as if the target were down.
  const IPv4Reachable = reachable.filter((address) => net.isIP(address) === 4)
  const IPv6Reachable = reachable.filter((address) => net.isIP(address) === 6)
  const address =
    (expectedIp && reachable.includes(expectedIp) ? expectedIp : null) ??
    IPv4Reachable[0] ??
    (probeSource.ipv6 ? IPv6Reachable[0] : undefined) ??
    null

  if (address === null && reachable.length > 0) {
    name.error = 'This name publishes only IPv6 addresses and this platform has no IPv6 egress, so no TCP port could be probed.'
  }
  const ports = [...new Set(parsed.data.ports ?? DEFAULT_ANALYZER_PORTS)].slice(0, 12)
  const probes = address ? await probePorts(address, ports, name.host, PORT_TIMEOUT_MS) : []
  const checkedAt = new Date().toISOString()
  const input: AnalyzerReportInput = {
    lang: parsed.data.lang,
    checkedAt,
    probeSource,
    name,
    expectedIp: expectedIp ? expectedIp : null,
    target: { host: name.host, address: address ?? '' },
    ports: probes,
  }

  return json(200, {
    checkedAt,
    probeSource,
    name,
    expectedIp: expectedIp ? expectedIp : null,
    target: input.target,
    ports: probes,
    report: buildAnalyzerReport(input),
  })
})
