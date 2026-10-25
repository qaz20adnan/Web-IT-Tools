import { listModels, resolveAiConfig } from '../lib/ai'
import { requireMember } from '../lib/auth'
import { clientIp, json, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['GET', 'POST'])
  await requireMember(event)
  enforceRateLimit(`models:${clientIp(event, context)}`, 20)
  const config = resolveAiConfig(event, { requireModel: false, allowAnonymous: true })
  const models = await listModels(config)
  return json(200, {
    models,
    provider: config.provider,
    count: models.length,
    fetchedAt: new Date().toISOString(),
  })
})
