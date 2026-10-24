import { completeWithFallback, resolveAiConfig } from '../lib/ai'
import { enforceAiAccess, recordAiUsage } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { extractJsonObject } from '../lib/json'
import { scriptGeneratePrompt, scriptReviewPrompt } from '../lib/prompts'
import { enforceRateLimit } from '../lib/rate'
import { flattenZod, scriptRequestSchema, scriptResultSchema } from '../lib/schema'

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['POST'])
  enforceRateLimit(`script:${clientIp(event, context)}`, 10)
  const parsed = scriptRequestSchema.safeParse(readJsonBody(event, 2 * 1024 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))

  const request = parsed.data
  const account = await enforceAiAccess(event)
  const config = resolveAiConfig(event)
  const prompt = request.action === 'generate'
    ? scriptGeneratePrompt(request.prompt, request.language || 'powershell')
    : scriptReviewPrompt(request.code, request.language || 'powershell')
  const result = await completeWithFallback(config, [{ role: 'user', content: prompt }], { maxTokens: 3500, temperature: 0.2 })
  await recordAiUsage(account, 'ai.script', config.provider, result.model)
  const candidate = extractJsonObject(result.content)
  const validated = scriptResultSchema.safeParse(candidate)
  if (!validated.success) {
    throw new HttpError(422, 'upstream_error', 'The model returned a script result that did not match the required schema.', flattenZod(validated.error))
  }

  return json(200, {
    code: validated.data.code,
    feedback: validated.data.feedback,
    language: request.language || 'powershell',
    provider: config.provider,
    model: result.model,
    fallbackUsed: result.fallbackUsed,
  })
})
