import { completeWithFallback, resolveAiConfig } from '../lib/ai'
import { enforceAiAccess, recordAiUsage } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { extractJsonObject } from '../lib/json'
import { analysisPrompt } from '../lib/prompts'
import { enforceRateLimit } from '../lib/rate'
import { analysisSchema, analyzeRequestSchema, flattenZod } from '../lib/schema'

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['POST'])
  enforceRateLimit(`analyze:${clientIp(event, context)}`, 10)
  const parsed = analyzeRequestSchema.safeParse(readJsonBody(event, 8 * 1024 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))

  const input = parsed.data.input
  const account = await enforceAiAccess(event)
  const config = resolveAiConfig(event, { vision: Boolean(input.imageDataUrl) })
  const prompt = analysisPrompt(input)
  const result = await completeWithFallback(config, [{ role: 'user', content: prompt }], {
    maxTokens: 4000,
    temperature: 0.2,
    imageDataUrl: input.imageDataUrl,
  })

  await recordAiUsage(account, 'ai.analyze', config.provider, result.model)
  const candidate = extractJsonObject(result.content)
  const validated = analysisSchema.safeParse(candidate)
  if (!validated.success) {
    throw new HttpError(422, 'upstream_error', 'The model returned an analysis that did not match the required schema.', flattenZod(validated.error))
  }

  return json(200, {
    ...validated.data,
    generatedAt: new Date().toISOString(),
    provider: config.provider,
    model: result.model,
    fallbackUsed: result.fallbackUsed,
    limitations: validated.data.limitations || 'AI-generated guidance. Verify against vendor documentation and test before production changes.',
  })
})
