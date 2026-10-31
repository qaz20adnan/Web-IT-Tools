import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { normalizeHost, resolvePublicAddress } from '../lib/host'
import { enforceRateLimit } from '../lib/rate'
import { describeTlsFailure } from '../lib/net-errors'
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
  const target = await resolvePublicAddress(host)

  const info = await inspectCertificate(target.address, port, 9000, target.address === host ? undefined : host).catch((error: unknown) => {
    throw new HttpError(502, 'upstream_error', describeTlsFailure(error))
  })

  return json(200, info)
})
