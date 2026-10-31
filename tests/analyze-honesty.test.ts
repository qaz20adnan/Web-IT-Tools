import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The analysis path has no search tool. These tests pin the honesty contract:
 * the model is told nothing was searched, and the handler labels whatever URLs
 * come back as unverified before the browser ever sees them. The connectivity
 * test pins that an unproven key is reported as unproven.
 */

vi.mock('../netlify/lib/auth', () => ({
  enforceAiAccess: vi.fn(async () => ({ profile: { id: 'user-1' } })),
  recordAiUsage: vi.fn(async () => undefined),
  requireMember: vi.fn(async () => ({ profile: { id: 'user-1' } })),
  usesClientProviderKey: vi.fn(() => false),
}))

const modelPayload = {
  summary: 'The print spooler restarts after the driver package fails to load.',
  category: 'windows-server',
  symptoms: ['spooler stops', 'printer disappears'],
  causes: [{ cause: 'Faulty driver package', likelihood: 'high', evidence: ['Application log shows the faulting module'] }],
  evidence: [{ statement: 'Event 1000 names the spooler process', type: 'fact' }],
  diagnosticSteps: [{ order: 1, title: 'Check the spooler', detail: 'Run Get-Service spooler and read its status.', kind: 'diagnostic', risk: 'none' }],
  solutions: [{ order: 1, title: 'Reinstall the driver', detail: 'Remove the printer package, then reinstall the vendor driver.', kind: 'change', risk: 'low' }],
  prerequisites: ['Local administrator on the affected host'],
  risks: ['Printers are unavailable while the spooler restarts'],
  rollback: 'Restore the previous driver package from the vendor installer.',
  missingInformation: ['Which driver version is installed'],
  sources: [
    { title: 'Printer issues on Windows', url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-server/printer-issues', publisher: 'Microsoft', retrievedAt: '2024-01-15T00:00:00Z' },
    { title: 'A remembered forum thread', url: 'https://example.com/forum/thread' },
  ],
  confidence: { level: 'medium', reason: 'Based on the supplied logs only.' },
  limitations: '',
}

vi.mock('../netlify/lib/ai', () => ({
  resolveAiConfig: vi.fn(() => ({
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    fallbackModel: '',
    apiKey: 'server-key',
  })),
  completeWithFallback: vi.fn(async () => ({ content: '', model: 'openai/gpt-4.1-mini', fallbackUsed: false })),
  chatComplete: vi.fn(async () => 'OK'),
  listModels: vi.fn(async () => [{ id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini', contextLength: null }]),
  verifyProviderAuth: vi.fn(async () => ({ latencyMs: 12, keyVerified: false, reason: 'public_catalog', note: 'public catalog' })),
}))

import { handler as analyzeHandler } from '../netlify/functions/ai-analyze'
import { handler as testHandler } from '../netlify/functions/ai-test'
import { completeWithFallback, verifyProviderAuth } from '../netlify/lib/ai'
import type { NetlifyEvent } from '../netlify/lib/http'

const complete = vi.mocked(completeWithFallback)
const verify = vi.mocked(verifyProviderAuth)

function event(path: string, body: unknown, ip: string): NetlifyEvent {
  return {
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, authorization: 'Bearer session-token' },
    body: JSON.stringify(body),
    path,
  }
}

function analyzeEvent(ip: string): NetlifyEvent {
  return event('/api/ai/analyze', { input: { title: 'Spooler crashes', description: 'The print spooler stops every morning on the 2022 host.' } }, ip)
}

beforeEach(() => {
  complete.mockImplementation(async () => ({ content: JSON.stringify(modelPayload), model: 'openai/gpt-4.1-mini', fallbackUsed: false }))
  verify.mockResolvedValue({ latencyMs: 12, keyVerified: false, reason: 'public_catalog', note: 'public catalog' })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('/api/ai/analyze source labelling', () => {
  it('tells the model that nothing on this request was searched', async () => {
    await analyzeHandler(analyzeEvent('203.0.113.21'), {})
    const prompt = complete.mock.calls[0][1].map((message) => message.content).join('\n')
    expect(prompt).toMatch(/recalled from your own knowledge/i)
    expect(prompt).toMatch(/never fabricate URLs/i)
  })

  it('marks every recalled source as unverified and drops the invented retrieval date', async () => {
    const response = await analyzeHandler(analyzeEvent('203.0.113.22'), {})
    const body = JSON.parse(response.body ?? '{}')
    expect(body.sources).toHaveLength(2)
    expect(body.sources[0]).toEqual({
      title: 'Printer issues on Windows',
      url: 'https://learn.microsoft.com/en-us/troubleshoot/windows-server/printer-issues',
      publisher: 'Microsoft',
      verified: false,
    })
    expect(body.sources.every((source: { verified: boolean }) => source.verified === false)).toBe(true)
    expect(response.body).not.toMatch(/retrievedAt/)
  })

  it('fills the default limitation text when the model leaves it empty', async () => {
    const response = await analyzeHandler(analyzeEvent('203.0.113.23'), {})
    expect(JSON.parse(response.body ?? '{}').limitations).toMatch(/Verify against vendor documentation/)
  })
})

describe('/api/ai/test connectivity payload', () => {
  it('reports a reachable endpoint whose key was never proven', async () => {
    const response = await testHandler(event('/api/ai/test', { mode: 'connectivity' }, '203.0.113.24'), {})
    const body = JSON.parse(response.body ?? '{}')
    expect(response.statusCode).toBe(200)
    expect(body.keyVerified).toBe(false)
    expect(body.unverifiedReason).toBe('public_catalog')
    expect(body.note).toBe('public catalog')
    expect(body.modelAvailable).toBe(true)
  })

  it('omits the unverified fields when the key is proven', async () => {
    verify.mockResolvedValue({ latencyMs: 5, keyVerified: true })
    const response = await testHandler(event('/api/ai/test', { mode: 'connectivity' }, '203.0.113.25'), {})
    const body = JSON.parse(response.body ?? '{}')
    expect(body.keyVerified).toBe(true)
    expect(body.unverifiedReason).toBeUndefined()
    expect(body.note).toBeUndefined()
  })
})
