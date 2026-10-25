import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, tracerouteRequestSchema } from '../lib/schema'
import { tracerouteHost } from '../lib/net-diagnostics'

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`net-traceroute:${clientIp(event, context)}`, 6)
  const parsed = tracerouteRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const result = await tracerouteHost(parsed.data.host, parsed.data.maxHops, parsed.data.timeoutMs)
  return json(200, result)
})
