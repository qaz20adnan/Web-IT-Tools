/*
 * Real browser-side internet speed test against speed.cloudflare.com.
 *
 * Pure logic, no React and no globals beyond fetch/performance: every network call goes through an
 * injectable `fetcher` and honours an `AbortSignal`, so the whole measurement pipeline can be tested
 * with a fake transport. Nothing here invents numbers — a phase that did not move enough bytes for
 * enough time is reported as unreliable instead of being quoted as a result.
 */

export type SpeedPhase = 'meta' | 'latency' | 'download' | 'upload'

/** Why a call failed. Kept small so the UI can state it plainly in both languages. */
export type SpeedFailReason = 'aborted' | 'blocked' | 'unreachable' | 'unsupported' | 'partial'

/** Why a throughput phase stopped escalating. */
export type SpeedStopReason = 'duration' | 'cap' | 'exhausted' | 'saturated' | 'error' | 'aborted'

export interface SpeedSample {
  phase: SpeedPhase
  /** Round-trip duration of this sample in milliseconds. */
  ms: number
  /** Bytes actually moved by this sample (0 for latency probes). */
  bytes: number
  /** Throughput of this sample in Mbps (0 for latency probes). */
  mbps: number
  /** Payload size the sample asked for, when a size was chosen. */
  plannedBytes?: number
  /** HTTP status when a response was received. */
  status?: number
  ok: boolean
  reason?: SpeedFailReason
}

export interface SpeedFailure {
  phase: SpeedPhase
  reason: SpeedFailReason
  message: string
}

export interface SpeedRequestInit {
  method?: 'GET' | 'POST'
  body?: Uint8Array<ArrayBuffer> | string
  signal?: AbortSignal
  cache?: 'no-store' | 'default' | 'reload'
  mode?: 'cors' | 'no-cors'
  headers?: Record<string, string>
}

export interface SpeedStream {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>
    cancel?: (reason?: unknown) => Promise<void> | void
    releaseLock?: () => void
  }
  cancel?: (reason?: unknown) => Promise<void> | void
}

export interface SpeedResponse {
  ok: boolean
  status: number
  body?: SpeedStream | null
  json?: () => Promise<unknown>
  arrayBuffer?: () => Promise<ArrayBuffer>
}

export type SpeedFetcher = (url: string, init: SpeedRequestInit) => Promise<SpeedResponse>

export interface SpeedClientInfo {
  ip: string | null
  asn: string | null
  organization: string | null
  city: string | null
  country: string | null
  colo: string | null
}

export interface LatencyOutcome {
  phase: 'latency'
  /** Successful round-trip times in milliseconds, in the order they were measured. */
  samples: number[]
  attempts: SpeedSample[]
  min: number
  avg: number
  median: number
  jitter: number
  requested: number
  reliable: boolean
  /** Jitter needs at least two samples to mean anything. */
  jitterReliable: boolean
  failure: SpeedFailure | null
}

export interface ThroughputOutcome {
  phase: 'download' | 'upload'
  mbps: number
  bytes: number
  ms: number
  samples: SpeedSample[]
  reliable: boolean
  /** True when the phase moved some bytes and then failed. */
  partial: boolean
  /** True when the run stopped because the caller aborted it. */
  aborted: boolean
  /** False when the browser could not stream the body, so per-chunk progress was unavailable. */
  streamed: boolean
  stoppedBy: SpeedStopReason | null
  failure: SpeedFailure | null
}

export interface SpeedTestResult {
  startedAt: string
  finishedAt: string
  durationMs: number
  host: string
  aborted: boolean
  /** At least one phase produced a reliable figure. */
  ok: boolean
  client: SpeedClientInfo | null
  latency: LatencyOutcome
  download: ThroughputOutcome
  upload: ThroughputOutcome
  failures: SpeedFailure[]
}

export interface SpeedProgressEvent {
  phase: SpeedPhase
  mbps: number
  bytes: number
  ms: number
  /** Payload size the current attempt asked for. */
  plannedBytes: number
  /** 1-based attempt index inside the phase. */
  attempt: number
  streaming: boolean
  /** Latency only. */
  sampleMs?: number
  sampleCount?: number
  /** Meta only. */
  client?: SpeedClientInfo | null
}

export interface SpeedTestOptions {
  fetcher?: SpeedFetcher
  signal?: AbortSignal
  /** Injectable clock; milliseconds with any origin. Only differences are used. */
  now?: () => number
  latencySamples?: number
  downloadMs?: number
  uploadMs?: number
  downloadCapBytes?: number
  uploadCapBytes?: number
  /** Mbps above which a phase escalates to a bigger payload. */
  escalateAboveMbps?: number
  host?: string
  onProgress?: (event: SpeedProgressEvent) => void
}

/* ------------------------------ constants ------------------------------ */

export const SPEED_HOST = 'speed.cloudflare.com'

/** A phase below either threshold is too small to quote — noise dominates. */
export const MIN_RELIABLE_BYTES = 32 * 1024
export const MIN_RELIABLE_MS = 80

export const DOWNLOAD_SIZES: number[] = [1e6, 1e7, 3e7]
export const UPLOAD_SIZES: number[] = [64e3, 250e3, 1e6]

export const DEFAULT_LATENCY_SAMPLES = 5
export const DEFAULT_DOWNLOAD_MS = 8_000
export const DEFAULT_UPLOAD_MS = 6_000
export const DEFAULT_DOWNLOAD_CAP_BYTES = 45e6
export const DEFAULT_UPLOAD_CAP_BYTES = 12e6
export const ESCALATE_ABOVE_MBPS = 40

export const MAX_LATENCY_SAMPLES = 10

export function downloadUrl(bytes: number, host: string = SPEED_HOST): string {
  return `https://${host}/__down?bytes=${Math.max(0, Math.trunc(bytes))}`
}

export function uploadUrl(host: string = SPEED_HOST): string {
  return `https://${host}/__up`
}

export function metaUrl(host: string = SPEED_HOST): string {
  return `https://${host}/meta`
}

/** The default transport: the browser's own fetch behind the narrow contract above. */
export const browserFetcher: SpeedFetcher = (url, init) => globalThis.fetch(url, init)

/* ------------------------------ math helpers ------------------------------ */

function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now()
}

function finite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Megabit per second from a byte count and a duration in milliseconds. */
export function bytesToMbps(bytes: number, ms: number): number {
  const safeBytes = finite(bytes)
  const safeMs = finite(ms)
  if (safeBytes <= 0 || safeMs <= 0) return 0
  return (safeBytes * 8) / (1000 * safeMs)
}

export function meanOf(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value))
  if (clean.length === 0) return 0
  return clean.reduce((total, value) => total + value, 0) / clean.length
}

export function medianOf(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (clean.length === 0) return 0
  const middle = Math.floor(clean.length / 2)
  return clean.length % 2 === 1 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2
}

/** RFC 3390 style jitter: mean absolute difference between consecutive samples. */
export function jitterOf(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value))
  if (clean.length < 2) return 0
  const differences: number[] = []
  for (let index = 1; index < clean.length; index += 1) differences.push(Math.abs(clean[index] - clean[index - 1]))
  return meanOf(differences)
}

export function minOf(values: number[]): number {
  const clean = values.filter((value) => Number.isFinite(value))
  if (clean.length === 0) return 0
  return Math.min(...clean)
}

/** A measurement this small is dominated by handshake noise, so it is not quotable. */
export function isReliableMeasurement(
  bytes: number,
  ms: number,
  minBytes: number = MIN_RELIABLE_BYTES,
  minMs: number = MIN_RELIABLE_MS,
): boolean {
  return Number.isFinite(bytes) && Number.isFinite(ms) && bytes >= minBytes && ms >= minMs
}

export function formatMbps(mbps: number): string {
  if (!Number.isFinite(mbps)) return '— Mbps'
  const value = Math.max(0, mbps)
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} Mbps`
}

export function formatMs(ms: number): string {
  if (!Number.isFinite(ms)) return '— ms'
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`
}

export function formatBytesShort(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1000) return `${Math.round(bytes)} B`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let index = 0
  while (value >= 1000 && index < units.length - 1) {
    value /= 1000
    index += 1
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[index]}`
}

/* ------------------------------ failure classification ------------------------------ */

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  return ''
}

/** HTTP status → reason code. 4xx means the endpoint refused us; 5xx/408 is a dead or slow path. */
export function classifyStatus(status: number): SpeedFailReason {
  if (status === 401 || status === 403 || status === 404 || status === 405 || status === 451) return 'blocked'
  if (status >= 400 && status < 500) return 'blocked'
  return 'unreachable'
}

/**
 * Browser fetch failures are deliberately opaque, so this is a documented guess, not a certainty:
 * CSP/preflight refusals and plain connectivity loss both surface as a TypeError.
 */
export function classifyFailure(error: unknown, signal?: AbortSignal): SpeedFailReason {
  if (signal?.aborted) return 'aborted'
  const name = error instanceof Error ? error.name : ''
  const text = `${name} ${errorMessage(error)}`.toLowerCase()
  if (text.includes('abort')) return 'aborted'
  if (
    text.includes('not supported') ||
    text.includes('not implemented') ||
    text.includes('not a function') ||
    text.includes('getreader') ||
    text.includes('streaming') ||
    text.includes('invalid state')
  ) {
    return 'unsupported'
  }
  if (
    text.includes('content security policy') ||
    text.includes('csp') ||
    text.includes('blocked') ||
    text.includes('cors') ||
    text.includes('referrer') ||
    text.includes('disallowed')
  ) {
    return 'blocked'
  }
  return 'unreachable'
}

function failureForResponse(phase: SpeedPhase, response: SpeedResponse): SpeedFailure {
  const reason = classifyStatus(response.status)
  return { phase, reason, message: `HTTP ${response.status}` }
}

/* ------------------------------ payload planning ------------------------------ */

export interface PayloadPlanInput {
  /** Index of the candidate step inside `sizes`. */
  index: number
  sizes?: number[]
  /** Bytes moved by the phase so far. */
  elapsedMs: number
  transferredBytes: number
  /** Mbps of the last successful attempt, or null when none finished yet. */
  lastMbps: number | null
  targetMs: number
  capBytes: number
  escalateAboveMbps?: number
}

export type PayloadDecision = { action: 'send'; bytes: number } | { action: 'stop'; reason: SpeedStopReason }

/**
 * Single source of truth for the escalation/stop decision, so it is testable on its own:
 * send the next payload unless the clock, the byte cap or the payload ladder is exhausted, or the
 * last attempt was already slow enough that a bigger body would not sharpen the figure.
 */
export function decidePayload(input: PayloadPlanInput): PayloadDecision {
  const ladder = input.sizes && input.sizes.length > 0 ? input.sizes : DOWNLOAD_SIZES
  if (input.index < 0 || input.index >= ladder.length) return { action: 'stop', reason: 'exhausted' }
  if (input.lastMbps !== null) {
    if (finite(input.elapsedMs) >= input.targetMs) return { action: 'stop', reason: 'duration' }
    if (finite(input.transferredBytes) >= input.capBytes) return { action: 'stop', reason: 'cap' }
    if (input.lastMbps < (input.escalateAboveMbps ?? ESCALATE_ABOVE_MBPS)) return { action: 'stop', reason: 'saturated' }
  }
  return { action: 'send', bytes: ladder[input.index] }
}

export function nextPayloadSize(input: PayloadPlanInput): number | null {
  const decision = decidePayload(input)
  return decision.action === 'send' ? decision.bytes : null
}

/* ------------------------------ client metadata ------------------------------ */

function nullableText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

export function parseClientMeta(raw: unknown): SpeedClientInfo {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    ip: nullableText(source.clientIp ?? source.ip),
    asn: nullableText(source.asn),
    organization: nullableText(source.asOrganization ?? source.organization),
    city: nullableText(source.city),
    country: nullableText(source.country ?? source.countryCode),
    colo: nullableText(source.colo),
  }
}

export interface MetaOutcome {
  client: SpeedClientInfo | null
  failure: SpeedFailure | null
}

/** Optional by design: if /meta is blocked the test still runs, it just cannot name the exit. */
export async function fetchClientInfo(options: {
  fetcher?: SpeedFetcher
  signal?: AbortSignal
  host?: string
  now?: () => number
} = {}): Promise<MetaOutcome> {
  const fetcher = options.fetcher ?? browserFetcher
  const host = options.host ?? SPEED_HOST
  const signal = options.signal
  if (signal?.aborted) return { client: null, failure: { phase: 'meta', reason: 'aborted', message: 'aborted before the metadata call' } }
  if (typeof fetcher !== 'function') return { client: null, failure: { phase: 'meta', reason: 'unsupported', message: 'no fetch transport available' } }
  try {
    const response = await fetcher(metaUrl(host), { method: 'GET', signal, cache: 'no-store' })
    if (!response.ok) return { client: null, failure: failureForResponse('meta', response) }
    if (typeof response.json !== 'function') {
      return { client: null, failure: { phase: 'meta', reason: 'unsupported', message: 'the metadata response was not JSON' } }
    }
    const json = await response.json()
    const client = parseClientMeta(json)
    if (client.ip === null && client.colo === null && client.city === null) {
      return { client, failure: { phase: 'meta', reason: 'partial', message: 'the metadata reply carried no usable fields' } }
    }
    return { client, failure: null }
  } catch (error) {
    const reason = classifyFailure(error, signal)
    return { client: null, failure: { phase: 'meta', reason, message: errorMessage(error) || 'metadata request failed' } }
  }
}

/* ------------------------------ latency ------------------------------ */

export interface LatencyInput {
  fetcher?: SpeedFetcher
  signal?: AbortSignal
  now?: () => number
  /** Number of sequential probes, clamped to 1..MAX_LATENCY_SAMPLES. */
  samples?: number
  host?: string
  onProgress?: (event: SpeedProgressEvent) => void
}

const EMPTY_LATENCY: LatencyOutcome = {
  phase: 'latency',
  samples: [],
  attempts: [],
  min: 0,
  avg: 0,
  median: 0,
  jitter: 0,
  requested: 0,
  reliable: false,
  jitterReliable: false,
  failure: null,
}

export async function measureLatency(input: LatencyInput = {}): Promise<LatencyOutcome> {
  const fetcher = input.fetcher ?? browserFetcher
  const now = input.now ?? defaultNow
  const host = input.host ?? SPEED_HOST
  const signal = input.signal
  const requested = Math.max(1, Math.min(MAX_LATENCY_SAMPLES, Math.trunc(finite(input.samples) || DEFAULT_LATENCY_SAMPLES)))
  const url = downloadUrl(0, host)

  if (typeof fetcher !== 'function') {
    return { ...EMPTY_LATENCY, requested, failure: { phase: 'latency', reason: 'unsupported', message: 'no fetch transport available' } }
  }

  const attempts: SpeedSample[] = []
  const values: number[] = []
  let failure: SpeedFailure | null = null

  for (let index = 0; index < requested; index += 1) {
    if (signal?.aborted) {
      failure = { phase: 'latency', reason: 'aborted', message: 'stopped while probing latency' }
      break
    }
    const started = now()
    try {
      const response = await fetcher(url, { method: 'GET', signal, cache: 'no-store' })
      const ms = Math.max(0, now() - started)
      await discardBody(response)
      if (!response.ok) {
        const reason = classifyStatus(response.status)
        attempts.push({ phase: 'latency', ms, bytes: 0, mbps: 0, status: response.status, ok: false, reason })
        failure = failureForResponse('latency', response)
        continue
      }
      attempts.push({ phase: 'latency', ms, bytes: 0, mbps: 0, status: response.status, ok: true })
      values.push(ms)
      input.onProgress?.({
        phase: 'latency',
        mbps: 0,
        bytes: 0,
        ms,
        plannedBytes: 0,
        attempt: values.length,
        streaming: false,
        sampleMs: ms,
        sampleCount: values.length,
      })
    } catch (error) {
      const ms = Math.max(0, now() - started)
      const reason = classifyFailure(error, signal)
      attempts.push({ phase: 'latency', ms, bytes: 0, mbps: 0, ok: false, reason })
      failure = { phase: 'latency', reason, message: errorMessage(error) || 'latency probe failed' }
      if (reason === 'aborted') break
    }
  }

  const avg = Number(meanOf(values).toFixed(2))
  return {
    phase: 'latency',
    samples: values,
    attempts,
    min: minOf(values),
    avg,
    median: medianOf(values),
    jitter: Number(jitterOf(values).toFixed(2)),
    requested,
    reliable: values.length > 0 && failure === null,
    jitterReliable: values.length >= 2,
    failure,
  }
}

async function discardBody(response: SpeedResponse): Promise<void> {
  try {
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel()
      return
    }
    const reader = getReader(response)
    if (reader) {
      await reader.cancel?.()
      reader.releaseLock?.()
      return
    }
    if (typeof response.arrayBuffer === 'function') await response.arrayBuffer()
  } catch {
    /* a discarded body must never fail a measurement */
  }
}

function getReader(response: SpeedResponse) {
  if (!response.body || typeof response.body.getReader !== 'function') return null
  try {
    return response.body.getReader()
  } catch {
    return null
  }
}

async function cancelReader(reader: { cancel?: (reason?: unknown) => Promise<void> | void; releaseLock?: () => void }): Promise<void> {
  try {
    await reader.cancel?.()
  } catch {
    /* the stream is already gone */
  }
  try {
    reader.releaseLock?.()
  } catch {
    /* ignore */
  }
}

/* ------------------------------ throughput ------------------------------ */

export interface ThroughputInput {
  phase: 'download' | 'upload'
  fetcher?: SpeedFetcher
  signal?: AbortSignal
  now?: () => number
  /** Stop the phase once this much time has been spent moving data. */
  targetMs?: number
  /** Hard byte budget for the phase. */
  capBytes?: number
  sizes?: number[]
  escalateAboveMbps?: number
  host?: string
  onProgress?: (event: SpeedProgressEvent) => void
}

interface AttemptOutcome {
  bytes: number
  ms: number
  mbps: number
  aborted: boolean
  truncated: SpeedStopReason | null
  failure: SpeedFailure | null
  streamed: boolean
}

const EMPTY_THROUGHPUT: ThroughputOutcome = {
  phase: 'download',
  mbps: 0,
  bytes: 0,
  ms: 0,
  samples: [],
  reliable: false,
  partial: false,
  aborted: false,
  streamed: false,
  stoppedBy: null,
  failure: null,
}

export async function measureThroughput(input: ThroughputInput): Promise<ThroughputOutcome> {
  const phase = input.phase
  const fetcher = input.fetcher ?? browserFetcher
  const now = input.now ?? defaultNow
  const host = input.host ?? SPEED_HOST
  const signal = input.signal
  const sizes = input.sizes && input.sizes.length > 0 ? input.sizes : phase === 'download' ? DOWNLOAD_SIZES : UPLOAD_SIZES
  const targetMs = finite(input.targetMs) || (phase === 'download' ? DEFAULT_DOWNLOAD_MS : DEFAULT_UPLOAD_MS)
  const capBytes = finite(input.capBytes) || (phase === 'download' ? DEFAULT_DOWNLOAD_CAP_BYTES : DEFAULT_UPLOAD_CAP_BYTES)

  if (typeof fetcher !== 'function') {
    return { ...EMPTY_THROUGHPUT, phase, failure: { phase, reason: 'unsupported', message: 'no fetch transport available' }, stoppedBy: 'error' }
  }

  const samples: SpeedSample[] = []
  let bytes = 0
  let elapsed = 0
  let lastMbps: number | null = null
  let failure: SpeedFailure | null = null
  let aborted = false
  let partial = false
  let streamed = false
  let stoppedBy: SpeedStopReason | null
  let index = 0

  for (;;) {
    if (signal?.aborted) {
      aborted = true
      stoppedBy = 'aborted'
      break
    }
    const decision = decidePayload({
      index,
      sizes,
      elapsedMs: elapsed,
      transferredBytes: bytes,
      lastMbps,
      targetMs,
      capBytes,
      escalateAboveMbps: input.escalateAboveMbps,
    })
    if (decision.action === 'stop') {
      stoppedBy = decision.reason
      break
    }
    const attempt =
      phase === 'download'
        ? await runDownloadAttempt(fetcher, decision.bytes, {
            now,
            signal,
            host,
            phase,
            attempt: index + 1,
            phaseBytes: bytes,
            phaseMs: elapsed,
            targetMs,
            capBytes,
            onProgress: input.onProgress,
          })
        : await runUploadAttempt(fetcher, decision.bytes, {
            now,
            signal,
            host,
            phase,
            attempt: index + 1,
            phaseBytes: bytes,
            phaseMs: elapsed,
            targetMs,
            capBytes,
            onProgress: input.onProgress,
          })

    streamed = streamed || attempt.streamed
    if (attempt.bytes > 0) {
      bytes += attempt.bytes
      elapsed += attempt.ms
      lastMbps = attempt.mbps
      samples.push({
        phase,
        ms: attempt.ms,
        bytes: attempt.bytes,
        mbps: attempt.mbps,
        plannedBytes: decision.bytes,
        ok: attempt.failure === null,
        reason: attempt.failure?.reason,
      })
    }
    if (attempt.aborted) {
      aborted = true
      stoppedBy = 'aborted'
      break
    }
    if (attempt.failure) {
      failure = attempt.failure
      partial = attempt.bytes > 0
      stoppedBy = attempt.failure.reason === 'aborted' ? 'aborted' : 'error'
      break
    }
    if (attempt.truncated) {
      stoppedBy = attempt.truncated
      break
    }
    index += 1
  }

  return {
    phase,
    mbps: bytesToMbps(bytes, elapsed),
    bytes,
    ms: elapsed,
    samples,
    reliable: samples.length > 0 && failure === null && isReliableMeasurement(bytes, elapsed),
    partial,
    aborted,
    streamed,
    stoppedBy,
    failure,
  }
}

/** Back-compat alias: the download phase on its own. */
export function measureDownload(input: Omit<ThroughputInput, 'phase'> = {}): Promise<ThroughputOutcome> {
  return measureThroughput({ ...input, phase: 'download' })
}

/** Back-compat alias: the upload phase on its own. */
export function measureUpload(input: Omit<ThroughputInput, 'phase'> = {}): Promise<ThroughputOutcome> {
  return measureThroughput({ ...input, phase: 'upload' })
}

interface AttemptContext {
  now: () => number
  signal?: AbortSignal
  host: string
  phase: 'download' | 'upload'
  attempt: number
  phaseBytes: number
  phaseMs: number
  targetMs: number
  capBytes: number
  onProgress?: (event: SpeedProgressEvent) => void
}

function emitProgress(context: AttemptContext, plannedBytes: number, bytes: number, ms: number, streaming: boolean): void {
  context.onProgress?.({
    phase: context.phase,
    mbps: bytesToMbps(context.phaseBytes + bytes, context.phaseMs + ms),
    bytes: context.phaseBytes + bytes,
    ms: context.phaseMs + ms,
    plannedBytes,
    attempt: context.attempt,
    streaming,
  })
}

async function runDownloadAttempt(fetcher: SpeedFetcher, size: number, context: AttemptContext): Promise<AttemptOutcome> {
  const started = context.now()
  const signal = context.signal
  let bytes = 0
  let aborted = false
  let truncated: SpeedStopReason | null = null
  let failure: SpeedFailure | null = null
  let streamed = false

  try {
    if (signal?.aborted) return { bytes: 0, ms: Math.max(0, context.now() - started), mbps: 0, aborted: true, truncated: null, failure: { phase: context.phase, reason: 'aborted', message: 'stopped before the download attempt' }, streamed: false }
    const response = await fetcher(downloadUrl(size, context.host), { method: 'GET', signal, cache: 'no-store' })
    if (!response.ok) {
      failure = failureForResponse(context.phase, response)
      await discardBody(response)
    } else {
      const reader = getReader(response)
      if (reader) {
        streamed = true
        for (;;) {
          if (signal?.aborted) {
            aborted = true
            break
          }
          const chunk = await reader.read()
          if (chunk.done) break
          if (chunk.value) bytes += chunk.value.byteLength
          const ms = Math.max(0, context.now() - started)
          emitProgress(context, size, bytes, ms, true)
          if (signal?.aborted) {
            aborted = true
            break
          }
          if (context.phaseMs + ms >= context.targetMs) {
            truncated = 'duration'
            break
          }
          if (context.phaseBytes + bytes >= context.capBytes) {
            truncated = 'cap'
            break
          }
        }
        await cancelReader(reader)
      } else if (typeof response.arrayBuffer === 'function') {
        /* No ReadableStream in this engine: the whole body lands at once, so progress is per attempt only. */
        const buffer = await response.arrayBuffer()
        bytes = buffer.byteLength
        emitProgress(context, size, bytes, Math.max(0, context.now() - started), false)
      } else {
        failure = { phase: context.phase, reason: 'unsupported', message: 'this browser cannot read the response body' }
      }
    }
  } catch (error) {
    const reason = classifyFailure(error, signal)
    aborted = reason === 'aborted'
    failure = {
      phase: context.phase,
      reason: !aborted && bytes > 0 ? 'partial' : reason,
      message: errorMessage(error) || 'download failed',
    }
  }

  const ms = Math.max(0, context.now() - started)
  return { bytes, ms, mbps: bytesToMbps(bytes, ms), aborted, truncated, failure, streamed }
}

async function runUploadAttempt(fetcher: SpeedFetcher, size: number, context: AttemptContext): Promise<AttemptOutcome> {
  const started = context.now()
  const signal = context.signal
  let bytes = 0
  let failure: SpeedFailure | null = null
  let aborted = false

  try {
    if (signal?.aborted) {
      return {
        bytes: 0,
        ms: Math.max(0, context.now() - started),
        mbps: 0,
        aborted: true,
        truncated: null,
        failure: { phase: context.phase, reason: 'aborted', message: 'stopped before the upload attempt' },
        streamed: false,
      }
    }
    emitProgress(context, size, 0, 0, false)
    const body = new Uint8Array(size)
    const response = await fetcher(uploadUrl(context.host), {
      method: 'POST',
      body,
      signal,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/octet-stream' },
    })
    if (!response.ok) {
      failure = failureForResponse(context.phase, response)
      await discardBody(response)
    } else {
      await discardBody(response)
      bytes = size
      const ms = Math.max(0, context.now() - started)
      emitProgress(context, size, bytes, ms, false)
      if (signal?.aborted) aborted = true
    }
  } catch (error) {
    const reason = classifyFailure(error, signal)
    aborted = reason === 'aborted'
    failure = { phase: context.phase, reason, message: errorMessage(error) || 'upload failed' }
  }

  const ms = Math.max(0, context.now() - started)
  return {
    bytes,
    ms,
    mbps: bytesToMbps(bytes, ms),
    aborted,
    truncated: !aborted && failure === null && context.phaseMs + ms >= context.targetMs ? 'duration' : null,
    failure,
    streamed: false,
  }
}

/* ------------------------------ full run ------------------------------ */

export async function runSpeedTest(options: SpeedTestOptions = {}): Promise<SpeedTestResult> {
  const fetcher = options.fetcher ?? browserFetcher
  const now = options.now ?? defaultNow
  const host = options.host ?? SPEED_HOST
  const signal = options.signal
  const onProgress = options.onProgress
  const startedStamp = new Date().toISOString()
  const started = now()

  const meta = await fetchClientInfo({ fetcher, signal, host, now })
  onProgress?.({
    phase: 'meta',
    mbps: 0,
    bytes: 0,
    ms: 0,
    plannedBytes: 0,
    attempt: 0,
    streaming: false,
    client: meta.client,
  })

  const latency = await measureLatency({ fetcher, signal, now, host, samples: options.latencySamples, onProgress })

  const download = await measureThroughput({
    phase: 'download',
    fetcher,
    signal,
    now,
    host,
    targetMs: options.downloadMs,
    capBytes: options.downloadCapBytes,
    sizes: DOWNLOAD_SIZES,
    escalateAboveMbps: options.escalateAboveMbps,
    onProgress,
  })

  const upload = await measureThroughput({
    phase: 'upload',
    fetcher,
    signal,
    now,
    host,
    targetMs: options.uploadMs,
    capBytes: options.uploadCapBytes,
    sizes: UPLOAD_SIZES,
    escalateAboveMbps: options.escalateAboveMbps,
    onProgress,
  })

  const failures = [meta.failure, latency.failure, download.failure, upload.failure].filter((entry): entry is SpeedFailure => entry !== null)

  return {
    startedAt: startedStamp,
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Math.round(now() - started)),
    host,
    aborted: signal?.aborted === true,
    ok: latency.reliable || download.reliable || upload.reliable,
    client: meta.client,
    latency,
    download,
    upload,
    failures,
  }
}
