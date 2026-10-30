import { describe, expect, it } from 'vitest'
import {
  bytesToMbps,
  classifyFailure,
  classifyStatus,
  decidePayload,
  formatBytesShort,
  formatMbps,
  formatMs,
  jitterOf,
  medianOf,
  parseClientMeta,
  runSpeedTest,
  type SpeedRequestInit,
  type SpeedResponse,
} from '@/lib/speedtest'

/** 100 Mbps link: 12 500 bytes per millisecond. */
const BYTES_PER_MS = 12_500

interface FakeOptions {
  blocked?: boolean
}

function createFakeTransport(options: FakeOptions = {}) {
  const clock = { ms: 0 }
  let probes = 0
  const fetcher = async (url: string, init: SpeedRequestInit): Promise<SpeedResponse> => {
    clock.ms += 1
    if (options.blocked) return { ok: false, status: 403 }
    if (url.endsWith('/meta')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          clientIp: '203.0.113.9',
          asn: 'AS65012',
          asOrganization: 'Example ISP',
          city: 'Riyadh',
          country: 'SA',
          colo: 'FRA',
        }),
      }
    }
    if (init.method === 'POST') {
      clock.ms += 99
      return { ok: true, status: 200 }
    }
    const requested = Number(new URL(url).searchParams.get('bytes'))
    if (requested === 0) {
      probes += 1
      clock.ms += probes * 10 - 1
      return { ok: true, status: 200 }
    }
    clock.ms += Math.round(requested / BYTES_PER_MS) - 1
    let served = false
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (served) return { done: true }
            served = true
            return { done: false, value: new Uint8Array(requested) }
          },
        }),
      },
    }
  }
  return { clock, fetcher }
}

describe('speed measurement maths', () => {
  it('converts bytes and elapsed time into Mbps', () => {
    expect(bytesToMbps(1_000, 1_000)).toBe(0.008)
    expect(bytesToMbps(12_500, 1_000)).toBe(0.1)
    expect(bytesToMbps(0, 1_000)).toBe(0)
    expect(bytesToMbps(1_000, 0)).toBe(0)
  })

  it('reports median and RFC 3390 style jitter', () => {
    expect(medianOf([30, 10, 20])).toBe(20)
    expect(medianOf([10, 20, 30, 40])).toBe(25)
    expect(medianOf([])).toBe(0)
    expect(jitterOf([10, 20, 30])).toBe(10)
    expect(jitterOf([10])).toBe(0)
  })

  it('formats magnitudes without inventing precision', () => {
    expect(formatMbps(100)).toBe('100 Mbps')
    expect(formatMbps(12.34)).toBe('12.3 Mbps')
    expect(formatMbps(1.05)).toBe('1.05 Mbps')
    expect(formatMs(4.25)).toBe('4.3 ms')
    expect(formatMs(42.6)).toBe('43 ms')
    expect(formatBytesShort(12_500_000)).toBe('12.5 MB')
  })
})

describe('failure classification', () => {
  it('treats 4xx as blocked and 5xx as unreachable', () => {
    expect(classifyStatus(403)).toBe('blocked')
    expect(classifyStatus(429)).toBe('blocked')
    expect(classifyStatus(503)).toBe('unreachable')
  })

  it('separates aborts, transport gaps and unsupported engines', () => {
    const aborted = new AbortController()
    aborted.abort()
    expect(classifyFailure(new Error('manual stop'), aborted.signal)).toBe('aborted')
    expect(classifyFailure(new TypeError('Failed to fetch'))).toBe('unreachable')
    expect(classifyFailure(new TypeError('cors policy blocked'))).toBe('blocked')
    expect(classifyFailure(new Error('body.getReader is not a function'))).toBe('unsupported')
  })
})

describe('payload ladder', () => {
  it('escalates while the link is faster than the threshold', () => {
    expect(decidePayload({ index: 1, elapsedMs: 500, transferredBytes: 1e6, lastMbps: 90, targetMs: 8000, capBytes: 45e6 })).toEqual({ action: 'send', bytes: 1e7 })
  })

  it('stops on saturation, duration, cap and an exhausted ladder', () => {
    const base = { index: 1, elapsedMs: 500, transferredBytes: 1e6, lastMbps: 12, targetMs: 8000, capBytes: 45e6 }
    expect(decidePayload(base)).toEqual({ action: 'stop', reason: 'saturated' })
    expect(decidePayload({ ...base, lastMbps: 90, elapsedMs: 8100 })).toEqual({ action: 'stop', reason: 'duration' })
    expect(decidePayload({ ...base, lastMbps: 90, transferredBytes: 46e6 })).toEqual({ action: 'stop', reason: 'cap' })
    expect(decidePayload({ ...base, index: 3, lastMbps: 90 })).toEqual({ action: 'stop', reason: 'exhausted' })
  })
})

describe('client metadata', () => {
  it('reads the Cloudflare meta fields', () => {
    expect(parseClientMeta({ clientIp: ' 203.0.113.9 ', asn: 65012, asOrganization: 'Example ISP' })).toMatchObject({
      ip: '203.0.113.9',
      asn: '65012',
      organization: 'Example ISP',
      colo: null,
    })
  })

  it('tolerates a malformed payload', () => {
    expect(parseClientMeta(null)).toEqual({ ip: null, asn: null, organization: null, city: null, country: null, colo: null })
  })
})

describe('runSpeedTest', () => {
  it('measures latency, download and upload against a 100 Mbps link', async () => {
    const { clock, fetcher } = createFakeTransport()
    const result = await runSpeedTest({
      fetcher,
      now: () => clock.ms,
      latencySamples: 3,
      escalateAboveMbps: 0,
      downloadCapBytes: 1e6,
      uploadCapBytes: 64_000,
    })

    expect(result.ok).toBe(true)
    expect(result.aborted).toBe(false)
    expect(result.failures).toEqual([])
    expect(result.client?.organization).toBe('Example ISP')
    expect(result.latency.samples).toEqual([10, 20, 30])
    expect(result.latency.avg).toBe(20)
    expect(result.latency.min).toBe(10)
    expect(result.latency.jitter).toBe(10)
    expect(result.download.mbps).toBe(100)
    expect(result.download.bytes).toBe(1e6)
    expect(result.download.reliable).toBe(true)
    expect(result.upload.bytes).toBe(64_000)
    expect(result.upload.reliable).toBe(true)
  })

  it('reports blocked phases instead of inventing a figure', async () => {
    const { clock, fetcher } = createFakeTransport({ blocked: true })
    const result = await runSpeedTest({ fetcher, now: () => clock.ms, latencySamples: 2 })

    expect(result.ok).toBe(false)
    expect(result.download.mbps).toBe(0)
    expect(result.download.reliable).toBe(false)
    expect(result.failures.map((failure) => failure.reason).every((reason) => reason === 'blocked')).toBe(true)
    expect(result.failures.map((failure) => failure.phase)).toEqual(['meta', 'latency', 'download', 'upload'])
  })

  it('honours an abort signal', async () => {
    const { clock, fetcher } = createFakeTransport()
    const controller = new AbortController()
    controller.abort()
    const result = await runSpeedTest({ fetcher, now: () => clock.ms, signal: controller.signal })

    expect(result.aborted).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.download.samples).toEqual([])
  })
})
