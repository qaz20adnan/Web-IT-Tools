import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { normalizeDnsName } from '../lib/net-doh'
import { probePath } from '../lib/net-path'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, pathRequestSchema } from '../lib/schema'

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`net-path:${clientIp(event, context)}`, 12)
  const parsed = pathRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  let target: string
  try {
    target = normalizeDnsName(parsed.data.host)
  } catch (error) {
    throw new HttpError(400, 'invalid_input', error instanceof Error ? error.message : 'Enter a valid hostname.')
  }
  return json(200, await probePath(target))
})
