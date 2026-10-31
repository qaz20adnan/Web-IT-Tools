import { completeWithFallback, resolveAiConfig } from '../lib/ai'
import { enforceAiAccess, recordAiUsage } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { extractJsonObject } from '../lib/json'
import { analysisPrompt } from '../lib/prompts'
import { enforceRateLimit } from '../lib/rate'
import { analysisSchema, analyzeRequestSchema, flattenZod } from '../lib/schema'
import { MAX_BODY_BYTES } from '../../shared/upload-limits'

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['POST'])
  enforceRateLimit(`analyze:${clientIp(event, context)}`, 10)
  const parsed = analyzeRequestSchema.safeParse(readJsonBody(event, MAX_BODY_BYTES))
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

  // This path has no search tool, so every URL below is something the model
  // claims to remember. They are labelled, never presented as retrieved sources,
  // and the timestamp a model would invent for a retrieval is dropped.
  const sources = validated.data.sources.map((source) => ({
    title: source.title,
    url: source.url,
    ...(source.publisher ? { publisher: source.publisher } : {}),
    verified: false,
  }))

  return json(200, {
    ...validated.data,
    sources,
    generatedAt: new Date().toISOString(),
    provider: config.provider,
    model: result.model,
    fallbackUsed: result.fallbackUsed,
    limitations: validated.data.limitations || 'AI-generated guidance. Verify against vendor documentation and test before production changes.',
  })
})
