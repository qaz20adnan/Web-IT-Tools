import { requireMember } from '../lib/auth'
import { chatComplete, listModels, resolveAiConfig, verifyProviderAuth, type LiveModelInfo } from '../lib/ai'
import { clientIp, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'

interface TestBody {
  mode?: 'connectivity' | 'chat'
}

export const handler: Handler = wrap(async (event, context) => {
  await requireMember(event)
  requireMethod(event, ['POST'])
  enforceRateLimit(`test:${clientIp(event, context)}`, 12)

  let mode: TestBody['mode'] = 'connectivity'
  if (event.body) {
    try {
      const body = readJsonBody<TestBody>(event, 64 * 1024)
      if (body?.mode === 'chat') mode = 'chat'
    } catch {
      mode = 'connectivity'
    }
  }

  if (mode === 'connectivity') {
    const config = resolveAiConfig(event, { requireModel: false })
    const started = Date.now()
    await verifyProviderAuth(config)
    let models: LiveModelInfo[]
    try {
      models = await listModels(config)
    } catch {
      models = []
    }
    const modelAvailable = config.model && models.length > 0 ? models.some((entry) => entry.id === config.model) : null
    return json(200, {
      ok: true,
      mode: 'connectivity',
      provider: config.provider,
      model: config.model || null,
      models: models.length,
      modelAvailable,
      latencyMs: Date.now() - started,
    })
  }

  const config = resolveAiConfig(event)
  const started = Date.now()
  const reply = await chatComplete(config, [{ role: 'user', content: 'Reply with the single word OK.' }], {
    maxTokens: 16,
    temperature: 0,
  })
  return json(200, {
    ok: true,
    mode: 'chat',
    provider: config.provider,
    model: config.model,
    reply: reply.slice(0, 200),
    latencyMs: Date.now() - started,
  })
})
