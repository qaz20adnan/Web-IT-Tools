import { describe, expect, it } from 'vitest'
import {
  addDays,
  computeTrial,
  featureAllowed,
  quotaExceeded,
  resolveEntitlements,
  subscriptionIsActive,
  type SubscriptionRecord,
} from '../netlify/lib/trial'

const START = '2026-01-01T00:00:00.000Z'
const NOW = Date.parse('2026-01-10T00:00:00.000Z')

function subscription(overrides: Partial<SubscriptionRecord> = {}): SubscriptionRecord {
  return { status: 'active', planId: 'premium', provider: 'manual', currentPeriodEnd: null, ...overrides }
}

describe('trial computation', () => {
  it('adds exact calendar days without drifting', () => {
    expect(addDays(START, 30)).toBe('2026-01-31T00:00:00.000Z')
  })

  it('reports remaining days, hours and expiry', () => {
    const trial = computeTrial(START, 30, NOW)
    expect(trial.daysTotal).toBe(30)
    expect(trial.daysRemaining).toBe(21)
    expect(trial.expired).toBe(false)
    expect(trial.endingSoon).toBe(false)
  })

  it('clamps the trial length to a safe range', () => {
    expect(computeTrial(START, 0, NOW).daysTotal).toBe(1)
    expect(computeTrial(START, 10_000, NOW).daysTotal).toBe(365)
  })

  it('marks a trial as expiring soon and then expired', () => {
    const soon = computeTrial(START, 10, Date.parse('2026-01-08T12:00:00.000Z'))
    expect(soon.endingSoon).toBe(true)
    expect(soon.daysRemaining).toBe(3)

    const expired = computeTrial(START, 10, Date.parse('2026-01-11T00:00:00.000Z'))
    expect(expired.expired).toBe(true)
    expect(expired.daysRemaining).toBe(0)
  })

  it('rejects an invalid stored start time', () => {
    expect(() => computeTrial('not-a-date', 30, NOW)).toThrow()
  })
})

describe('subscriptions and entitlements', () => {
  it('accepts active and trialing subscriptions before their period end', () => {
    expect(subscriptionIsActive(subscription(), NOW)).toBe(true)
    expect(subscriptionIsActive(subscription({ status: 'trialing' }), NOW)).toBe(true)
    expect(subscriptionIsActive(subscription({ currentPeriodEnd: '2026-02-01T00:00:00.000Z' }), NOW)).toBe(true)
    expect(subscriptionIsActive(subscription({ currentPeriodEnd: '2026-01-01T00:00:00.000Z' }), NOW)).toBe(false)
    expect(subscriptionIsActive(subscription({ status: 'canceled' }), NOW)).toBe(false)
    expect(subscriptionIsActive(null, NOW)).toBe(false)
  })

  it('gives an active trial AI access and a 100 request quota', () => {
    const entitlements = resolveEntitlements({
      status: 'active',
      subscription: null,
      trial: computeTrial(START, 30, NOW),
      isStaff: false,
      now: NOW,
    })
    expect(entitlements.plan).toBe('trial')
    expect(featureAllowed(entitlements, 'ai')).toBe(true)
    expect(entitlements.dailyAiLimit).toBe(100)
    expect(entitlements.workspaceItemLimit).toBe(500)
  })

  it('drops AI access after the trial and keeps the standard workspace', () => {
    const entitlements = resolveEntitlements({
      status: 'active',
      subscription: null,
      trial: computeTrial(START, 10, Date.parse('2026-02-01T00:00:00.000Z')),
      isStaff: false,
    })
    expect(entitlements.plan).toBe('standard')
    expect(featureAllowed(entitlements, 'ai')).toBe(false)
    expect(featureAllowed(entitlements, 'workspace')).toBe(true)
    expect(entitlements.dailyAiLimit).toBe(0)
    expect(entitlements.workspaceItemLimit).toBe(100)
  })

  it('gives an active paid subscription premium limits', () => {
    const entitlements = resolveEntitlements({
      status: 'active',
      subscription: subscription(),
      trial: null,
      isStaff: false,
      now: NOW,
    })
    expect(entitlements.plan).toBe('premium')
    expect(entitlements.dailyAiLimit).toBe(1000)
    expect(entitlements.workspaceItemLimit).toBe(2000)
  })

  it('gives staff admin access even without a subscription', () => {
    const entitlements = resolveEntitlements({ status: 'active', subscription: null, trial: null, isStaff: true })
    expect(entitlements.plan).toBe('premium')
    expect(featureAllowed(entitlements, 'admin')).toBe(true)
  })

  it('removes every feature for a suspended account', () => {
    const entitlements = resolveEntitlements({
      status: 'suspended',
      subscription: subscription(),
      trial: computeTrial(START, 30, NOW),
      isStaff: true,
    })
    expect(entitlements.plan).toBe('suspended')
    expect(Object.values(entitlements.features).every((value) => value === false)).toBe(true)
    expect(entitlements.dailyAiLimit).toBe(0)
    expect(entitlements.workspaceItemLimit).toBe(0)
  })
})

describe('quota accounting', () => {
  it('counts down and blocks at the limit', () => {
    expect(quotaExceeded(0, 100)).toEqual({ exceeded: false, remaining: 100 })
    expect(quotaExceeded(99, 100)).toEqual({ exceeded: false, remaining: 1 })
    expect(quotaExceeded(100, 100)).toEqual({ exceeded: true, remaining: 0 })
    expect(quotaExceeded(150, 100)).toEqual({ exceeded: true, remaining: 0 })
  })

  it('treats a zero or negative limit as disabled', () => {
    expect(quotaExceeded(0, 0).exceeded).toBe(true)
    expect(quotaExceeded(0, -5).exceeded).toBe(true)
  })

  it('normalizes invalid usage instead of inventing a negative count', () => {
    expect(quotaExceeded(Number.NaN, 10).remaining).toBe(10)
    expect(quotaExceeded(-5, 10).remaining).toBe(10)
  })
})
