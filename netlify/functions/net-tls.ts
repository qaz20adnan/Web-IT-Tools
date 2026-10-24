import net from 'node:net'
import tls from 'node:tls'
import { X509Certificate } from 'node:crypto'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { assertPublicHost, normalizeHost } from '../lib/host'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, tlsRequestSchema } from '../lib/schema'

const ALLOWED_PORTS = new Set([443, 465, 587, 636, 990, 993, 995, 8443])

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['POST'])
  enforceRateLimit(`tls:${clientIp(event, context)}`, 20)
  const parsed = tlsRequestSchema.safeParse(readJsonBody(event, 32 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const host = normalizeHost(parsed.data.host)
  const port = parsed.data.port ?? 443
  if (!ALLOWED_PORTS.has(port)) {
    throw new HttpError(400, 'invalid_input', `Only standard TLS ports are supported: ${[...ALLOWED_PORTS].join(', ')}.`)
  }
  await assertPublicHost(host)

  const result = await new Promise<{ certificate: X509Certificate; protocol: string | null }>((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: net.isIP(host) ? undefined : host,
      rejectUnauthorized: false,
      timeout: 9000,
    })
    const finish = (error?: Error) => {
      socket.destroy()
      if (error) reject(error)
    }
    socket.once('secureConnect', () => {
      try {
        const peer = socket.getPeerCertificate(true)
        if (!peer || !peer.raw) {
          finish(new Error('No peer certificate was returned.'))
          return
        }
        const certificate = new X509Certificate(peer.raw)
        const protocol = socket.getProtocol()
        finish()
        resolve({ certificate, protocol })
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Certificate parsing failed.'))
      }
    })
    socket.once('timeout', () => finish(new Error('TLS connection timed out.')))
    socket.once('error', (error) => finish(error))
  }).catch((error: unknown) => {
    throw new HttpError(502, 'upstream_error', 'Could not complete the TLS handshake.', error instanceof Error ? error.message : undefined)
  })

  const { certificate, protocol } = result
  const validFrom = Date.parse(certificate.validFrom)
  const validTo = Date.parse(certificate.validTo)
  const daysRemaining = Number.isNaN(validTo) ? 0 : Math.floor((validTo - Date.now()) / 86_400_000)

  return json(200, {
    subject: certificate.subject.split('\n').find((line) => line.startsWith('CN='))?.slice(3) ?? certificate.subject.split('\n')[0] ?? host,
    issuer: certificate.issuer.split('\n').find((line) => line.startsWith('CN='))?.slice(3) ?? certificate.issuer.split('\n')[0] ?? 'Unknown',
    validFrom: Number.isNaN(validFrom) ? certificate.validFrom : new Date(validFrom).toISOString(),
    validTo: Number.isNaN(validTo) ? certificate.validTo : new Date(validTo).toISOString(),
    daysRemaining,
    serialNumber: certificate.serialNumber,
    subjectAltNames: (certificate.subjectAltName ?? '')
      .split(', ')
      .filter(Boolean)
      .map((entry) => entry.replace(/^(DNS|IP Address|email|URI):/, '')),
    protocol,
  })
})
