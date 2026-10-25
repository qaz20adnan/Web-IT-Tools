import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, pingRequestSchema } from '../lib/schema'
import { pingHost } from '../lib/net-diagnostics'

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`net-ping:${clientIp(event, context)}`, 10)
  const parsed = pingRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const result = await pingHost(parsed.data.host, parsed.data.count, parsed.data.timeoutMs)
  return json(200, result)
})
