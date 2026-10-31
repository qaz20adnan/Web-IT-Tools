import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn() },
}))

vi.mock('node:tls', () => ({
  default: { connect: vi.fn() },
}))

vi.mock('node:https', () => ({
  default: { request: vi.fn() },
}))

vi.mock('node:http', () => ({
  default: {
    // Loaded at module scope by net-diagnostics, so it cannot throw here; an unmocked
    // call does, which is what keeps this file from ever reaching the network.
    request: vi.fn(() => {
      throw new Error('node:http.request was called for real — install the hop fake')
    }),
  },
}))

import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { assertPublicHost, resolvePublicAddress } from '../netlify/lib/host'
import { checkHttp } from '../netlify/lib/net-diagnostics'
import { inspectCertificate } from '../netlify/lib/tls'

const PUBLIC_IP = '93.184.216.34'

interface FakeSocket {
  once: (event: string, fn: (arg?: unknown) => void) => FakeSocket
  destroy: () => void
  emit: (event: string, arg?: unknown) => void
  destroyed: () => boolean
}

function fakeSocket(): FakeSocket {
  const handlers = new Map<string, Array<(arg?: unknown) => void>>()
  let dead = false
  const socket: FakeSocket = {
    once: (event, fn) => {
      handlers.set(event, [...(handlers.get(event) ?? []), fn])
      return socket
    },
    destroy: () => {
      dead = true
    },
    emit: (event, arg) => {
      for (const fn of handlers.get(event) ?? []) fn(arg)
    },
    destroyed: () => dead,
  }
  return socket
}

/** A TLS peer that fails the handshake after registering its handlers. */
function failOnConnect(message = 'ECONNRESET') {
  const sockets: FakeSocket[] = []
  vi.mocked(tls.connect).mockImplementation((() => {
    const socket = fakeSocket()
    sockets.push(socket)
    queueMicrotask(() => socket.emit('error', new Error(message)))
    return socket as never
  }) as never)
  return sockets
}

describe('resolvePublicAddress', () => {
  beforeEach(() => {
    vi.mocked(dns.lookup).mockReset()
    vi.mocked(dns.lookup).mockImplementation((async () => [{ address: PUBLIC_IP, family: 4 }]) as never)
  })

  it('hands the caller the literal address it validated, not the name', async () => {
    await expect(resolvePublicAddress('Example.COM')).resolves.toEqual({
      host: 'example.com',
      address: PUBLIC_IP,
      family: 4,
    })
  })

  it('resolves exactly once, which is the whole point of the fix', async () => {
    await resolvePublicAddress('rebind.example')
    expect(dns.lookup).toHaveBeenCalledTimes(1)

    // The second lookup a socket would have performed is the window finding M-3 is about:
    // a TTL-1 record flipped to `169.254.169.254` between check and connect.
    await resolvePublicAddress('rebind.example')
    expect(dns.lookup).toHaveBeenCalledTimes(2)
  })

  it('refuses a hostname whose answers include a private address', async () => {
    vi.mocked(dns.lookup).mockImplementation((async () => [
      { address: PUBLIC_IP, family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]) as never)
    await expect(resolvePublicAddress('mixed.example')).rejects.toMatchObject({
      statusCode: 403,
      code: 'blocked_host',
    })
  })

  it('never asks DNS about an IP literal', async () => {
    const target = await resolvePublicAddress(PUBLIC_IP)
    expect(target.address).toBe(PUBLIC_IP)
    expect(dns.lookup).not.toHaveBeenCalled()
  })

  it('blocks private and reserved literals', async () => {
    for (const host of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1']) {
      await expect(resolvePublicAddress(host)).rejects.toMatchObject({ statusCode: 403 })
    }
  })

  it('prefers the v4 answer so checker and socket agree on the family', async () => {
    vi.mocked(dns.lookup).mockImplementation((async () => [
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      { address: PUBLIC_IP, family: 4 },
    ]) as never)
    await expect(resolvePublicAddress('dual.example')).resolves.toMatchObject({ address: PUBLIC_IP, family: 4 })
  })

  it('reports an unresolvable name as a 400, the case analyzeUrl treats as inert', async () => {
    vi.mocked(dns.lookup).mockImplementation((async () => {
      throw Object.assign(new Error('ENOTFOUND'), { code: 'ENOTFOUND' })
    }) as never)
    await expect(resolvePublicAddress('gone.example')).rejects.toMatchObject({
      statusCode: 400,
      code: 'blocked_host',
    })
  })

  it('keeps the old assertPublicHost contract: the hostname comes back, not an address', async () => {
    await expect(assertPublicHost('example.com')).resolves.toBe('example.com')
  })
})

describe('inspectCertificate SNI', () => {
  it('connects to the IP and still presents the hostname', async () => {
    const sockets = failOnConnect()
    const pending = inspectCertificate(PUBLIC_IP, 443, 9000, 'example.com')
    expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ host: PUBLIC_IP, servername: 'example.com' }))
    await expect(pending).rejects.toThrow('ECONNRESET')
    expect(sockets[0].destroyed()).toBe(true)
  })

  it('leaves servername off for a bare IP so the handshake does not invent a name', async () => {
    failOnConnect()
    const pending = inspectCertificate(PUBLIC_IP, 443)
    expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ host: PUBLIC_IP, servername: undefined }))
    await expect(pending).rejects.toThrow()
  })

  it('still derives servername from a hostname when no address was resolved', async () => {
    failOnConnect()
    const pending = inspectCertificate('example.com')
    expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'example.com', servername: 'example.com' }))
    await expect(pending).rejects.toThrow()
  })
})

/**
 * `checkHttp` validates the hop with a `lookup` override and then, until M-3, sent the
 * certificate probe to `current.hostname` again. The only honest witness of the peer is
 * the socket the hop actually used, so this drives the real request path against a fake
 * `https.request` that reports a different address than the name.
 */
describe('checkHttp pins the TLS probe to the real peer', () => {
  function fakeHop(remoteAddress: string | undefined) {
    const seen: Array<{ options: Record<string, unknown> }> = []
    const implementation = ((options: Record<string, unknown>, onResponse: (res: unknown) => void) => {
      seen.push({ options })
      const request = {
        once: () => request,
        destroy: () => request,
        end: () => {
          onResponse({
            statusCode: 200,
            statusMessage: 'OK',
            headers: {},
            resume: () => {},
            socket: { remoteAddress },
          })
        },
      }
      return request as never
    }) as never
    vi.mocked(https.request).mockImplementation(implementation)
    vi.mocked(http.request).mockImplementation(implementation)
    return seen
  }

  beforeEach(() => {
    vi.mocked(dns.lookup).mockReset()
    vi.mocked(dns.lookup).mockImplementation((async () => [{ address: PUBLIC_IP, family: 4 }]) as never)
  })

  it('opens the certificate socket on the address the response came from', async () => {
    const hop = fakeHop('198.51.100.7')
    failOnConnect('handshake stopped')
    const result = await checkHttp('https://example.com/pay')

    expect(hop[0].options.hostname).toBe('example.com')
    expect(typeof hop[0].options.lookup).toBe('function')
    expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ host: '198.51.100.7', servername: 'example.com' }))
    expect(result.tls).toBeNull()
    expect(typeof result.tlsError).toBe('string')
  })

  it('falls back to the hostname when the socket reports no peer', async () => {
    fakeHop(undefined)
    failOnConnect('handshake stopped')
    await checkHttp('https://example.com/pay')
    expect(tls.connect).toHaveBeenCalledWith(expect.objectContaining({ host: 'example.com', servername: 'example.com' }))
  })

  it('leaves a plain http hop without a certificate probe', async () => {
    fakeHop('198.51.100.7')
    const result = await checkHttp('http://example.com/pay')
    expect(tls.connect).not.toHaveBeenCalled()
    expect(result.tls).toBeNull()
    expect(result.tlsError).toBeNull()
  })
})

// The handler is behind auth + rate limiting, so the wiring of the fix itself is guarded
// structurally: it must resolve once and connect to what it resolved.
describe('net-tls wiring', () => {
  const source = readFileSync(join(process.cwd(), 'netlify', 'functions', 'net-tls.ts'), 'utf8')

  it('passes the resolved address plus the original name, never the bare host', () => {
    expect(source).toContain('resolvePublicAddress(host)')
    expect(source).toMatch(/inspectCertificate\(\s*target\.address,\s*port,[^)]*target\.address === host \? undefined : host/)
    expect(source).not.toContain('assertPublicHost')
    expect(source).not.toMatch(/inspectCertificate\(\s*host\s*,/)
  })
})
