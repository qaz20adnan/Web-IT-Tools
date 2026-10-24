import dns from 'node:dns/promises'
import http from 'node:http'
import net from 'node:net'
import { HttpError } from './http'
import { detectService, isCgnat, type PortProbeResult, type PortState } from './net-analysis'

export interface ResolvedProbeTarget {
  host: string
  addresses: string[]
}

export interface ProbePolicy {
  allowPrivate: boolean
  allowPublic: boolean
  allowCgnat?: boolean
}

export interface IppPrinterInfo {
  ok: boolean
  path: string | null
  statusCode: number | null
  statusName: string | null
  name: string | null
  model: string | null
  state: string | null
  stateReasons: string[]
  queuedJobs: number | null
  acceptingJobs: boolean | null
}

const BLOCKED_SUFFIXES = ['.local', '.internal', '.localhost', '.home.arpa']
const HTTP_PROBE_PORTS = new Set([80, 8080, 8000, 8888, 3000, 5000, 9000])
const READ_GRACE_MS = 700
const DNS_TIMEOUT_MS = 4000

async function lookupAll(host: string): Promise<Array<{ address: string; family: number }>> {
  let timer: NodeJS.Timeout | null = null
  try {
    return await Promise.race([
      dns.lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out.')), DNS_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type IpScope = 'public' | 'private' | 'blocked'

function classifyIpv4(address: string): IpScope {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return 'blocked'
  const [a, b] = parts
  if (a === 0 || a === 127 || a === 255 || a >= 224) return 'blocked'
  if (a === 169 && b === 254) return 'blocked'
  if (a === 192 && b === 0 && parts[2] === 0) return 'blocked'
  if (a === 198 && (b === 18 || b === 19)) return 'blocked'
  if (a === 192 && b === 0 && parts[2] === 2) return 'blocked'
  if (a === 198 && b === 51 && parts[2] === 100) return 'blocked'
  if (a === 203 && b === 0 && parts[2] === 113) return 'blocked'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private'
  if (a === 100 && b >= 64 && b <= 127) return 'private'
  return 'public'
}

function classifyIpv6(address: string): IpScope {
  const value = address.toLowerCase()
  if (value === '::' || value === '::1') return 'blocked'
  if (value.startsWith('fe80') || value.startsWith('fec0') || value.startsWith('ff')) return 'blocked'
  if (value.startsWith('2001:db8')) return 'blocked'
  if (value.startsWith('fc') || value.startsWith('fd')) return 'private'
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return classifyIpv4(mapped[1])
  return 'public'
}

export function classifyProbeAddress(address: string): IpScope {
  const family = net.isIP(address)
  if (family === 4) return classifyIpv4(address)
  if (family === 6) return classifyIpv6(address)
  return 'blocked'
}

export function normalizeProbeHost(raw: string): string {
  const value = raw.trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!value || value.length > 253) throw new HttpError(400, 'invalid_input', 'Enter a valid IP address or hostname.')
  if (net.isIP(value)) return value
  if (value.includes('/') || value.includes('://') || /\s/.test(value)) {
    throw new HttpError(400, 'invalid_input', 'Enter a hostname or IP address, not a URL or path.')
  }
  if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(value)) {
    throw new HttpError(400, 'invalid_input', 'Enter a valid hostname or IP address.')
  }
  if (BLOCKED_SUFFIXES.some((suffix) => value.endsWith(suffix))) {
    throw new HttpError(403, 'blocked_host', 'Internal hostnames are not allowed.')
  }
  return value
}

export async function resolveProbeAddresses(rawHost: string, policy: ProbePolicy): Promise<ResolvedProbeTarget> {
  const host = normalizeProbeHost(rawHost)
  let addresses: string[]
  if (net.isIP(host)) {
    addresses = [host]
  } else {
    try {
      const results = await lookupAll(host)
      addresses = results.map((entry) => entry.address)
    } catch {
      throw new HttpError(400, 'invalid_input', 'The hostname could not be resolved.')
    }
  }
  if (addresses.length === 0) throw new HttpError(400, 'invalid_input', 'The hostname did not resolve to an address.')

  const scopes = addresses.map((address) => {
    const scope = classifyProbeAddress(address)
    return scope === 'private' && policy.allowCgnat && isCgnat(address) ? 'public' : scope
  })
  if (scopes.includes('blocked')) {
    throw new HttpError(403, 'blocked_host', 'Loopback, link-local, multicast and reserved addresses are not allowed.')
  }
  if (!policy.allowPrivate && scopes.includes('private')) {
    throw new HttpError(403, 'blocked_host', 'Private network probes are available only when the app runs locally or self-hosted.')
  }
  if (!policy.allowPublic && scopes.includes('public')) {
    throw new HttpError(403, 'blocked_host', 'Public targets are disabled for this probe.')
  }
  if (policy.allowPrivate && !policy.allowPublic && scopes.some((scope) => scope !== 'private')) {
    throw new HttpError(403, 'blocked_host', 'This probe accepts private network addresses only.')
  }
  if (!policy.allowPrivate && policy.allowPublic && scopes.some((scope) => scope !== 'public')) {
    throw new HttpError(403, 'blocked_host', 'This probe accepts public addresses only.')
  }
  return { host, addresses }
}

function sanitizeBanner(value: string): string | null {
  const cleaned = value
    .replace(/[^\x20-\x7e\r\n\t]/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, 240) : null
}

function stateForError(code: string | undefined): PortState {
  if (code === 'ECONNREFUSED') return 'closed'
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT') return 'timeout'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return 'filtered'
  return 'error'
}

export function probeTcp(address: string, port: number, hostHeader: string, timeoutMs = 1800): Promise<PortProbeResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let settled = false
    let connected = false
    let buffer = ''
    let graceTimer: NodeJS.Timeout | null = null
    let hardTimer: NodeJS.Timeout | null = null

    const socket = net.createConnection({ host: address, port })

    const finish = (state: PortState, errorCode: string | null = null) => {
      if (settled) return
      settled = true
      if (graceTimer) clearTimeout(graceTimer)
      if (hardTimer) clearTimeout(hardTimer)
      const banner = sanitizeBanner(buffer)
      socket.destroy()
      resolve({
        port,
        state,
        latencyMs: connected ? Date.now() - startedAt : null,
        service: detectService(port, banner),
        banner,
        errorCode,
      })
    }

    hardTimer = setTimeout(() => finish(connected ? 'open' : 'timeout'), timeoutMs)

    socket.once('connect', () => {
      connected = true
      if (HTTP_PROBE_PORTS.has(port)) {
        const host = net.isIP(hostHeader) === 6 ? `[${hostHeader}]` : hostHeader
        socket.write(
          `HEAD / HTTP/1.0\r\nHost: ${host}\r\nUser-Agent: NEXORA-Network-Analyzer/1.0\r\nAccept: */*\r\nConnection: close\r\n\r\n`,
        )
      }
      graceTimer = setTimeout(() => finish('open'), READ_GRACE_MS)
    })

    socket.on('data', (chunk: Buffer) => {
      if (buffer.length < 4096) buffer += chunk.toString('latin1')
      if (buffer.length >= 120) finish('open')
    })
    socket.once('end', () => finish(connected ? 'open' : 'closed'))
    socket.once('close', () => {
      if (!settled) finish(connected ? 'open' : 'closed')
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish(connected ? 'open' : stateForError(error.code), error.code ?? error.message)
    })
  })
}

export async function probePorts(
  address: string,
  ports: number[],
  hostHeader: string,
  timeoutMs = 1800,
  concurrency = 6,
): Promise<PortProbeResult[]> {
  const results: PortProbeResult[] = new Array(ports.length)
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, ports.length) }, async () => {
    while (index < ports.length) {
      const current = index
      index += 1
      results[current] = await probeTcp(address, ports[current], hostHeader, timeoutMs)
    }
  })
  await Promise.all(workers)
  return results.sort((a, b) => a.port - b.port)
}

const IPP_STATUS: Record<number, string> = {
  0x0000: 'successful-ok',
  0x0001: 'successful-ok-ignored-or-substituted-attributes',
  0x0400: 'client-error-bad-request',
  0x0401: 'client-error-forbidden',
  0x0402: 'client-error-not-authenticated',
  0x0403: 'client-error-not-authorized',
  0x0404: 'client-error-not-possible',
  0x0405: 'client-error-timeout',
  0x0406: 'client-error-not-found',
  0x0407: 'client-error-gone',
  0x0408: 'client-error-request-entity-too-large',
  0x0409: 'client-error-request-value-too-long',
  0x040a: 'client-error-document-format-not-supported',
  0x040b: 'client-error-attributes-or-values-not-supported',
  0x040c: 'client-error-uri-scheme-not-supported',
  0x040d: 'client-error-charset-not-supported',
  0x040e: 'client-error-conflicting-attributes',
  0x040f: 'client-error-compression-not-supported',
  0x0410: 'client-error-compression-error',
  0x0411: 'client-error-document-format-error',
  0x0412: 'client-error-document-access-error',
  0x0500: 'server-error-internal-error',
  0x0501: 'server-error-operation-not-supported',
  0x0502: 'server-error-service-unavailable',
  0x0503: 'server-error-version-not-supported',
  0x0504: 'server-error-device-error',
  0x0505: 'server-error-temporary-error',
  0x0506: 'server-error-not-accepting-jobs',
  0x0507: 'server-error-busy',
  0x0508: 'server-error-job-canceled',
  0x0509: 'server-error-multiple-document-jobs-not-supported',
}

export interface ParsedIppResponse {
  statusCode: number
  statusName: string
  attributes: Record<string, string[]>
}

function decodeIppValue(tag: number, value: Buffer): string {
  if (tag === 0x21) return value.length >= 4 ? String(value.readInt32BE(0)) : ''
  if (tag === 0x23) return value.length >= 4 ? String(value.readUInt32BE(0)) : ''
  if (tag === 0x22) return value.length >= 1 && value[0] !== 0 ? 'true' : 'false'
  return value.toString('utf8')
}

export function parseIppResponse(buffer: Buffer): ParsedIppResponse {
  if (buffer.length < 8) throw new Error('IPP response is too short.')
  const statusCode = buffer.readUInt16BE(2)
  const attributes: Record<string, string[]> = {}
  let offset = 8
  let currentName = ''

  while (offset < buffer.length) {
    const tag = buffer[offset]
    offset += 1
    if (tag === 0x03) break
    if (tag <= 0x0f) {
      currentName = ''
      continue
    }
    if (offset + 4 > buffer.length) break
    const nameLength = buffer.readUInt16BE(offset)
    const valueLength = buffer.readUInt16BE(offset + 2)
    offset += 4
    if (offset + nameLength > buffer.length) break
    if (nameLength > 0) {
      currentName = buffer.toString('utf8', offset, offset + nameLength)
    }
    offset += nameLength
    if (offset + valueLength > buffer.length) break
    const value = decodeIppValue(tag, buffer.subarray(offset, offset + valueLength))
    offset += valueLength
    if (!currentName) continue
    if (!attributes[currentName]) attributes[currentName] = []
    attributes[currentName].push(value)
  }

  return {
    statusCode,
    statusName: IPP_STATUS[statusCode] ?? `status-0x${statusCode.toString(16).padStart(4, '0')}`,
    attributes,
  }
}

function ippAttribute(tag: number, name: string, value: string): Buffer {
  const nameBuffer = Buffer.from(name, 'utf8')
  const valueBuffer = Buffer.from(value, 'utf8')
  const header = Buffer.alloc(5)
  header[0] = tag
  header.writeUInt16BE(nameBuffer.length, 1)
  header.writeUInt16BE(valueBuffer.length, 3)
  return Buffer.concat([header, nameBuffer, valueBuffer])
}

function buildIppRequest(host: string, port: number, path: string): Buffer {
  const printerHost = net.isIP(host) === 6 ? `[${host}]` : host
  const printerUri = `ipp://${printerHost}:${port}${path}`
  const requested = [
    'printer-name',
    'printer-state',
    'printer-state-reasons',
    'queued-job-count',
    'printer-make-and-model',
    'printer-is-accepting-jobs',
  ]
  const parts: Buffer[] = []
  const header = Buffer.alloc(8)
  header[0] = 1
  header[1] = 1
  header.writeUInt16BE(0x000b, 2)
  header.writeUInt32BE(1, 4)
  parts.push(header)
  parts.push(ippAttribute(0x47, 'attributes-charset', 'utf-8'))
  parts.push(ippAttribute(0x48, 'attributes-natural-language', 'en'))
  parts.push(ippAttribute(0x45, 'printer-uri', printerUri))
  requested.forEach((name, index) => parts.push(ippAttribute(0x44, index === 0 ? 'requested-attributes' : '', name)))
  parts.push(Buffer.from([0x03]))
  return Buffer.concat(parts)
}

function requestIpp(address: string, host: string, port: number, path: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const payload = buildIppRequest(host, port, path)
    const request = http.request(
      {
        host: address,
        port,
        path,
        method: 'POST',
        timeout: 2500,
        headers: {
          Host: net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`,
          'Content-Type': 'application/ipp',
          Accept: 'application/ipp',
          'Content-Length': payload.length,
          'User-Agent': 'NEXORA-Printer-Diagnostics/1.0',
          Connection: 'close',
        },
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 128 * 1024) {
            request.destroy(new Error('IPP response was too large.'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }))
      },
    )
    request.once('timeout', () => request.destroy(new Error('IPP request timed out.')))
    request.once('error', reject)
    request.end(payload)
  })
}

function numberOrNull(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function printerStateLabel(value: string | undefined): string | null {
  if (value === '3') return 'idle'
  if (value === '4') return 'processing'
  if (value === '5') return 'stopped'
  return value ?? null
}

export async function probeIppPrinter(address: string, host: string, port = 631): Promise<IppPrinterInfo> {
  const paths = ['/ipp/print', '/', '/printers']
  let last: IppPrinterInfo | null = null

  for (const path of paths) {
    try {
      const response = await requestIpp(address, host, port, path)
      if (response.status !== 200 || response.body.length < 8) {
        last = {
          ok: false,
          path,
          statusCode: response.status,
          statusName: `http-${response.status}`,
          name: null,
          model: null,
          state: null,
          stateReasons: [],
          queuedJobs: null,
          acceptingJobs: null,
        }
        continue
      }
      const parsed = parseIppResponse(response.body)
      const attributes = parsed.attributes
      const info: IppPrinterInfo = {
        ok: parsed.statusCode < 0x0400,
        path,
        statusCode: parsed.statusCode,
        statusName: parsed.statusName,
        name: attributes['printer-name']?.[0] ?? null,
        model: attributes['printer-make-and-model']?.[0] ?? null,
        state: printerStateLabel(attributes['printer-state']?.[0]),
        stateReasons: attributes['printer-state-reasons'] ?? [],
        queuedJobs: numberOrNull(attributes['queued-job-count']?.[0]),
        acceptingJobs:
          attributes['printer-is-accepting-jobs']?.[0] === undefined
            ? null
            : attributes['printer-is-accepting-jobs'][0] === 'true',
      }
      if (info.ok) return info
      last = info
    } catch (error) {
      last = {
        ok: false,
        path,
        statusCode: null,
        statusName: error instanceof Error ? error.message.slice(0, 120) : 'ipp-error',
        name: null,
        model: null,
        state: null,
        stateReasons: [],
        queuedJobs: null,
        acceptingJobs: null,
      }
    }
  }

  return last ?? {
    ok: false,
    path: null,
    statusCode: null,
    statusName: 'ipp-unreachable',
    name: null,
    model: null,
    state: null,
    stateReasons: [],
    queuedJobs: null,
    acceptingJobs: null,
  }
}
