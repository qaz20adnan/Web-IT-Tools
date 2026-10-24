import { describe, expect, it } from 'vitest'
import {
  classifyProbeAddress,
  normalizeProbeHost,
  parseIppResponse,
  resolveProbeAddresses,
} from '../netlify/lib/net-probe'

function attribute(tag: number, name: string, value: string | Buffer): Buffer {
  const nameBuffer = Buffer.from(name, 'utf8')
  const valueBuffer = typeof value === 'string' ? Buffer.from(value, 'utf8') : value
  const header = Buffer.alloc(5)
  header[0] = tag
  header.writeUInt16BE(nameBuffer.length, 1)
  header.writeUInt16BE(valueBuffer.length, 3)
  return Buffer.concat([header, nameBuffer, valueBuffer])
}

function ippResponse(status: number, attributes: Buffer[]): Buffer {
  const header = Buffer.alloc(8)
  header[0] = 1
  header[1] = 1
  header.writeUInt16BE(status, 2)
  header.writeUInt32BE(1, 4)
  return Buffer.concat([header, Buffer.from([0x01]), ...attributes, Buffer.from([0x03])])
}

describe('net-probe address policy', () => {
  it('classifies public, private and blocked addresses', () => {
    expect(classifyProbeAddress('8.8.8.8')).toBe('public')
    expect(classifyProbeAddress('192.168.1.10')).toBe('private')
    expect(classifyProbeAddress('10.1.2.3')).toBe('private')
    expect(classifyProbeAddress('100.64.0.1')).toBe('private')
    expect(classifyProbeAddress('127.0.0.1')).toBe('blocked')
    expect(classifyProbeAddress('169.254.1.1')).toBe('blocked')
    expect(classifyProbeAddress('224.0.0.1')).toBe('blocked')
    expect(classifyProbeAddress('203.0.113.1')).toBe('blocked')
    expect(classifyProbeAddress('::1')).toBe('blocked')
    expect(classifyProbeAddress('fe80::1')).toBe('blocked')
    expect(classifyProbeAddress('fd00::1')).toBe('private')
    expect(classifyProbeAddress('::ffff:192.168.1.5')).toBe('private')
    expect(classifyProbeAddress('not-an-ip')).toBe('blocked')
  })

  it('normalizes hosts and rejects URLs and internal suffixes', () => {
    expect(normalizeProbeHost('  Printer.Example.COM. ')).toBe('printer.example.com')
    expect(normalizeProbeHost('[2001:4860:4860::8888]')).toBe('2001:4860:4860::8888')
    expect(() => normalizeProbeHost('https://printer.example.com/ipp')).toThrow()
    expect(() => normalizeProbeHost('printer.local')).toThrow()
    expect(() => normalizeProbeHost('bad host')).toThrow()
  })

  it('enforces private/public probe policy', async () => {
    await expect(
      resolveProbeAddresses('10.0.0.5', { allowPrivate: false, allowPublic: true }),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      resolveProbeAddresses('8.8.8.8', { allowPrivate: true, allowPublic: false }),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      resolveProbeAddresses('127.0.0.1', { allowPrivate: true, allowPublic: true }),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      resolveProbeAddresses('192.168.1.5', { allowPrivate: true, allowPublic: false }),
    ).resolves.toEqual({ host: '192.168.1.5', addresses: ['192.168.1.5'] })
    await expect(
      resolveProbeAddresses('8.8.8.8', { allowPrivate: false, allowPublic: true }),
    ).resolves.toEqual({ host: '8.8.8.8', addresses: ['8.8.8.8'] })
    await expect(
      resolveProbeAddresses('100.64.0.1', { allowPrivate: false, allowPublic: true }),
    ).rejects.toMatchObject({ statusCode: 403 })
    await expect(
      resolveProbeAddresses('100.64.0.1', { allowPrivate: false, allowPublic: true, allowCgnat: true }),
    ).resolves.toEqual({ host: '100.64.0.1', addresses: ['100.64.0.1'] })
  })
})

describe('IPP parser', () => {
  it('parses attributes and integer values', () => {
    const queue = Buffer.alloc(4)
    queue.writeInt32BE(3, 0)
    const parsed = parseIppResponse(
      ippResponse(0x0000, [
        attribute(0x47, 'printer-name', 'Lab Printer'),
        attribute(0x21, 'queued-job-count', queue),
        attribute(0x44, 'printer-state-reasons', 'none'),
      ]),
    )
    expect(parsed.statusCode).toBe(0)
    expect(parsed.statusName).toBe('successful-ok')
    expect(parsed.attributes['printer-name']).toEqual(['Lab Printer'])
    expect(parsed.attributes['queued-job-count']).toEqual(['3'])
    expect(parsed.attributes['printer-state-reasons']).toEqual(['none'])
  })

  it('appends additional values that reuse the previous attribute name', () => {
    const parsed = parseIppResponse(
      ippResponse(0x0000, [
        attribute(0x44, 'printer-state-reasons', 'none'),
        attribute(0x44, '', 'media-empty'),
      ]),
    )
    expect(parsed.attributes['printer-state-reasons']).toEqual(['none', 'media-empty'])
  })

  it('maps server errors and rejects truncated responses', () => {
    const parsed = parseIppResponse(ippResponse(0x0506, []))
    expect(parsed.statusName).toBe('server-error-not-accepting-jobs')
    expect(() => parseIppResponse(Buffer.from([1, 2]))).toThrow('too short')
  })
})
