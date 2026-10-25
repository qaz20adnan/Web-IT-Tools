import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { assertPublicHost, normalizeHost } from '../lib/host'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, tlsRequestSchema } from '../lib/schema'
import { inspectCertificate } from '../lib/tls'

const ALLOWED_PORTS = new Set([443, 465, 587, 636, 990, 993, 995, 8443])

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
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

  const info = await inspectCertificate(host, port).catch((error: unknown) => {
    throw new HttpError(502, 'upstream_error', 'Could not complete the TLS handshake.', error instanceof Error ? error.message : undefined)
  })

  return json(200, info)
})
