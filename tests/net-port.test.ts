import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { checkPorts, MAX_PORT_PROBES } from '../netlify/lib/net-diagnostics'
import { PORT_PROBE_MAX_PORTS, portRequestSchema } from '../netlify/lib/schema'

const servers: net.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        }),
    ),
  )
})

async function listeningServer(): Promise<number> {
  const server = net.createServer((socket) => socket.end())
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port')
  return address.port
}

describe('port request schema', () => {
  it('accepts manual ports and a bounded timeout', () => {
    const parsed = portRequestSchema.safeParse({ host: 'example.com', ports: [22, 3389], timeoutMs: 5000 })
    expect(parsed.success).toBe(true)
    if (parsed.success) expect(parsed.data.protocol).toBe('tcp')
    expect(PORT_PROBE_MAX_PORTS).toBe(MAX_PORT_PROBES)
  })

  it('rejects out-of-range, duplicate-shaped, and non-TCP requests', () => {
    expect(portRequestSchema.safeParse({ host: 'example.com', ports: [0] }).success).toBe(false)
    expect(portRequestSchema.safeParse({ host: 'example.com', ports: [65536] }).success).toBe(false)
    expect(portRequestSchema.safeParse({ host: 'example.com', ports: Array.from({ length: 9 }, (_, index) => index + 1) }).success).toBe(false)
    expect(portRequestSchema.safeParse({ host: 'example.com', ports: [80], protocol: 'udp' }).success).toBe(false)
    expect(portRequestSchema.safeParse({ host: 'example.com', ports: [80], timeoutMs: 200 }).success).toBe(false)
  })
})

describe('checkPorts', () => {
  it('reports an open local listener only when loopback is explicitly allowed', async () => {
    const port = await listeningServer()
    const result = await checkPorts('127.0.0.1', [port], { allowPrivate: true, timeoutMs: 1000 })
    expect(result.scope).toBe('private')
    expect(result.ports[0]).toMatchObject({ port, state: 'open' })
  })

  it('blocks private and loopback targets by default', async () => {
    await expect(checkPorts('127.0.0.1', [80])).rejects.toMatchObject({ statusCode: 403 })
    await expect(checkPorts('192.168.1.1', [80])).rejects.toMatchObject({ statusCode: 403 })
  })

  it('deduplicates and bounds requested ports', async () => {
    const port = await listeningServer()
    const result = await checkPorts('127.0.0.1', [port, port, port], { allowPrivate: true })
    expect(result.ports).toHaveLength(1)
  })
})
