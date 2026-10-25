import { requireMember } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, urlRequestSchema } from '../lib/schema'
import { analyzeUrl } from '../lib/net-diagnostics'

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`net-url:${clientIp(event, context)}`, 8)
  const parsed = urlRequestSchema.safeParse(readJsonBody(event, 16 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  try {
    return json(200, await analyzeUrl(parsed.data.url))
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'invalid_input', error instanceof Error ? error.message : 'The URL could not be analyzed.')
  }
})
