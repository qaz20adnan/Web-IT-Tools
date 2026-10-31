import { listModels, resolveAiConfig } from '../lib/ai'
import { recordAiUsage, requireMember, usesClientProviderKey } from '../lib/auth'
import { clientIp, json, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['GET', 'POST'])
  const account = await requireMember(event, 'ai.use')
  enforceRateLimit(`models:${clientIp(event, context)}`, 20)
  const config = resolveAiConfig(event, { requireModel: false, allowAnonymous: true })
  const models = await listModels(config)
  if (!usesClientProviderKey(event)) {
    await recordAiUsage(account, 'ai.models', config.provider, config.model || 'model-list')
  }
  return json(200, {
    models,
    provider: config.provider,
    count: models.length,
    fetchedAt: new Date().toISOString(),
  })
})
