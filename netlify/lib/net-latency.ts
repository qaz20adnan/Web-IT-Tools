import net from 'node:net'
import { HttpError } from './http'
import { resolveDoh } from './net-doh'
import { classifyProbeAddress, normalizeProbeHost, connectRtt, resolveProbeAddresses, type ResolvedProbeTarget } from './net-probe'

/**
 * TCP reachability and latency sampling — the replacement for ICMP ping.
 *
 * The sandbox has no `ping` binary and ICMP needs raw sockets, so every previous
 * call returned `available: false`. Repeated TCP connects measure what an support
 * engineer actually wants to know from the internet side: does the service accept
 * connections, how fast, and how unstable is the path.
 */

const SAMPLE_GAP_MS = 120
/** Netlify gives synchronous functions ~10 s, so the whole probe is bounded. */
const TOTAL_BUDGET_MS = 8000

export interface LatencySample {
  sequence: number
  address: string
  ok: boolean
  latencyMs: number | null
  /** A fixed code such as `ECONNREFUSED` or `ETIMEDOUT`, never a thrown message. */
  errorCode: string | null
  /**
   * `platform` means this runtime could not originate the connection at all —
   * typically an IPv6 target with no IPv6 egress. Those attempts say nothing
   * about the target, so they are excluded from the loss figure.
   */
  failureKind: 'target' | 'platform' | null
}

export interface LatencySummary {
  sent: number
  connected: number
  failed: number
  platformFailures: number
  lossPercent: number
  minMs: number | null
  maxMs: number | null
  avgMs: number | null
  jitterMs: number | null
}

export interface LatencyProbeResult {
  target: string
  address: string
  addresses: string[]
  port: number
  protocol: 'tcp'
  samples: LatencySample[]
  summary: LatencySummary
  truncated: boolean
  elapsedMs: number
  checkedAt: string
  note: string | null
}

/** Codes that describe our own socket limits or missing route, not the target's behaviour. */
const PLATFORM_CODES = new Set(['EADDRNOTAVAIL', 'ENETUNREACH', 'EHOSTUNREACH', 'EMFILE', 'ENFILE', 'ENOBUFS', 'EINVAL'])

function failureKind(address: string, errorCode: string | null): 'target' | 'platform' | null {
  if (!errorCode) return null
  if (PLATFORM_CODES.has(errorCode)) return 'platform'
  if (net.isIP(address) === 6 && errorCode === 'ECONNREFUSED') return 'target'
  return 'target'
}

function summarise(samples: LatencySample[]): LatencySummary {
  const platformFailures = samples.filter((entry) => entry.failureKind === 'platform').length
  const attributable = samples.filter((entry) => entry.failureKind !== 'platform')
  const latencies = attributable.filter((entry) => entry.ok && entry.latencyMs !== null).map((entry) => entry.latencyMs as number)
  const received = latencies.length
  const average = received ? latencies.reduce((total, value) => total + value, 0) / received : null
  // RFC 3550 style smoothed jitter over the consecutive successful samples.
  let jitter = 0
  for (let index = 1; index < latencies.length; index += 1) {
    jitter += Math.abs(latencies[index] - latencies[index - 1])
  }
  return {
    sent: attributable.length,
    connected: received,
    failed: attributable.length - received,
    platformFailures,
    lossPercent: attributable.length ? Math.round(((attributable.length - received) / attributable.length) * 1000) / 10 : 0,
    minMs: received ? Math.min(...latencies) : null,
    maxMs: received ? Math.max(...latencies) : null,
    avgMs: average === null ? null : Math.round(average * 100) / 100,
    jitterMs: latencies.length > 1 ? Math.round((jitter / (latencies.length - 1)) * 100) / 100 : null,
  }
}

const PUBLIC_ONLY = { allowPrivate: false, allowPublic: true }

/**
 * A runtime whose own resolver is blocked should not stop an internet-side
 * measurement, so the name is asked of public resolvers before giving up.
 */
async function resolveTarget(rawHost: string): Promise<ResolvedProbeTarget> {
  try {
    return await resolveProbeAddresses(rawHost, PUBLIC_ONLY)
  } catch (error) {
    const nameUnresolved = error instanceof HttpError && error.code === 'invalid_input' && /resolv/i.test(error.message)
    if (!nameUnresolved) throw error
    const answers = await resolveDoh(rawHost, 'A')
    const publicAddresses = [
      ...new Set(answers.flatMap((entry) => entry.answers.filter((answer) => answer.type === 'A').map((answer) => answer.data))),
    ].filter((address) => classifyProbeAddress(address) === 'public')
    if (publicAddresses.length === 0) throw error
    await resolveProbeAddresses(publicAddresses[0], PUBLIC_ONLY)
    return { host: normalizeProbeHost(rawHost), addresses: publicAddresses }
  }
}

export async function probeLatency(rawHost: string, port: number, requestedSamples: number, timeoutMs: number): Promise<LatencyProbeResult> {
  const target = await resolveTarget(rawHost)
  const preferred = target.addresses.find((entry) => net.isIP(entry) === 4) ?? target.addresses[0]
  const startedAt = Date.now()
  const deadline = startedAt + TOTAL_BUDGET_MS
  const samples: LatencySample[] = []
  const notes: string[] = []
  let rotation = [...target.addresses]

  for (let sequence = 1; sequence <= requestedSamples; sequence += 1) {
    const remaining = deadline - Date.now()
    if (remaining < 250) break
    const address = rotation[sequence % rotation.length] ?? preferred
    const result = await connectRtt(address, port, Math.min(timeoutMs, remaining))
    const kind = failureKind(address, result.errorCode)
    samples.push({ sequence, address, ok: result.ok, latencyMs: result.latencyMs, errorCode: result.errorCode, failureKind: kind })
    if (kind === 'platform' && net.isIP(address) === 6) {
      const IPv4Only = rotation.filter((entry) => net.isIP(entry) === 4)
      if (IPv4Only.length > 0 && IPv4Only.length !== rotation.length) {
        rotation = IPv4Only
        notes.push('This platform has no IPv6 egress, so IPv6 addresses were dropped from the sampling rotation.')
      }
    }
    if (Date.now() + SAMPLE_GAP_MS > deadline) break
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_GAP_MS))
  }

  const summary = summarise(samples)
  if (summary.platformFailures > 0 && !notes.some((entry) => entry.includes('IPv6'))) {
    notes.push(
      `${summary.platformFailures} attempt(s) could not be started by this platform and were excluded from the loss figure; the target itself was not judged by them.`,
    )
  }

  return {
    target: target.host,
    address: preferred,
    addresses: target.addresses,
    port,
    protocol: 'tcp',
    samples,
    summary,
    truncated: samples.length < requestedSamples,
    elapsedMs: Date.now() - startedAt,
    checkedAt: new Date().toISOString(),
    note: notes.length > 0 ? notes.join(' ') : null,
  }
}
