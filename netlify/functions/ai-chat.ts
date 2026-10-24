import { completeWithFallback, resolveAiConfig } from '../lib/ai'
import { enforceAiAccess, recordAiUsage } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { chatPrompt } from '../lib/prompts'
import { enforceRateLimit } from '../lib/rate'
import { chatRequestSchema, flattenZod } from '../lib/schema'

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['POST'])
  enforceRateLimit(`chat:${clientIp(event, context)}`)
  const parsed = chatRequestSchema.safeParse(readJsonBody(event, 2 * 1024 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const account = await enforceAiAccess(event)
  const config = resolveAiConfig(event)
  const prompt = chatPrompt(parsed.data.mode, parsed.data.messages)
  const result = await completeWithFallback(config, prompt.messages, { maxTokens: 2500 })
  await recordAiUsage(account, 'ai.chat', config.provider, result.model)
  return json(200, {
    content: result.content,
    provider: config.provider,
    model: result.model,
    fallbackUsed: result.fallbackUsed,
  })
})
