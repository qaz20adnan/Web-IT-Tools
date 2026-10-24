import { describe, expect, it } from 'vitest'
import { runLocalTriage } from '@/services/localTriage'
import type { ProblemInput } from '@/types'

const baseInput: ProblemInput = {
  title: 'Cannot resolve internal hostname',
  description: 'DNS lookups fail for server01 while ping by IP works',
  errorText: '',
  logs: '',
  category: 'networking',
  os: 'Windows 11',
  environment: 'Corporate LAN',
  recentChange: 'VPN client updated',
  experience: 'professional',
  priority: 'high',
}

describe('offline triage', () => {
  it('matches the DNS rule and stays explicitly offline', () => {
    const result = runLocalTriage(baseInput, 'en')
    expect(result.offline).toBe(true)
    expect(result.provider).toBe('Local rules')
    expect(result.model).toBe('deterministic-triage-v1:dns')
    expect(result.category).toBe('networking')
    expect(result.diagnosticSteps.length).toBeGreaterThan(0)
    expect(result.diagnosticSteps.some((step) => step.command?.includes('Resolve-DnsName'))).toBe(true)
    expect(result.sources.length).toBeGreaterThan(0)
    expect(result.confidence.level).toBe('low')
  })

  it('falls back to generic guidance without inventing a diagnosis', () => {
    const result = runLocalTriage(
      { ...baseInput, title: 'Unclassified request', description: 'Something feels slow', recentChange: '' },
      'en',
    )
    expect(result.model).toBe('deterministic-triage-v1')
    expect(result.solutions).toEqual([])
    expect(result.missingInformation.length).toBeGreaterThan(0)
    expect(result.limitations).toBeTruthy()
  })

  it('produces Arabic output when requested', () => {
    const result = runLocalTriage(baseInput, 'ar')
    expect(result.summary).not.toBe(runLocalTriage(baseInput, 'en').summary)
    expect(result.offline).toBe(true)
  })
})
