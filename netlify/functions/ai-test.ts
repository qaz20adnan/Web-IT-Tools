import { recordAiUsage, requireMember, usesClientProviderKey } from '../lib/auth'
import { chatComplete, listModels, newDeadline, resolveAiConfig, verifyProviderAuth, type LiveModelInfo } from '../lib/ai'
import { clientIp, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { enforceRateLimit } from '../lib/rate'

interface TestBody {
  mode?: 'connectivity' | 'chat'
}

export const handler: Handler = wrap(async (event, context) => {
  const account = await requireMember(event, 'ai.use')
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
    // One budget for the verification and the catalog read that follows it.
    const deadline = newDeadline()
    const verification = await verifyProviderAuth(config, { deadline })
    if (!usesClientProviderKey(event)) {
      await recordAiUsage(account, 'ai.test', config.provider, config.model || 'connectivity')
    }
    let models: LiveModelInfo[]
    try {
      models = await listModels(config, { deadline })
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
      keyVerified: verification.keyVerified,
      ...(verification.reason ? { unverifiedReason: verification.reason } : {}),
      ...(verification.note ? { note: verification.note } : {}),
      latencyMs: Date.now() - started,
    })
  }

  const config = resolveAiConfig(event)
  const started = Date.now()
  const reply = await chatComplete(config, [{ role: 'user', content: 'Reply with the single word OK.' }], {
    maxTokens: 16,
    temperature: 0,
  })
  if (!usesClientProviderKey(event)) {
    await recordAiUsage(account, 'ai.test', config.provider, config.model)
  }
  return json(200, {
    ok: true,
    mode: 'chat',
    provider: config.provider,
    model: config.model,
    reply: reply.slice(0, 200),
    latencyMs: Date.now() - started,
  })
})
