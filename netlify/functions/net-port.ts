import { requireMember } from '../lib/auth'
import { serverConfig } from '../lib/env'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, portRequestSchema } from '../lib/schema'
import { checkPorts } from '../lib/net-diagnostics'

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`net-port:${clientIp(event, context)}`, 8)
  const parsed = portRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const uniquePorts = [...new Set(parsed.data.ports)]
  if (uniquePorts.length !== parsed.data.ports.length) {
    throw new HttpError(400, 'invalid_input', 'Duplicate ports are not allowed in a single request.')
  }
  const result = await checkPorts(parsed.data.host, uniquePorts, {
    allowPrivate: serverConfig.netProbeAllowPrivate,
    timeoutMs: parsed.data.timeoutMs,
  })
  return json(200, result)
})
