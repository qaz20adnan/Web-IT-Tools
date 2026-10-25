import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, httpRequestSchema } from '../lib/schema'
import { checkHttp } from '../lib/net-diagnostics'

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`net-http:${clientIp(event, context)}`, 10)
  const parsed = httpRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  try {
    const result = await checkHttp(parsed.data.url, parsed.data.method, parsed.data.followRedirects, parsed.data.timeoutMs)
    return json(200, result)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'upstream_error', error instanceof Error ? error.message : 'The HTTP check failed.')
  }
})
