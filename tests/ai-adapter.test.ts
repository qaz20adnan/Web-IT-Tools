import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn(async () => [{ address: '104.18.2.1', family: 4 }]) },
}))

import {
  chatComplete,
  completeWithFallback,
  listModels,
  newDeadline,
  normalizeBaseUrl,
  PLATFORM_BUDGET_MS,
  resolveAiConfig,
  verifyProviderAuth,
  type AiConfig,
  type Deadline,
} from '../netlify/lib/ai'
import { HttpError, type NetlifyEvent } from '../netlify/lib/http'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: string | undefined
}

type FakeResponse = {
  status: number
  body: string
  ok: boolean
  headers: Headers
  arrayBuffer: () => Promise<ArrayBuffer>
}

function fakeResponse(status: number, body: string, extraHeaders: Record<string, string> = {}): FakeResponse {
  return {
    status,
    body,
    ok: status >= 200 && status < 300,
    headers: new Headers(extraHeaders),
    arrayBuffer: async () => new TextEncoder().encode(body).buffer,
  }
}

const calls: Call[] = []

function stubFetch(handler: (call: Call) => FakeResponse | Promise<FakeResponse>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? 'GET',
        headers: (init?.headers as Record<string, string> | undefined) ?? {},
        body: typeof init?.body === 'string' ? init.body : undefined,
      }
      calls.push(call)
      return handler(call) as unknown as Response
    }),
  )
}

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    fallbackModel: '',
    apiKey: 'sk-or-v1-test',
    ...overrides,
  }
}

function event(headers: Record<string, string>): NetlifyEvent {
  return { httpMethod: 'GET', headers, body: null, path: '/api/ai/models' }
}

beforeEach(() => {
  calls.length = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('normalizeBaseUrl', () => {
  it('strips pasted endpoint suffixes so the path is never doubled', () => {
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1/models')).toBe('https://openrouter.ai/api/v1')
    expect(normalizeBaseUrl('https://openrouter.ai/api/v1/chat/completions')).toBe('https://openrouter.ai/api/v1')
    expect(normalizeBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent')).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(normalizeBaseUrl('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash')).toBe('https://generativelanguage.googleapis.com/v1beta')
    expect(normalizeBaseUrl('http://localhost:11434/api/chat')).toBe('http://localhost:11434')
  })

  it('is idempotent', () => {
    const once = normalizeBaseUrl('https://openrouter.ai/api/v1/models/')
    expect(normalizeBaseUrl(once)).toBe(once)
  })
})

describe('listModels', () => {
  it('requests the documented catalog path exactly once', async () => {
    stubFetch(() =>
      fakeResponse(
        200,
        JSON.stringify({
          data: [
            {
              id: 'vendor/model-a',
              name: 'Vendor Model A',
              context_length: 200000,
              architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] },
              supported_parameters: ['tools', 'response_format'],
              pricing: { prompt: '0.000002', completion: '0.000008' },
            },
          ],
        }),
      ),
    )
    const models = await listModels(config())
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/models')
    expect(calls[0].headers.Authorization).toBe('Bearer sk-or-v1-test')
    expect(calls[0].headers['HTTP-Referer']).toBeTruthy()
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: 'vendor/model-a',
      name: 'Vendor Model A',
      contextLength: 200000,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      supportedParameters: ['tools', 'response_format'],
      pricing: 'in $2.00/1M · out $8.00/1M',
    })
  })

  it('reads the Gemini catalog shape (models + camelCase fields)', async () => {
    stubFetch(() =>
      fakeResponse(
        200,
        JSON.stringify({
          models: [
            { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', inputTokenLimit: 1048576, description: 'Fast model' },
          ],
        }),
      ),
    )
    const models = await listModels(config({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash' }))
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(calls[0].headers['x-goog-api-key']).toBe('sk-or-v1-test')
    expect(models[0]).toMatchObject({ id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextLength: 1048576 })
  })

  it('maps auth and not-found failures to distinct error codes', async () => {
    stubFetch(() => fakeResponse(401, JSON.stringify({ error: { message: 'No auth credentials found' } })))
    await expect(listModels(config())).rejects.toMatchObject({ statusCode: 401, code: 'invalid_key' })

    calls.length = 0
    stubFetch(() => fakeResponse(404, JSON.stringify({ error: { message: 'Not Found' } })))
    await expect(listModels(config())).rejects.toMatchObject({ statusCode: 404, code: 'not_found' })
  })

  it('retries a rate-limited response once and surfaces rate_limited', async () => {
    stubFetch(() => fakeResponse(429, JSON.stringify({ error: { message: 'slow down' } })))
    await expect(listModels(config())).rejects.toMatchObject({ statusCode: 429, code: 'rate_limited' })
    expect(calls).toHaveLength(2)
  })

  it('rejects non-JSON upstream bodies as upstream_error', async () => {
    stubFetch(() => fakeResponse(200, '<html>not json</html>'))
    await expect(listModels(config())).rejects.toMatchObject({ statusCode: 502, code: 'upstream_error' })
  })
})

describe('chatComplete', () => {
  it('calls the OpenAI-compatible chat endpoint and returns content', async () => {
    stubFetch(() => fakeResponse(200, JSON.stringify({ choices: [{ message: { content: 'hello' } }] })))
    const reply = await chatComplete(config(), [{ role: 'user', content: 'hi' }])
    expect(reply).toBe('hello')
    expect(calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(JSON.parse(calls[0].body ?? '{}')).toMatchObject({ model: 'openai/gpt-4.1-mini' })
  })

  it('calls the Anthropic messages endpoint with the required version header', async () => {
    stubFetch(() => fakeResponse(200, JSON.stringify({ content: [{ type: 'text', text: 'claude reply' }] })))
    const reply = await chatComplete(
      config({ provider: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5', apiKey: 'sk-ant-test' }),
      [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hi' }],
    )
    expect(reply).toBe('claude reply')
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01')
    expect(calls[0].headers['x-api-key']).toBe('sk-ant-test')
    expect(calls[0].headers.Authorization).toBeUndefined()
    const body = JSON.parse(calls[0].body ?? '{}')
    expect(body.system).toBe('be brief')
    expect(body.messages).toHaveLength(1)
  })

  it('builds the Gemini generateContent path without doubling the models segment', async () => {
    stubFetch(() => fakeResponse(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini reply' }] } }] })))
    const reply = await chatComplete(
      config({ provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'models/gemini-2.0-flash' }),
      [{ role: 'user', content: 'hi' }],
    )
    expect(reply).toBe('gemini reply')
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent')
    expect(calls[0].headers['x-goog-api-key']).toBe('sk-or-v1-test')
  })
})

describe('verifyProviderAuth', () => {
  it('uses the authenticated /key endpoint for OpenRouter instead of the public catalog', async () => {
    stubFetch(() => fakeResponse(200, JSON.stringify({ data: { label: 'test' } })))
    const result = await verifyProviderAuth(config())
    expect(result.keyVerified).toBe(true)
    expect(result.note).toBeUndefined()
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(calls.map((call) => call.url)).toEqual(['https://openrouter.ai/api/v1/key'])
    expect(calls[0].headers.Authorization).toBe('Bearer sk-or-v1-test')
  })

  it('reports an invalid key from /key', async () => {
    stubFetch(() => fakeResponse(401, JSON.stringify({ error: { message: 'User not found.' } })))
    await expect(verifyProviderAuth(config())).rejects.toMatchObject({ statusCode: 401, code: 'invalid_key' })
  })

  it('counts a catalog that needs no key as reachable but unproven', async () => {
    stubFetch(() => fakeResponse(200, JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }] })))
    const result = await verifyProviderAuth(config({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }))
    expect(result.keyVerified).toBe(false)
    expect(result.note).toMatch(/not verified/)
    expect(calls.map((call) => call.url)).toEqual(['https://api.openai.com/v1/models', 'https://api.openai.com/v1/models'])
    expect(calls[0].headers.Authorization).toBe('Bearer sk-or-v1-test')
    expect(calls[1].headers.Authorization).toBeUndefined()
  })

  it('proves the key when the catalog is only served with credentials', async () => {
    stubFetch((call) =>
      call.headers.Authorization
        ? fakeResponse(200, JSON.stringify({ data: [{ id: 'gpt-4.1-mini' }] }))
        : fakeResponse(401, JSON.stringify({ error: { message: 'Incorrect API key provided.' } })),
    )
    const result = await verifyProviderAuth(config({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }))
    expect(result).toEqual({ latencyMs: expect.any(Number), keyVerified: true })
  })

  it('reports Ollama as reachable without claiming a credential', async () => {
    process.env.AI_ALLOWED_HOSTS = 'ollama.example'
    stubFetch(() => fakeResponse(200, JSON.stringify({ models: [{ name: 'llama3' }] })))
    try {
      const result = await verifyProviderAuth(config({ provider: 'ollama', baseUrl: 'https://ollama.example', apiKey: '' }))
      expect(result.keyVerified).toBe(false)
      expect(result.note).toMatch(/does not use an API key/)
      expect(calls.map((call) => call.url)).toEqual(['https://ollama.example/api/tags'])
    } finally {
      delete process.env.AI_ALLOWED_HOSTS
    }
  })
})

describe('completeWithFallback', () => {
  it('retries with the fallback model only when the primary model is unavailable', async () => {
    stubFetch((call) => {
      const body = JSON.parse(call.body ?? '{}')
      if (body.model === 'missing/model') return fakeResponse(404, JSON.stringify({ error: { message: 'No endpoints found' } }))
      return fakeResponse(200, JSON.stringify({ choices: [{ message: { content: 'fallback answer' } }] }))
    })
    const result = await completeWithFallback(config({ model: 'missing/model', fallbackModel: 'openai/gpt-4.1-mini' }), [{ role: 'user', content: 'hi' }])
    expect(result).toEqual({ content: 'fallback answer', model: 'openai/gpt-4.1-mini', fallbackUsed: true })
    expect(calls.map((call) => JSON.parse(call.body ?? '{}').model)).toEqual(['missing/model', 'openai/gpt-4.1-mini'])
  })

  it('does not retry credential failures with a different model', async () => {
    stubFetch(() => fakeResponse(401, JSON.stringify({ error: { message: 'bad key' } })))
    await expect(
      completeWithFallback(config({ fallbackModel: 'openai/gpt-4.1-mini' }), [{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(HttpError)
    expect(calls).toHaveLength(1)
  })
})

/**
 * Netlify standard functions and `vercel.json`'s `maxDuration` both die at 60 s.
 * A kill there returns a platform error page, so the AI layer must stop itself.
 * These fakes repeat the library's 1.5 s floor on purpose: the point is what the
 * callers do with a deadline, not the arithmetic inside `newDeadline`.
 */
describe('request budget', () => {
  it('stays below the platform ceiling', () => {
    expect(PLATFORM_BUDGET_MS).toBeLessThan(60_000)
  })

  it('shrinks each attempt to the budget that is left', () => {
    const fresh = newDeadline(30_000, Date.now())
    expect(fresh.nextAttemptMs(60_000)).toBeLessThanOrEqual(30_000)

    const nearlySpent = newDeadline(30_000, Date.now() - 29_000)
    expect(nearlySpent.remainingMs()).toBeLessThan(1_500)
    expect(nearlySpent.nextAttemptMs(60_000)).toBeNull()
    expect(nearlySpent.canAttempt()).toBe(false)
  })

  it('hands the clamped timeout to the upstream fetch instead of AI_TIMEOUT_MS', async () => {
    const timeouts: number[] = []
    const realSetTimeout = globalThis.setTimeout
    globalThis.setTimeout = ((handler: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (typeof ms === 'number' && ms > 0) timeouts.push(ms)
      return realSetTimeout(handler as () => void, ms, ...args)
    }) as typeof setTimeout
    try {
      stubFetch(() => fakeResponse(200, JSON.stringify({ choices: [{ message: { content: 'ok' } }] })))
      const reply = await chatComplete(config(), [{ role: 'user', content: 'hi' }], { deadline: slowProvider(40_000, 8_000) })
      expect(reply).toBe('ok')
    } finally {
      globalThis.setTimeout = realSetTimeout
    }
    expect(timeouts).toContain(8_000)
    expect(timeouts).not.toContain(60_000)
  })

  it('refuses to send a request once the budget is spent', async () => {
    stubFetch(() => fakeResponse(200, JSON.stringify({ choices: [{ message: { content: 'ok' } }] })))
    await expect(chatComplete(config(), [{ role: 'user', content: 'hi' }], { deadline: spentDeadline() })).rejects.toMatchObject({
      statusCode: 504,
      code: 'timeout',
    })
    expect(calls).toHaveLength(0)
  })

  it('reports the real upstream cause instead of retrying past the budget', async () => {
    stubFetch(() => fakeResponse(429, JSON.stringify({ error: { message: 'slow down' } })))
    const deadline = slowProvider(60_000, 20_000, () => false)
    await expect(chatComplete(config(), [{ role: 'user', content: 'hi' }], { deadline })).rejects.toMatchObject({
      statusCode: 429,
      code: 'rate_limited',
    })
    expect(calls).toHaveLength(1)
  })

  it('shares one budget between the primary model and the fallback', async () => {
    stubFetch((call) =>
      JSON.parse(call.body ?? '{}').model === 'missing/model'
        ? fakeResponse(404, JSON.stringify({ error: { message: 'No endpoints found' } }))
        : fakeResponse(200, JSON.stringify({ choices: [{ message: { content: 'fallback answer' } }] })),
    )
    // Each attempt burns 30 s of a 40 s budget, so only the first fits.
    let used = 0
    const deadline: Deadline = {
      budgetMs: 40_000,
      remainingMs: () => Math.max(0, 40_000 - used),
      nextAttemptMs: (desiredMs) => {
        used += 30_000
        const timeout = Math.min(desiredMs, Math.max(0, 40_000 - used))
        return timeout >= 1_500 ? timeout : null
      },
      canAttempt: () => 40_000 - used >= 1_500,
    }
    await expect(
      completeWithFallback(config({ model: 'missing/model', fallbackModel: 'openai/gpt-4.1-mini' }), [{ role: 'user', content: 'hi' }], { deadline }),
    ).rejects.toMatchObject({ statusCode: 504, code: 'timeout' })
    expect(calls).toHaveLength(1)
  })
})

function spentDeadline(): Deadline {
  return { budgetMs: 50_000, remainingMs: () => 0, nextAttemptMs: () => null, canAttempt: () => false }
}

function slowProvider(budgetMs: number, attemptMs: number, canAttempt = () => true): Deadline {
  return { budgetMs, remainingMs: () => budgetMs, nextAttemptMs: (desiredMs) => Math.min(desiredMs, attemptMs), canAttempt }
}

describe('resolveAiConfig', () => {
  it('allows anonymous model discovery without an API key', () => {
    const resolved = resolveAiConfig(event({ 'x-tn-provider': 'openrouter', 'x-tn-model': 'openai/gpt-4.1' }), {
      requireModel: false,
      allowAnonymous: true,
    })
    expect(resolved.baseUrl).toBe('https://openrouter.ai/api/v1')
    expect(resolved.apiKey).toBe('')
  })

  it('still requires a key for completion requests', () => {
    expect(() => resolveAiConfig(event({ 'x-tn-provider': 'openrouter', 'x-tn-model': 'openai/gpt-4.1' }))).toThrow(HttpError)
  })

  it('normalizes a pasted endpoint in the base URL header', () => {
    const resolved = resolveAiConfig(
      event({ 'x-tn-provider': 'openrouter', 'x-tn-base-url': 'https://openrouter.ai/api/v1/models', 'x-tn-key': 'k', 'x-tn-model': 'm' }),
    )
    expect(resolved.baseUrl).toBe('https://openrouter.ai/api/v1')
  })
})
