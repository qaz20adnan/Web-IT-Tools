import { requireMember } from '../lib/auth'
import dns from 'node:dns/promises'
import net from 'node:net'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { buildAnalyzerReport, DEFAULT_ANALYZER_PORTS, type DdnsResult, type PublicIpInfo } from '../lib/net-analysis'
import { normalizeProbeHost, probePorts, resolveProbeAddresses } from '../lib/net-probe'
import { enforceRateLimit } from '../lib/rate'
import { analyzerRequestSchema, flattenZod } from '../lib/schema'

const FETCH_TIMEOUT_MS = 4000
const DNS_TIMEOUT_MS = 4000

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out.')), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json, text/plain', 'User-Agent': 'NEXORA-Public-IP/1.0' },
    })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithTimeout(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.text()
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetchWithTimeout(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

function assignIp(info: PublicIpInfo, address: string): void {
  if (net.isIP(address) === 4) info.ipv4 = info.ipv4 ?? address
  else if (net.isIP(address) === 6) info.ipv6 = info.ipv6 ?? address
}

export async function detectPublicIp(): Promise<PublicIpInfo> {
  const info: PublicIpInfo = { ipv4: null, ipv6: null, country: null, colo: null, source: '' }
  const sources = new Set<string>()

  const [trace, ipv4, ipv6] = await Promise.allSettled([
    fetchText('https://www.cloudflare.com/cdn-cgi/trace'),
    fetchJson('https://api.ipify.org?format=json'),
    fetchJson('https://api64.ipify.org?format=json'),
  ])

  if (trace.status === 'fulfilled') {
    const values = new Map<string, string>()
    for (const line of trace.value.split('\n')) {
      const index = line.indexOf('=')
      if (index > 0) values.set(line.slice(0, index).trim(), line.slice(index + 1).trim())
    }
    const ip = values.get('ip')
    if (ip) {
      assignIp(info, ip)
      info.country = values.get('loc') ?? null
      info.colo = values.get('colo') ?? null
      sources.add('cloudflare')
    }
  }

  if (ipv4.status === 'fulfilled') {
    const value = (ipv4.value as { ip?: unknown } | null)?.ip
    if (typeof value === 'string') {
      assignIp(info, value)
      sources.add('ipify-v4')
    }
  }
  if (ipv6.status === 'fulfilled') {
    const value = (ipv6.value as { ip?: unknown } | null)?.ip
    if (typeof value === 'string') {
      assignIp(info, value)
      sources.add('ipify-v6')
    }
  }

  if (!info.ipv4 && !info.ipv6) {
    throw new HttpError(502, 'upstream_error', 'Could not detect the public IP address from the deployment.')
  }
  info.source = [...sources].join('+') || 'unknown'
  return info
}

async function resolveDdns(raw: string): Promise<DdnsResult> {
  let host: string
  try {
    host = normalizeProbeHost(raw)
  } catch {
    return { host: raw.trim(), ipv4: [], ipv6: [], error: 'Enter a valid DDNS hostname.' }
  }
  try {
    const records = await withTimeout(dns.lookup(host, { all: true, verbatim: true }), DNS_TIMEOUT_MS)
    const ipv4: string[] = []
    const ipv6: string[] = []
    for (const record of records) {
      if (net.isIP(record.address) === 4) ipv4.push(record.address)
      else if (net.isIP(record.address) === 6) ipv6.push(record.address)
    }
    return { host, ipv4: [...new Set(ipv4)], ipv6: [...new Set(ipv6)], error: null }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return {
      host,
      ipv4: [],
      ipv6: [],
      error: code === 'ENOTFOUND' ? `The hostname ${host} does not exist.` : `DNS resolution failed for ${host}.`,
    }
  }
}

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`analyzer:${clientIp(event, context)}`, 8, 60_000)
  const parsed = analyzerRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))

  const publicIp = await detectPublicIp()
  const targetHost = parsed.data.host
    ? normalizeProbeHost(parsed.data.host)
    : publicIp.ipv4 ?? publicIp.ipv6
  if (!targetHost) throw new HttpError(502, 'upstream_error', 'No public target address is available.')

  const resolved = await resolveProbeAddresses(targetHost, { allowPrivate: false, allowPublic: true, allowCgnat: true })
  const expected = new Set([publicIp.ipv4, publicIp.ipv6].filter((entry): entry is string => Boolean(entry)))
  const address = resolved.addresses.find((entry) => expected.has(entry))
  if (!address) {
    throw new HttpError(
      403,
      'blocked_host',
      'Only the current public IP can be analyzed. The target must resolve to the detected public address.',
    )
  }

  const ddns = parsed.data.ddns ? await resolveDdns(parsed.data.ddns) : null
  const ports = [...new Set(parsed.data.ports ?? DEFAULT_ANALYZER_PORTS)].slice(0, 12)
  const probes = await probePorts(address, ports, targetHost, 1800)
  const checkedAt = new Date().toISOString()
  const report = buildAnalyzerReport({
    lang: parsed.data.lang,
    checkedAt,
    publicIp,
    target: { host: targetHost, address },
    ddns,
    ports: probes,
  })

  return json(200, {
    checkedAt,
    publicIp,
    target: { host: targetHost, address },
    ddns,
    ports: probes,
    report,
  })
})
