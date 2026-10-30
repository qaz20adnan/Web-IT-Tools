import nodeDns from 'node:dns'
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import { assertPublicHost, normalizeHost } from './host'
import { HttpError } from './http'
import { classifyProbeAddress, normalizeProbeHost, probeTcp, resolveProbeAddresses } from './net-probe'
import type { PortProbeResult } from './net-analysis'
import { describeHttpFailure, describeTlsFailure } from './net-errors'
import { inspectCertificate } from './tls'

export const MAX_PORT_PROBES = 8

export interface PortCheckResult {
  target: string
  address: string
  location: 'server'
  checkedAt: string
  ports: PortProbeResult[]
  scope: 'public' | 'private'
  timeoutMs: number
  note: string
}

export async function checkPorts(
  rawHost: string,
  ports: number[],
  options: { allowPrivate?: boolean; timeoutMs?: number } = {},
): Promise<PortCheckResult> {
  const allowPrivate = options.allowPrivate === true
  const timeoutMs = Math.min(10_000, Math.max(500, options.timeoutMs ?? 2400))
  const target = await resolveProbeAddresses(rawHost, { allowPrivate, allowPublic: true, allowLoopback: allowPrivate })
  const address = target.addresses.find((entry) => net.isIP(entry) === 4) ?? target.addresses[0]
  const unique = [...new Set(ports)].slice(0, MAX_PORT_PROBES)
  if (unique.length === 0) throw new Error('At least one port is required.')
  const results = await Promise.all(unique.map((port) => probeTcp(address, port, target.host, timeoutMs)))
  const scope = target.addresses.every((entry) => classifyProbeAddress(entry) !== 'public') ? 'private' : 'public'
  return {
    target: target.host,
    address,
    location: 'server',
    checkedAt: new Date().toISOString(),
    ports: results.sort((a, b) => a.port - b.port),
    scope,
    timeoutMs,
    note:
      'A successful TCP connection only proves that a listener accepted a socket. It does not prove that the application is healthy. ' +
      'A timeout or filtered result is inconclusive and does not prove the port is closed. Do not scan systems you are not authorized to test.',
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
          'User-Agent': 'AdnanTech-Diagnostics/1.0',
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5',
          'Accept-Encoding': 'identity',
          Connection: 'close',
        },
        lookup: (hostname, options, callback) => {
          const wantsAll = Boolean((options as { all?: boolean } | undefined)?.all)
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
            // The socket asks for either one address or the whole list; answering with the
            // other shape leaves it reading `undefined[0]` and the connect dies before egress.
            if (wantsAll) {
              callback(null, addresses)
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
      tlsError = describeTlsFailure(error)
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
  try {
    await assertPublicHost(url.hostname)
  } catch (error) {
    // A host that does not resolve is inert, so keep analyzing it for link-based
    // signals. Every other rejection is a policy block and must stay fatal.
    if (!(error instanceof HttpError) || error.statusCode !== 400 || error.code !== 'blocked_host') throw error
  }
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
    httpError = describeHttpFailure(error)
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


