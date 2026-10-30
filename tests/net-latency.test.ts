import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { connectRtt } from '../netlify/lib/net-probe'
import { probeLatency } from '../netlify/lib/net-latency'

let listening: net.Server
let port = 0

beforeAll(async () => {
  listening = net.createServer((socket) => socket.end())
  await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', resolve))
  const address = listening.address()
  port = typeof address === 'object' && address ? address.port : 0
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) => listening.close((error) => (error ? reject(error) : resolve())))
})

describe('TCP connect latency', () => {
  it('measures a handshake against an open port', async () => {
    const result = await connectRtt('127.0.0.1', port, 1500)
    expect(result.ok).toBe(true)
    expect(result.latencyMs).not.toBeNull()
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.errorCode).toBeNull()
  })

  it('reports a code rather than a zero latency when nothing listens', async () => {
    const result = await connectRtt('127.0.0.1', 1, 1500)
    expect(result.ok).toBe(false)
    expect(result.latencyMs).toBeNull()
    expect(result.errorCode).toBeTruthy()
  })

  it('never invents a latency for a target that does not answer', async () => {
    const result = await connectRtt('192.0.2.1', 443, 400)
    expect(result.ok).toBe(false)
    expect(result.latencyMs).toBeNull()
    expect(typeof result.errorCode).toBe('string')
    expect(result.errorCode).not.toBeNull()
  }, 15_000)
})

describe('latency probe policy', () => {
  it('refuses private targets before touching the network', async () => {
    await expect(probeLatency('10.10.10.10', 443, 3, 1000)).rejects.toMatchObject({ statusCode: 403, code: 'blocked_host' })
  })

  it('refuses a hostname that resolves to loopback', async () => {
    await expect(probeLatency('localhost', 443, 3, 1000)).rejects.toMatchObject({ statusCode: 403, code: 'blocked_host' })
  })
})
