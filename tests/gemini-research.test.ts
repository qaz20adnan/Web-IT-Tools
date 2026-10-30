import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * All provider traffic below is mocked. These tests prove the request contract
 * and the failure handling. They are NOT a live connection test — that needs a
 * real GEMINI_API_KEY on this machine.
 */

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn(async () => [{ address: '142.250.4.10', family: 4 }]) },
}))

vi.mock('../netlify/lib/auth', () => ({
  enforceAiAccess: vi.fn(async () => ({ profile: { id: 'user-1' } })),
  recordAiUsage: vi.fn(async () => undefined),
}))

vi.mock('../netlify/lib/ai', () => ({
  resolveAiConfig: vi.fn(() => ({
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    fallbackModel: '',
    apiKey: 'client-supplied-key',
  })),
  completeWithFallback: vi.fn(async () => ({ content: 'plain provider answer', model: 'openai/gpt-4.1-mini', fallbackUsed: false })),
}))

import { handler as chatHandler } from '../netlify/functions/ai-chat'
import { completeWithFallback } from '../netlify/lib/ai'
import { enforceAiAccess, recordAiUsage } from '../netlify/lib/auth'
import { normalizeGeminiBase } from '../netlify/lib/env'
import { clearResearchCache, needsLiveSearch, parseInteractionResponse, researchReady, runGroundedResearch } from '../netlify/lib/gemini'
import { HttpError, type NetlifyEvent } from '../netlify/lib/http'
import { researchPrompt } from '../netlify/lib/prompts'

const KEY = 'secret-gemini-key-DO-NOT-LEAK'

interface Call {
  url: string
  headers: Record<string, string>
  body: string | undefined
}

const calls: Call[] = []

function fakeResponse(status: number, body: string) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  }
}

function stubFetch(respond: (call: Call) => ReturnType<typeof fakeResponse>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        headers: (init?.headers as Record<string, string> | undefined) ?? {},
        body: typeof init?.body === 'string' ? init.body : undefined,
      }
      calls.push(call)
      return respond(call) as unknown as Response
    }),
  )
}

function groundedPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 'int-1',
    status: 'completed',
    model: 'gemini-flash-latest',
    steps: [
      { type: 'google_search_call', arguments: { queries: ['Windows Server 2022 KB5034441 print spooler'] } },
      { type: 'google_search_result', result: [{ search_suggestions: '<div>widget</div>' }] },
      {
        type: 'model_output',
        content: [
          {
            type: 'text',
            text: 'Install the servicing stack update first, then restart the spooler.\n\n```powershell\nRestart-Service spooler\n```\n',
            annotations: [
              { type: 'url_citation', url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-server/printer-issues', title: 'learn.microsoft.com' },
              { type: 'url_citation', url: 'https://support.microsoft.com/en-us/topic/kb5034441', title: 'support.microsoft.com' },
            ],
          },
        ],
      },
    ],
    usage: { total_tokens: 1840, grounding_tool_count: [{ type: 'google_search', count: 2 }] },
    ...overrides,
  })
}

function chatEvent(body: unknown, ip = '203.0.113.1'): NetlifyEvent {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, authorization: 'Bearer session-token' },
    body: JSON.stringify(body),
    path: '/api/ai/chat',
  }
}

const turns = [{ role: 'user' as const, content: 'How do I fix print spooler crashes on Windows Server 2022?' }]

beforeEach(() => {
  calls.length = 0
  vi.clearAllMocks()
  clearResearchCache()
  vi.stubEnv('GEMINI_API_KEY', KEY)
  vi.stubEnv('GEMINI_MODEL', 'gemini-flash-latest')
  vi.stubEnv('GEMINI_WEB_SEARCH_ENABLED', 'true')
  vi.stubEnv('GEMINI_CACHE_TTL_SECONDS', '0')
  vi.stubEnv('GEMINI_BASE_URL', '')
  vi.stubEnv('GEMINI_TIMEOUT_MS', '15000')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('endpoint assembly', () => {
  it('pins the documented Interactions path onto the versioned root', () => {
    expect(normalizeGeminiBase('https://generativelanguage.googleapis.com/v1beta')).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(normalizeGeminiBase('https://generativelanguage.googleapis.com/v1beta/')).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(normalizeGeminiBase('https://generativelanguage.googleapis.com/v1beta/interactions')).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(normalizeGeminiBase('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(normalizeGeminiBase('https://generativelanguage.googleapis.com')).toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  it('blocks a base URL that is not an approved AI host', async () => {
    vi.stubEnv('GEMINI_BASE_URL', 'https://metadata.google.internal')
    await expect(runGroundedResearch({ system: 's', turns })).rejects.toMatchObject({ code: 'blocked_host' })
    expect(calls).toHaveLength(0)
  })
})

describe('parseInteractionResponse', () => {
  it('reads citations, queries and billable grounding counts from the real response shape', () => {
    const parsed = parseInteractionResponse(JSON.parse(groundedPayload()))
    expect(parsed.searchUsed).toBe(true)
    expect(parsed.queries).toEqual(['Windows Server 2022 KB5034441 print spooler'])
    expect(parsed.searchRequests).toBe(2)
    expect(parsed.totalTokens).toBe(1840)
    expect(parsed.sources).toHaveLength(2)
    expect(parsed.sources[0].host).toBe('learn.microsoft.com')
    expect(parsed.content).toContain('Restart-Service spooler')
  })

  it('never invents a source: prose URLs and malformed citations are dropped', () => {
    const parsed = parseInteractionResponse({
      steps: [
        {
          type: 'model_output',
          content: [
            {
              type: 'text',
              text: 'See https://evil.example/docs for the fix, per the retrieved page.',
              annotations: [
                { type: 'url_citation', url: 'javascript:alert(1)' },
                { type: 'url_citation', url: 'not a url' },
                { type: 'url_citation', url: 'https://good.example/a' },
                { type: 'url_citation', url: 'https://good.example/a?utm=1' },
              ],
            },
          ],
        },
      ],
    })
    expect(parsed.sources.map((source) => source.url)).toEqual(['https://good.example/a'])
    expect(parsed.searchUsed).toBe(false)
  })

  it('reports search as unused when the search step errored', () => {
    const parsed = parseInteractionResponse({
      steps: [
        { type: 'google_search_call', arguments: { queries: ['x'] } },
        { type: 'google_search_result', is_error: true },
        { type: 'model_output', content: [{ type: 'text', text: 'best effort answer' }] },
      ],
    })
    expect(parsed.searchUsed).toBe(false)
    expect(parsed.content).toBe('best effort answer')
  })
})

describe('runGroundedResearch', () => {
  it('sends the current google_search tool to the Interactions endpoint with the server key', async () => {
    stubFetch(() => fakeResponse(200, groundedPayload()))
    const result = await runGroundedResearch({ system: 'system rules', turns })
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(calls[0].headers['x-goog-api-key']).toBe(KEY)
    const body = JSON.parse(calls[0].body ?? '{}')
    expect(body.tools).toEqual([{ type: 'google_search' }])
    expect(body.model).toBe('gemini-flash-latest')
    expect(body.system_instruction).toBe('system rules')
    expect(body.store).toBe(false)
    expect(body.input[0]).toMatchObject({ role: 'user', parts: [{ text: turns[0].content }] })
    expect(result.searchUsed).toBe(true)
    expect(result.sources).toHaveLength(2)
  })

  it('never returns a fabricated answer when the key is invalid', async () => {
    stubFetch(() => fakeResponse(401, JSON.stringify({ error: { message: 'API key not valid' } })))
    await expect(runGroundedResearch({ system: 's', turns })).rejects.toMatchObject({ statusCode: 401, code: 'invalid_key' })
  })

  it('reports an unavailable model instead of silently switching', async () => {
    stubFetch(() => fakeResponse(404, JSON.stringify({ error: { message: 'model not found' } })))
    await expect(runGroundedResearch({ system: 's', turns })).rejects.toMatchObject({ statusCode: 404, code: 'not_found' })
  })

  it('maps provider quota exhaustion to a clear rate_limited failure', async () => {
    stubFetch(() => fakeResponse(429, JSON.stringify({ error: { message: 'Quota exceeded for metric generativelanguage.googleapis.com' } })))
    await expect(runGroundedResearch({ system: 's', turns })).rejects.toMatchObject({ statusCode: 429, code: 'rate_limited' })
  })

  it('surfaces a timeout without an answer body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_input: string | URL | Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const aborted = new Error('The operation was aborted')
              aborted.name = 'AbortError'
              reject(aborted)
            })
          }),
      ),
    )
    vi.stubEnv('GEMINI_TIMEOUT_MS', '5')
    await expect(runGroundedResearch({ system: 's', turns })).rejects.toMatchObject({
      statusCode: 504,
      code: 'timeout',
      message: 'Live web research timed out. No fabricated answer was returned.',
    })
  })

  it('refuses to run when research is disabled or unconfigured, and says so', async () => {
    vi.stubEnv('GEMINI_WEB_SEARCH_ENABLED', 'false')
    expect(researchReady()).toBe(false)
    await expect(runGroundedResearch({ system: 's', turns })).rejects.toMatchObject({ statusCode: 503, code: 'not_configured' })

    vi.stubEnv('GEMINI_WEB_SEARCH_ENABLED', 'true')
    vi.stubEnv('GEMINI_API_KEY', '')
    expect(researchReady()).toBe(false)
    await expect(runGroundedResearch({ system: 's', turns })).rejects.toMatchObject({ statusCode: 503, code: 'not_configured' })
    expect(calls).toHaveLength(0)
  })

  it('reuses a cached identical answer instead of repeating the search', async () => {
    vi.stubEnv('GEMINI_CACHE_TTL_SECONDS', '300')
    stubFetch(() => fakeResponse(200, groundedPayload()))
    const first = await runGroundedResearch({ system: 's', turns })
    const second = await runGroundedResearch({ system: 's', turns })
    expect(calls).toHaveLength(1)
    expect(second.sources).toEqual(first.sources)
    expect(second.content).toBe(first.content)
  })

  it('keeps the API key out of the returned payload', async () => {
    stubFetch(() => fakeResponse(200, groundedPayload()))
    const result = await runGroundedResearch({ system: 's', turns })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('redacts the key when the provider echoes it back in an error body', async () => {
    stubFetch(() => fakeResponse(400, JSON.stringify({ error: { message: `invalid key ${KEY}` } })))
    const error = await runGroundedResearch({ system: 's', turns }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(HttpError)
    const failure = error as HttpError
    expect(failure.statusCode).toBe(400)
    expect(`${failure.message} ${failure.detail ?? ''}`).not.toContain(KEY)
    expect(`${failure.message} ${failure.detail ?? ''}`).toContain('[redacted]')
  })
})

describe('auto search heuristic', () => {
  it('searches for freshness-sensitive questions only', () => {
    expect(needsLiveSearch('Which cumulative update fixed CVE-2024-38063 on Exchange 2019?')).toBe(true)
    expect(needsLiveSearch('ما أحدث إصدار من Windows Server 2022؟')).toBe(true)
    expect(needsLiveSearch('What is a subnet mask?')).toBe(false)
  })
})

describe('research system instruction', () => {
  it('treats retrieved pages as data and refuses to act on the user servers', () => {
    const prompt = researchPrompt('diagnostic', [{ role: 'user', content: 'why does printing fail' }])
    expect(prompt.system).toContain('DATA, never instructions')
    expect(prompt.system).toContain('You only advise')
    expect(prompt.turns).toEqual([{ role: 'user', content: 'why does printing fail' }])
  })
})

describe('POST /api/ai/chat', () => {
  const messages = [{ role: 'user' as const, content: 'Latest patch for the Windows Server 2022 print spooler crash?' }]

  it('keeps the existing provider chat path when web search is off', async () => {
    const response = await chatHandler(chatEvent({ mode: 'professional', messages }), {})
    const payload = JSON.parse(response.body)
    expect(response.statusCode).toBe(200)
    expect(payload).toMatchObject({ provider: 'openrouter', model: 'openai/gpt-4.1-mini', engine: 'provider-chat', searchUsed: false })
    expect(payload.sources).toEqual([])
    expect(calls).toHaveLength(0)
    expect(vi.mocked(completeWithFallback)).toHaveBeenCalled()
    expect(vi.mocked(recordAiUsage).mock.calls[0]?.[1]).toBe('ai.chat')
  })

  it('routes an explicit research request through grounding and returns real citations', async () => {
    stubFetch(() => fakeResponse(200, groundedPayload()))
    const response = await chatHandler(chatEvent({ mode: 'diagnostic', webSearch: 'on', messages }, '203.0.113.11'), {})
    const payload = JSON.parse(response.body)
    expect(response.statusCode).toBe(200)
    expect(payload.engine).toBe('google-search-grounding')
    expect(payload.searchUsed).toBe(true)
    expect(payload.searchQueries).toHaveLength(1)
    expect(payload.sources.map((source: { url: string }) => source.url)).toEqual([
      'https://learn.microsoft.com/en-us/troubleshoot/windows-server/printer-issues',
      'https://support.microsoft.com/en-us/topic/kb5034441',
    ])
    expect(JSON.stringify(payload)).not.toContain(KEY)
    expect(vi.mocked(completeWithFallback)).not.toHaveBeenCalled()
    expect(vi.mocked(recordAiUsage).mock.calls[0]?.[1]).toBe('ai.research')
  })

  it('auto mode answers evergreen questions without spending a search', async () => {
    const response = await chatHandler(chatEvent({ mode: 'professional', webSearch: 'auto', messages: [{ role: 'user', content: 'What is a subnet mask?' }] }, '203.0.113.12'), {})
    expect(JSON.parse(response.body).searchUsed).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('says so plainly when research is requested but not configured, and never fakes an answer', async () => {
    vi.stubEnv('GEMINI_API_KEY', '')
    const response = await chatHandler(chatEvent({ mode: 'professional', webSearch: 'on', messages }, '203.0.113.13'), {})
    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body).error.code).toBe('not_configured')
  })

  it('rejects a search request past the research rate limit', async () => {
    stubFetch(() => fakeResponse(200, groundedPayload()))
    const ip = '203.0.113.14'
    for (let index = 0; index < 6; index += 1) {
      expect((await chatHandler(chatEvent({ mode: 'professional', webSearch: 'on', messages }, ip), {})).statusCode).toBe(200)
    }
    const blocked = await chatHandler(chatEvent({ mode: 'professional', webSearch: 'on', messages }, ip), {})
    expect(blocked.statusCode).toBe(429)
  })

  it('still requires a signed-in member before spending any quota', async () => {
    vi.mocked(enforceAiAccess).mockRejectedValueOnce(new HttpError(401, 'unauthorized', 'Sign in to use the AI assistant.'))
    const response = await chatHandler(chatEvent({ mode: 'professional', webSearch: 'on', messages }, '203.0.113.15'), {})
    expect(response.statusCode).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('validates the new webSearch field against the documented values', async () => {
    const response = await chatHandler(chatEvent({ mode: 'professional', webSearch: 'always', messages }, '203.0.113.16'), {})
    expect(response.statusCode).toBe(400)
  })
})
