import { execFile } from 'node:child_process'
import nodeDns from 'node:dns'
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { assertPublicHost, normalizeHost } from './host'
import { classifyProbeAddress, normalizeProbeHost, probeTcp, resolveProbeAddresses } from './net-probe'
import type { PortProbeResult } from './net-analysis'
import { inspectCertificate } from './tls'

export interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
  errorCode: string | null
  timedOut: boolean
}

const MAX_COMMAND_OUTPUT = 256 * 1024

export function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: MAX_COMMAND_OUTPUT, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        const err = error as (NodeJS.ErrnoException & { killed?: boolean }) | null
        resolve({
          ok: !error,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          errorCode: err?.code ?? null,
          timedOut: Boolean(err?.killed),
        })
      },
    )
  })
}

export type ProbeFailureReason = 'unsupported' | 'permission_denied' | 'timeout' | 'dns_resolution_failed' | 'host_unreachable'

export interface PingReply {
  sequence: number
  latencyMs: number | null
  ttl: number | null
  status: 'success' | 'timeout' | 'unreachable' | 'error'
}

export interface PingResult {
  available: boolean
  target: string
  address: string
  location: 'server'
  attempts: number
  replies: PingReply[]
  summary: {
    sent: number
    received: number
    lossPercent: number
    minMs: number | null
    avgMs: number | null
    maxMs: number | null
  }
  reason: ProbeFailureReason | null
  note: string
  raw: string
}

function limited(text: string, max = 6000): string {
  const printable = Array.from(text)
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)
    })
    .join('')
  return printable.slice(0, max)
}

function pingCommand(address: string, count: number, timeoutMs: number): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return { command: 'ping', args: ['-n', String(count), '-w', String(timeoutMs), address] }
  }
  const wait = process.platform === 'darwin' ? String(timeoutMs) : String(Math.max(1, Math.ceil(timeoutMs / 1000)))
  return { command: 'ping', args: ['-c', String(count), '-W', wait, address] }
}

export function parsePingOutput(output: string, attempts: number): { replies: PingReply[]; lossPercent: number | null; ttl: number | null } {
  const replies: PingReply[] = []
  let sequence = 1
  for (const line of output.split(/\r?\n/)) {
    const timeMatch = line.match(/time[=<]\s*([\d.]+)\s*ms/i)
    const ttlMatch = line.match(/ttl[=\s:]+(\d+)/i)
    if (timeMatch) {
      replies.push({
        sequence: sequence++,
        latencyMs: Math.round(Number(timeMatch[1]) * 100) / 100,
        ttl: ttlMatch ? Number(ttlMatch[1]) : null,
        status: 'success',
      })
      continue
    }
    if (/request timed out|timed out/i.test(line)) {
      replies.push({ sequence: sequence++, latencyMs: null, ttl: null, status: 'timeout' })
      continue
    }
    if (/unreachable/i.test(line)) {
      replies.push({ sequence: sequence++, latencyMs: null, ttl: null, status: 'unreachable' })
    }
  }
  const lossMatch = output.match(/([\d.]+)\s*%\s*(?:loss|packet loss|فقد)/i)
  return {
    replies: replies.slice(0, attempts),
    lossPercent: lossMatch ? Number(lossMatch[1]) : null,
    ttl: replies.find((entry) => entry.ttl)?.ttl ?? null,
  }
}

export async function pingHost(rawHost: string, count = 4, timeoutMs = 1500): Promise<PingResult> {
  const target = await resolveProbeAddresses(rawHost, { allowPrivate: false, allowPublic: true })
  const address = target.addresses.find((entry) => net.isIP(entry) === 4) ?? target.addresses[0]
  const attempts = Math.min(10, Math.max(1, count))
  const { command, args } = pingCommand(address, attempts, Math.min(5000, Math.max(500, timeoutMs)))
  const result = await runCommand(command, args, attempts * (timeoutMs + 1200) + 2500)
  const combined = `${result.stdout}\n${result.stderr}`
  const parsed = parsePingOutput(combined, attempts)
  const received = parsed.replies.filter((entry) => entry.status === 'success').length
  const latencies = parsed.replies.filter((entry) => entry.status === 'success' && entry.latencyMs !== null).map((entry) => entry.latencyMs as number)
  const reason: ProbeFailureReason | null =
    result.errorCode === 'ENOENT'
      ? 'unsupported'
      : result.errorCode === 'EACCES' || result.errorCode === 'EPERM'
        ? 'permission_denied'
        : /unknown host|name or service not known|could not find host|not known/i.test(combined)
          ? 'dns_resolution_failed'
          : parsed.replies.length === 0 && result.timedOut
            ? 'timeout'
            : parsed.replies.length === 0
              ? 'host_unreachable'
              : null

  return {
    available: reason !== 'unsupported' && reason !== 'permission_denied',
    target: target.host,
    address,
    location: 'server',
    attempts,
    replies: parsed.replies,
    summary: {
      sent: attempts,
      received,
      lossPercent: parsed.lossPercent ?? Math.round(((attempts - received) / attempts) * 100),
      minMs: latencies.length ? Math.min(...latencies) : null,
      avgMs: latencies.length ? Math.round((latencies.reduce((sum, value) => sum + value, 0) / latencies.length) * 100) / 100 : null,
      maxMs: latencies.length ? Math.max(...latencies) : null,
    },
    reason,
    note:
      reason === 'unsupported'
        ? 'The runtime does not provide an ICMP ping utility.'
        : reason === 'permission_denied'
          ? 'The runtime denied permission to run ICMP ping.'
          : 'Blocked or filtered ICMP does not prove that a service is down. Firewalls often drop ping while the service remains reachable.',
    raw: limited(combined),
  }
}

export interface TracerouteHop {
  hop: number
  address: string | null
  hostname: string | null
  probes: Array<number | null>
  timedOut: boolean
}

export interface TracerouteResult {
  available: boolean
  target: string
  address: string
  location: 'server'
  maxHops: number
  hops: TracerouteHop[]
  totalHops: number
  reached: boolean
  reason: ProbeFailureReason | null
  note: string
  raw: string
}

export function parseTracerouteOutput(output: string, maxHops: number): TracerouteHop[] {
  const hops: TracerouteHop[] = []
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d{1,2})\s+(.+)$/)
    if (!match) continue
    const hopNumber = Number(match[1])
    if (hopNumber < 1 || hopNumber > maxHops) continue
    const rest = match[2]
    const probes: Array<number | null> = []
    const timeRegex = /(?:<\s*(\d+)|(\d+(?:\.\d+)?))\s*ms/g
    let timeMatch = timeRegex.exec(rest)
    while (timeMatch) {
      probes.push(Number(timeMatch[1] ?? timeMatch[2]))
      timeMatch = timeRegex.exec(rest)
    }
    const withoutTimes = rest.replace(timeRegex, ' ').replace(/ms\b/g, ' ')
    const ipv4 = withoutTimes.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)
    const ipv6 = withoutTimes.match(/\b(?:[a-f0-9]{1,4}:){2,}[a-f0-9]{1,4}\b/i)
    const address = ipv4?.[0] ?? ipv6?.[0] ?? null
    const nameMatch = withoutTimes.match(/\b([a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i)
    const timedOut = probes.length === 0 || rest.includes('*')
    if (!address && !timedOut) continue
    hops.push({
      hop: hopNumber,
      address,
      hostname: nameMatch && nameMatch[0] !== address ? nameMatch[0] : null,
      probes: probes.length ? probes : [null, null, null],
      timedOut,
    })
  }
  return hops.filter((entry, index, list) => list.findIndex((candidate) => candidate.hop === entry.hop) === index)
}

export async function tracerouteHost(rawHost: string, maxHops = 15, timeoutMs = 1500): Promise<TracerouteResult> {
  const target = await resolveProbeAddresses(rawHost, { allowPrivate: false, allowPublic: true })
  const address = target.addresses.find((entry) => net.isIP(entry) === 4) ?? target.addresses[0]
  const limit = Math.min(20, Math.max(1, maxHops))
  const wait = Math.min(5000, Math.max(500, timeoutMs))
  const primary =
    process.platform === 'win32'
      ? { command: 'tracert', args: ['-d', '-h', String(limit), '-w', String(wait), address] }
      : { command: 'traceroute', args: ['-n', '-m', String(limit), '-w', String(Math.max(1, Math.ceil(wait / 1000))), address] }
  let result = await runCommand(primary.command, primary.args, limit * (wait + 900) + 4000)
  let usedTracepath = false
  if (!result.ok && (result.errorCode === 'ENOENT' || result.errorCode === 'EACCES' || result.errorCode === 'EPERM') && process.platform !== 'win32') {
    usedTracepath = true
    result = await runCommand('tracepath', ['-n', '-m', String(limit), address], limit * (wait + 900) + 4000)
  }
  const combined = `${result.stdout}\n${result.stderr}`
  const hops = parseTracerouteOutput(combined, limit)
  const reached = hops.some((entry) => entry.address === address)
  const reason: ProbeFailureReason | null =
    result.errorCode === 'ENOENT'
      ? 'unsupported'
      : result.errorCode === 'EACCES' || result.errorCode === 'EPERM'
        ? 'permission_denied'
        : hops.length === 0 && result.timedOut
          ? 'timeout'
          : hops.length === 0
            ? 'host_unreachable'
            : null

  return {
    available: reason !== 'unsupported' && reason !== 'permission_denied',
    target: target.host,
    address,
    location: 'server',
    maxHops: limit,
    hops,
    totalHops: hops.length,
    reached,
    reason,
    note:
      reason === 'unsupported'
        ? 'Traceroute is not available in this runtime.'
        : usedTracepath
          ? 'The route was collected with tracepath because traceroute was unavailable. Some probes may be limited.'
          : 'A * * * hop means the router did not answer the probe; it does not necessarily mean the path is broken. ICMP may be filtered along the route.',
    raw: limited(combined),
  }
}

export const PUBLIC_PORT_ALLOWLIST = [21, 22, 25, 53, 80, 110, 143, 443, 465, 587, 636, 993, 995, 3389, 8080, 8443] as const

export interface PortCheckResult {
  target: string
  address: string
  location: 'server'
  checkedAt: string
  ports: PortProbeResult[]
  note: string
}

export async function checkPorts(rawHost: string, ports: number[]): Promise<PortCheckResult> {
  const target = await resolveProbeAddresses(rawHost, { allowPrivate: false, allowPublic: true })
  const address = target.addresses.find((entry) => net.isIP(entry) === 4) ?? target.addresses[0]
  const unique = [...new Set(ports)].slice(0, 4)
  const results = await Promise.all(unique.map((port) => probeTcp(address, port, target.host, 2400)))
  return {
    target: target.host,
    address,
    location: 'server',
    checkedAt: new Date().toISOString(),
    ports: results.sort((a, b) => a.port - b.port),
    note: 'A successful TCP connection only proves that a listener accepted a socket. It does not prove that the application is healthy. Do not scan systems you are not authorized to test.',
  }
}

export interface HttpHop {
  url: string
  status: number
  location: string | null
  latencyMs: number
}

export interface HttpCheckResult {
  requestedUrl: string
  finalUrl: string
  status: number
  statusText: string
  ok: boolean
  latencyMs: number
  method: string
  contentType: string | null
  contentLength: number | null
  redirects: HttpHop[]
  headers: Record<string, string>
  tls: Awaited<ReturnType<typeof inspectCertificate>> | null
  tlsError: string | null
  note: string
}

const HTTP_PORTS = new Set([80, 443, 8080, 8443, 8000, 8888])
const DEFAULT_TIMEOUT_MS = 8000
const MAX_REDIRECTS = 3
const SAFE_HEADERS = [
  'content-type',
  'content-length',
  'server',
  'cache-control',
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'location',
  'via',
  'age',
]

export function validateHttpUrl(raw: string): URL {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    throw new Error('Enter a valid absolute http:// or https:// URL.')
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only http:// and https:// URLs are supported.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('URLs with embedded credentials are not allowed.')
  }
  const port = parsed.port ? Number(parsed.port) : parsed.protocol === 'https:' ? 443 : 80
  if (!HTTP_PORTS.has(port)) {
    throw new Error(`Only these ports are supported for HTTP checks: ${[...HTTP_PORTS].join(', ')}.`)
  }
  if (parsed.hostname.length > 253) throw new Error('The hostname is too long.')
  return parsed
}

function requestHop(url: URL, method: string, timeoutMs: number): Promise<{
  status: number
  statusText: string
  headers: http.IncomingHttpHeaders
  latencyMs: number
}> {
  return new Promise((resolve, reject) => {
    const isHttps = url.protocol === 'https:'
    const startedAt = Date.now()
    let settled = false
    const finish = (error: Error | null, value?: { status: number; statusText: string; headers: http.IncomingHttpHeaders; latencyMs: number }) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else if (value) resolve(value)
    }
    const request = (isHttps ? https : http).request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method,
        timeout: timeoutMs,
        headers: {
          Host: url.host,
          'User-Agent': 'NEXORA-Diagnostics/1.0',
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
          'Accept-Encoding': 'identity',
          Connection: 'close',
        },
        lookup: (hostname, _options, callback) => {
          nodeDns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
            if (error) {
              callback(error, '', 0)
              return
            }
            if (addresses.length === 0) {
              callback(new Error('The destination did not resolve.'), '', 0)
              return
            }
            if (addresses.some((entry) => classifyProbeAddress(entry.address) !== 'public')) {
              callback(new Error('The destination resolves to a private or reserved address.'), '', 0)
              return
            }
            const chosen = addresses.find((entry) => entry.family === 4) ?? addresses[0]
            callback(null, chosen.address, chosen.family)
          })
        },
      },
      (response) => {
        const latencyMs = Date.now() - startedAt
        response.resume()
        finish(null, {
          status: response.statusCode ?? 0,
          statusText: response.statusMessage ?? '',
          headers: response.headers,
          latencyMs,
        })
      },
    )
    request.once('timeout', () => {
      request.destroy(new Error('The request timed out.'))
    })
    request.once('error', (error) => finish(error))
    request.end()
  })
}

export async function checkHttp(rawUrl: string, method: 'HEAD' | 'GET' = 'HEAD', followRedirects = true, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<HttpCheckResult> {
  let current = validateHttpUrl(rawUrl)
  await assertPublicHost(current.hostname)
  const redirects: HttpHop[] = []
  const startedAt = Date.now()
  const effectiveMethod = method === 'GET' ? 'GET' : 'HEAD'
  let last: { status: number; statusText: string; headers: http.IncomingHttpHeaders; latencyMs: number } | null = null

  for (let step = 0; step <= MAX_REDIRECTS; step += 1) {
    last = await requestHop(current, effectiveMethod, Math.min(15000, Math.max(1500, timeoutMs)))
    const location = typeof last.headers.location === 'string' ? last.headers.location : null
    const isRedirect = last.status >= 300 && last.status < 400 && Boolean(location)
    if (!isRedirect || !followRedirects) break
    const nextRaw = new URL(location as string, current).toString()
    const next = validateHttpUrl(nextRaw)
    await assertPublicHost(next.hostname)
    redirects.push({ url: current.toString(), status: last.status, location: next.toString(), latencyMs: last.latencyMs })
    current = next
  }

  const latencyMs = Date.now() - startedAt
  const headers: Record<string, string> = {}
  for (const key of SAFE_HEADERS) {
    const value = last?.headers[key]
    if (typeof value === 'string') headers[key] = value
    else if (Array.isArray(value)) headers[key] = value.join(', ')
  }
  const contentLengthRaw = last?.headers['content-length']
  const contentLength = typeof contentLengthRaw === 'string' && Number.isFinite(Number(contentLengthRaw)) ? Number(contentLengthRaw) : null

  let tls: HttpCheckResult['tls'] = null
  let tlsError: string | null = null
  if (current.protocol === 'https:') {
    try {
      const port = current.port ? Number(current.port) : 443
      tls = await inspectCertificate(current.hostname, port, 7000)
    } catch (error) {
      tlsError = error instanceof Error ? error.message : 'TLS inspection failed.'
    }
  }

  return {
    requestedUrl: rawUrl,
    finalUrl: current.toString(),
    status: last?.status ?? 0,
    statusText: last?.statusText ?? '',
    ok: Boolean(last && last.status >= 200 && last.status < 400),
    latencyMs,
    method: effectiveMethod,
    contentType: headers['content-type'] ?? null,
    contentLength,
    redirects,
    headers,
    tls,
    tlsError,
    note: 'This check validates the HTTP response from the platform server. It is not a full security assessment and does not fetch page content.',
  }
}

export type UrlSignalSeverity = 'info' | 'low' | 'medium' | 'high'

export interface UrlSignal {
  id: string
  severity: UrlSignalSeverity
  title: string
  detail: string
}

export interface UrlAnalysisResult {
  checkedAt: string
  input: string
  url: string
  host: string
  domain: string
  protocol: string
  signals: UrlSignal[]
  verdict: 'no-obvious-indicators' | 'suspicious-indicators-found' | 'analysis-inconclusive' | 'external-reputation-unavailable'
  dns: { addresses: string[] } | null
  dnsError: string | null
  http: HttpCheckResult | null
  httpError: string | null
  tls: { issuer: string; validTo: string; daysRemaining: number } | null
  tlsError: string | null
  externalReputation: {
    status: 'unavailable'
    provider: null
    reason: string
  }
  limitations: string[]
}

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'shorturl.at', 'rebrand.ly'])
const SENSITIVE_WORDS = ['login', 'signin', 'verify', 'secure', 'account', 'update', 'password', 'wallet', 'billing', 'recovery', 'support']

export async function analyzeUrl(rawUrl: string): Promise<UrlAnalysisResult> {
  const url = validateHttpUrl(rawUrl)
  await assertPublicHost(url.hostname)
  const host = url.hostname.toLowerCase()
  const domain = host.replace(/^www\./, '')
  const signals: UrlSignal[] = []

  if (net.isIP(host)) {
    signals.push({
      id: 'ip-host',
      severity: 'medium',
      title: 'Direct IP address',
      detail: 'The link uses a raw IP address instead of a domain name. Legitimate services sometimes do this, but it removes domain ownership context.',
    })
  }
  if (host.split('.').some((label) => label.startsWith('xn--'))) {
    signals.push({
      id: 'punycode',
      severity: 'high',
      title: 'Punycode hostname',
      detail: 'The hostname contains Punycode. This can be legitimate for international domains, but it is also used to imitate familiar names visually.',
    })
  }
  if (url.username || url.password) {
    signals.push({
      id: 'credentials',
      severity: 'high',
      title: 'Embedded credentials',
      detail: 'The URL contains a username or password before the hostname. This pattern is commonly used to disguise the real destination.',
    })
  }
  if (url.port && !['80', '443', ''].includes(url.port)) {
    signals.push({
      id: 'non-standard-port',
      severity: 'low',
      title: 'Non-standard port',
      detail: `The link uses port ${url.port}. Confirm that the service is expected to run on this port.`,
    })
  }
  if (url.protocol === 'http:') {
    signals.push({
      id: 'plain-http',
      severity: 'medium',
      title: 'Unencrypted HTTP',
      detail: 'Traffic over http:// is not encrypted in transit. Do not submit credentials or sensitive data.',
    })
  }
  if (SHORTENERS.has(domain)) {
    signals.push({
      id: 'shortener',
      severity: 'info',
      title: 'URL shortener',
      detail: 'The final destination is hidden by a shortener. The redirect chain is evaluated when the server can follow it.',
    })
  }
  const lowerPath = `${url.pathname}${url.search}`.toLowerCase()
  const foundWords = SENSITIVE_WORDS.filter((word) => lowerPath.includes(word) || domain.includes(word))
  if (foundWords.length > 0) {
    signals.push({
      id: 'sensitive-keywords',
      severity: 'low',
      title: 'Sensitive keywords in URL',
      detail: `The URL contains: ${foundWords.join(', ')}. Keywords alone are not evidence of phishing.`,
    })
  }
  if (host.split('.').length > 4) {
    signals.push({
      id: 'many-subdomains',
      severity: 'low',
      title: 'Deep subdomain chain',
      detail: 'The hostname has several subdomain levels. Check that the registered domain is the one you expect.',
    })
  }
  if (url.toString().length > 120) {
    signals.push({
      id: 'long-url',
      severity: 'low',
      title: 'Unusually long URL',
      detail: 'Long URLs can hide the destination or carry encoded parameters. Review the hostname before clicking.',
    })
  }
  if (Array.from(url.hostname).some((character) => (character.codePointAt(0) ?? 0) > 127)) {
    signals.push({
      id: 'unicode-host',
      severity: 'medium',
      title: 'Internationalized hostname',
      detail: 'The hostname contains non-ASCII characters. Confirm that the displayed name matches the intended domain.',
    })
  }

  let dnsResult: { addresses: string[] } | null = null
  let dnsError: string | null = null
  try {
    const records = await dns.lookup(url.hostname, { all: true, verbatim: true })
    dnsResult = { addresses: records.map((entry) => entry.address) }
  } catch {
    dnsError = 'DNS resolution failed for this hostname.'
    signals.push({ id: 'dns-failure', severity: 'medium', title: 'DNS resolution failed', detail: 'The hostname did not resolve at analysis time. The service may be unavailable or the domain may not exist.' })
  }

  let httpResult: HttpCheckResult | null = null
  let httpError: string | null = null
  try {
    httpResult = await checkHttp(url.toString(), 'HEAD', true, 8000)
  } catch (error) {
    httpError = error instanceof Error ? error.message : 'The HTTP check failed.'
    signals.push({ id: 'http-error', severity: 'info', title: 'HTTP check unavailable', detail: httpError })
  }

  if (httpResult) {
    if (httpResult.redirects.length > 0) {
      signals.push({
        id: 'redirects',
        severity: 'info',
        title: `${httpResult.redirects.length} redirect${httpResult.redirects.length === 1 ? '' : 's'}`,
        detail: `The final destination is ${httpResult.finalUrl}. Every redirect was re-validated against private address ranges.`,
      })
    }
    if (httpResult.finalUrl !== url.toString()) {
      const finalHost = new URL(httpResult.finalUrl).hostname.toLowerCase()
      if (finalHost.replace(/^www\./, '') !== domain) {
        signals.push({
          id: 'cross-domain-redirect',
          severity: 'medium',
          title: 'Cross-domain redirect',
          detail: `The link redirects to a different domain: ${finalHost}. Verify that this destination is expected.`,
        })
      }
    }
    if (httpResult.tls?.daysRemaining !== undefined && httpResult.tls.daysRemaining < 15) {
      signals.push({
        id: 'tls-expiring',
        severity: 'medium',
        title: 'Certificate expires soon',
        detail: `The TLS certificate expires in ${httpResult.tls.daysRemaining} days.`,
      })
    }
    if (httpResult.status >= 400) {
      signals.push({
        id: 'http-status',
        severity: 'info',
        title: `HTTP ${httpResult.status}`,
        detail: 'The server returned an error status. This may be expected for a protected or missing page.',
      })
    }
  }

  const severe = signals.filter((entry) => entry.severity === 'high').length
  const medium = signals.filter((entry) => entry.severity === 'medium').length
  const verdict =
    severe > 0 || medium >= 2
      ? 'suspicious-indicators-found'
      : dnsError || httpError
        ? 'analysis-inconclusive'
        : 'no-obvious-indicators'

  return {
    checkedAt: new Date().toISOString(),
    input: rawUrl,
    url: url.toString(),
    host,
    domain,
    protocol: url.protocol.replace(':', ''),
    signals,
    verdict,
    dns: dnsResult,
    dnsError,
    http: httpResult,
    httpError,
    tls: httpResult?.tls ? { issuer: httpResult.tls.issuer, validTo: httpResult.tls.validTo, daysRemaining: httpResult.tls.daysRemaining } : null,
    tlsError: httpResult?.tlsError ?? null,
    externalReputation: {
      status: 'unavailable',
      provider: null,
      reason: 'No external reputation provider is configured. This analysis uses structural URL signals and live connection checks only.',
    },
    limitations: [
      'No verdict here proves that a link is safe or malicious.',
      'External reputation and malware feeds are not configured on this deployment.',
      'Certificate revocation and transparency logs are not evaluated.',
    ],
  }
}

export { normalizeHost, normalizeProbeHost }


