import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * These endpoints either cost the platform money or read the member's provider
 * configuration, so they must demand the matching permission and bill the call.
 * The auth module is spied here — the permission semantics themselves are
 * covered by tests/rbac.test.ts and tests/access-control.test.ts.
 */

const requireMember = vi.fn(async (_event: unknown, _permission?: string) => ({ profile: { id: 'user-1' } }))
const recordAiUsage = vi.fn(async (_account: unknown, _surface: string, _provider: string, _model: string) => undefined)

vi.mock('../netlify/lib/auth', () => ({
  requireMember: (event: unknown, permission?: string) => requireMember(event, permission),
  recordAiUsage: (account: unknown, surface: string, provider: string, model: string) => recordAiUsage(account, surface, provider, model),
  usesClientProviderKey: (event: { headers: Record<string, string | undefined> }) => Boolean(event.headers['x-tn-key']),
  enforceAiAccess: vi.fn(async () => ({ profile: { id: 'user-1' } })),
}))

vi.mock('../netlify/lib/ai', () => ({
  resolveAiConfig: vi.fn(() => ({
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    fallbackModel: '',
    apiKey: 'server-key',
  })),
  listModels: vi.fn(async () => [{ id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini', contextLength: null }]),
  chatComplete: vi.fn(async () => 'OK'),
  completeWithFallback: vi.fn(async () => ({ content: 'answer', model: 'openai/gpt-4.1-mini', fallbackUsed: false })),
  verifyProviderAuth: vi.fn(async () => ({ latencyMs: 8, keyVerified: true })),
  newDeadline: (budgetMs = 50_000) => ({
    budgetMs,
    remainingMs: () => budgetMs,
    nextAttemptMs: (desiredMs: number) => Math.min(desiredMs, budgetMs),
    canAttempt: () => true,
  }),
}))

import { handler as modelsHandler } from '../netlify/functions/ai-models'
import { handler as researchHandler } from '../netlify/functions/research'
import { handler as testHandler } from '../netlify/functions/ai-test'
import type { NetlifyEvent } from '../netlify/lib/http'

function event(path: string, ip: string, headers: Record<string, string> = {}): NetlifyEvent {
  return {
    httpMethod: path.endsWith('research') ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, authorization: 'Bearer session-token', ...headers },
    body: path.endsWith('research') ? JSON.stringify({ query: 'print spooler crash kb5034441' }) : null,
    path,
  }
}

beforeEach(() => {
  requireMember.mockClear()
  recordAiUsage.mockClear()
  vi.stubEnv('TAVILY_API_KEY', '')
  vi.stubEnv('BRAVE_SEARCH_API_KEY', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('metered AI endpoints demand their own permission', () => {
  it('/api/ai/models asks for ai.use and records the catalog read', async () => {
    expect((await modelsHandler(event('/api/ai/models', '203.0.113.31'), {})).statusCode).toBe(200)
    expect(requireMember.mock.calls[0][1]).toBe('ai.use')
    expect(recordAiUsage.mock.calls[0]?.slice(1)).toEqual(['ai.models', 'openrouter', 'openai/gpt-4.1-mini'])
  })

  it('/api/ai/test asks for ai.use', async () => {
    const response = await testHandler({ ...event('/api/ai/test', '203.0.113.32'), httpMethod: 'POST', body: '{}' }, {})
    expect(response.statusCode).toBe(200)
    expect(requireMember.mock.calls[0][1]).toBe('ai.use')
    expect(recordAiUsage.mock.calls[0]?.slice(1)).toEqual(['ai.test', 'openrouter', 'openai/gpt-4.1-mini'])
  })

  it('/api/research asks for research.read', async () => {
    const response = await researchHandler(event('/api/research', '203.0.113.33'), {})
    expect(response.statusCode).toBe(200)
    expect(requireMember.mock.calls[0][1]).toBe('research.read')
  })

  it('does not charge the platform quota when the member brings their own key', async () => {
    await modelsHandler(event('/api/ai/models', '203.0.113.34', { 'x-tn-key': 'byok' }), {})
    await testHandler({ ...event('/api/ai/test', '203.0.113.35', { 'x-tn-key': 'byok' }), httpMethod: 'POST', body: '{}' }, {})
    expect(requireMember).toHaveBeenCalledTimes(2)
    expect(recordAiUsage).not.toHaveBeenCalled()
  })

  it('leaves research unbilled when no provider is configured', async () => {
    const response = await researchHandler(event('/api/research', '203.0.113.36'), {})
    expect(JSON.parse(response.body ?? '{}').note).toMatch(/No research provider is configured/)
    expect(recordAiUsage).not.toHaveBeenCalled()
  })
})
