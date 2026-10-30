import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, latencyRequestSchema } from '../lib/schema'
import { probeLatency } from '../lib/net-latency'

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`net-latency:${clientIp(event, context)}`, 12)
  const parsed = latencyRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const result = await probeLatency(parsed.data.host, parsed.data.port, parsed.data.samples, parsed.data.timeoutMs)
  return json(200, result)
})
