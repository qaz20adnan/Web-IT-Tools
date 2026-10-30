import { completeWithFallback, resolveAiConfig } from '../lib/ai'
import { enforceAiAccess, recordAiUsage } from '../lib/auth'
import { clientIp, HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { needsLiveSearch, researchReady, runGroundedResearch } from '../lib/gemini'
import { chatPrompt, researchPrompt } from '../lib/prompts'
import { enforceRateLimit } from '../lib/rate'
import { chatRequestSchema, flattenZod } from '../lib/schema'

export const handler: Handler = wrap(async (event, context) => {
  requireMethod(event, ['POST'])
  enforceRateLimit(`chat:${clientIp(event, context)}`)
  const parsed = chatRequestSchema.safeParse(readJsonBody(event, 2 * 1024 * 1024))
  if (!parsed.success) throw new HttpError(400, 'invalid_input', flattenZod(parsed.error))
  const account = await enforceAiAccess(event)
  const { mode, messages, webSearch } = parsed.data
  const wantsSearch = webSearch === 'on' || (webSearch === 'auto' && researchReady() && needsLiveSearch(messages[messages.length - 1].content))

  if (wantsSearch) {
    enforceRateLimit(`research:${clientIp(event, context)}`, 6)
    const prompt = researchPrompt(mode, messages)
    const result = await runGroundedResearch(prompt)
    await recordAiUsage(account, 'ai.research', 'gemini', result.model)
    return json(200, {
      content: result.content,
      provider: 'gemini',
      model: result.model,
      engine: 'google-search-grounding',
      searchUsed: result.searchUsed,
      searchQueries: result.queries,
      searchRequests: result.searchRequests,
      sources: result.sources,
      elapsedMs: result.elapsedMs,
      incomplete: result.incomplete,
    })
  }

  const config = resolveAiConfig(event)
  const prompt = chatPrompt(mode, messages)
  const result = await completeWithFallback(config, prompt.messages, { maxTokens: 2500 })
  await recordAiUsage(account, 'ai.chat', config.provider, result.model)
  return json(200, {
    content: result.content,
    provider: config.provider,
    model: result.model,
    engine: 'provider-chat',
    searchUsed: false,
    searchQueries: [],
    searchRequests: 0,
    sources: [],
  })
})
