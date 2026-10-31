import net from 'node:net'
import tls from 'node:tls'
import { X509Certificate } from 'node:crypto'

export interface CertificateInfo {
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  daysRemaining: number
  serialNumber: string
  subjectAltNames: string[]
  protocol: string | null
}

export function inspectCertificate(
  host: string,
  port = 443,
  timeoutMs = 9000,
  /**
   * The name to present as SNI when `host` is a literal address. Callers that
   * resolve-and-validate connect to the IP they checked, and a TLS handshake with
   * no servername reaches the host's default vhost — or, for a CDN, a different
   * certificate than the hostname the person typed.
   */
  servername?: string,
): Promise<CertificateInfo> {
  return new Promise<CertificateInfo>((resolve, reject) => {
    const socket = tls.connect({
      host,
      port,
      servername: servername ?? (net.isIP(host) ? undefined : host),
      rejectUnauthorized: false,
      timeout: timeoutMs,
    })
    let settled = false
    const finish = (error?: Error, info?: CertificateInfo) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else if (info) resolve(info)
    }
    socket.once('secureConnect', () => {
      try {
        const peer = socket.getPeerCertificate(true)
        if (!peer || !peer.raw) {
          finish(new Error('No peer certificate was returned.'))
          return
        }
        const certificate = new X509Certificate(peer.raw)
        const validFrom = Date.parse(certificate.validFrom)
        const validTo = Date.parse(certificate.validTo)
        const daysRemaining = Number.isNaN(validTo) ? 0 : Math.floor((validTo - Date.now()) / 86_400_000)
        finish(undefined, {
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
          protocol: socket.getProtocol(),
        })
      } catch (error) {
        finish(error instanceof Error ? error : new Error('Certificate parsing failed.'))
      }
    })
    socket.once('timeout', () => finish(new Error('TLS connection timed out.')))
    socket.once('error', (error) => finish(error))
  })
}
