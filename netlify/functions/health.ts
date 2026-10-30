import { json, requireMethod, wrap, type Handler } from '../lib/http'
import { aiDefaults, providerKind, serverConfig, visionDefaults } from '../lib/env'
import { researchStatus } from '../lib/gemini'
import { feedDefinitions, invalidFeedCount } from './news'

export const handler: Handler = wrap(async (event) => {
  requireMethod(event, ['GET'])
  const ai = aiDefaults()
  const vision = visionDefaults()
  const grounded = researchStatus()
  const researchProviders = [
    process.env.TAVILY_API_KEY ? 'Tavily' : null,
    process.env.BRAVE_SEARCH_API_KEY ? 'Brave Search' : null,
  ].filter((value): value is string => Boolean(value))
  const feeds = feedDefinitions()

  return json(200, {
    ok: true,
    time: new Date().toISOString(),
    version: '1.0.0',
    services: {
      ai: {
        configured: Boolean(ai.provider && ai.model && (ai.apiKey || ai.provider === 'ollama')),
        provider: providerKind(process.env.AI_PROVIDER) ?? null,
        model: ai.model || null,
      },
      vision: {
        configured: Boolean(vision.model && (vision.apiKey || vision.provider === 'ollama')),
      },
      research: {
        configured: researchProviders.length > 0 || grounded.configured,
        providers: researchProviders,
        grounded,
      },
      news: {
        configured: feeds.length > 0,
        sources: feeds.length,
        invalidCustomFeeds: invalidFeedCount(),
        customFeeds: Boolean(process.env.NEWS_FEEDS?.trim()),
      },
      database: {
        configured: Boolean(serverConfig.supabaseUrl && serverConfig.supabaseAnonKey && serverConfig.supabaseServiceRoleKey),
      },
      contentAdmin: {
        configured: Boolean(serverConfig.contentAdminToken && serverConfig.supabaseUrl && serverConfig.supabaseServiceRoleKey),
      },
    },
  })
})
