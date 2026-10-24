import { HttpError } from './http'

export type PlanId = 'trial' | 'premium' | 'standard' | 'suspended'

export type FeatureKey = 'ai' | 'vision' | 'workspace' | 'research' | 'exports' | 'admin'

export interface Entitlements {
  plan: PlanId
  features: Record<FeatureKey, boolean>
  /** Daily AI request cap on the platform provider key. 0 disables server-key AI. */
  dailyAiLimit: number
  /** Maximum saved private records for the account. */
  workspaceItemLimit: number
}

export interface TrialState {
  startedAt: string
  endsAt: string
  daysTotal: number
  daysRemaining: number
  hoursRemaining: number
  expired: boolean
  endingSoon: boolean
}

export interface SubscriptionRecord {
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'expired'
  planId: string
  provider: string
  currentPeriodEnd: string | null
}

const DAY_MS = 86_400_000

export function addDays(iso: string, days: number): string {
  const start = Date.parse(iso)
  if (Number.isNaN(start)) throw new HttpError(500, 'unknown', 'Invalid trial start time stored in the database.')
  return new Date(start + days * DAY_MS).toISOString()
}

export function computeTrial(startedAt: string, daysTotal: number, now = Date.now()): TrialState {
  const start = Date.parse(startedAt)
  if (Number.isNaN(start)) throw new HttpError(500, 'unknown', 'Invalid trial start time stored in the database.')
  const requested = Number.isFinite(daysTotal) ? Math.floor(daysTotal) : 1
  const total = Math.max(1, Math.min(365, requested))
  const endsAt = new Date(start + total * DAY_MS).toISOString()
  const end = Date.parse(endsAt)
  const remainingMs = Math.max(0, end - now)
  return {
    startedAt: new Date(start).toISOString(),
    endsAt,
    daysTotal: total,
    daysRemaining: Math.ceil(remainingMs / DAY_MS),
    hoursRemaining: Math.ceil(remainingMs / 3_600_000),
    expired: remainingMs <= 0,
    endingSoon: remainingMs > 0 && remainingMs <= 3 * DAY_MS,
  }
}

export function subscriptionIsActive(subscription: SubscriptionRecord | null, now = Date.now()): boolean {
  if (!subscription) return false
  if (subscription.status !== 'active' && subscription.status !== 'trialing') return false
  if (!subscription.currentPeriodEnd) return true
  const end = Date.parse(subscription.currentPeriodEnd)
  return !Number.isNaN(end) && end > now
}

const PREMIUM_ENTITLEMENTS: Entitlements = {
  plan: 'premium',
  features: { ai: true, vision: true, workspace: true, research: true, exports: true, admin: false },
  dailyAiLimit: 1000,
  workspaceItemLimit: 2000,
}

const TRIAL_ENTITLEMENTS: Entitlements = {
  plan: 'trial',
  features: { ai: true, vision: true, workspace: true, research: true, exports: true, admin: false },
  dailyAiLimit: 100,
  workspaceItemLimit: 500,
}

const STANDARD_ENTITLEMENTS: Entitlements = {
  plan: 'standard',
  features: { ai: false, vision: false, workspace: true, research: true, exports: true, admin: false },
  dailyAiLimit: 0,
  workspaceItemLimit: 100,
}

const SUSPENDED_ENTITLEMENTS: Entitlements = {
  plan: 'suspended',
  features: { ai: false, vision: false, workspace: false, research: false, exports: false, admin: false },
  dailyAiLimit: 0,
  workspaceItemLimit: 0,
}

/**
 * Resolves what an account may actually use. The result is always computed on
 * the server; the browser only renders it.
 */
export function resolveEntitlements(input: {
  status: 'active' | 'suspended' | 'pending'
  subscription: SubscriptionRecord | null
  trial: TrialState | null
  isStaff: boolean
  now?: number
}): Entitlements {
  const now = input.now ?? Date.now()
  if (input.status === 'suspended') return { ...SUSPENDED_ENTITLEMENTS, features: { ...SUSPENDED_ENTITLEMENTS.features } }
  if (input.isStaff) return { ...PREMIUM_ENTITLEMENTS, features: { ...PREMIUM_ENTITLEMENTS.features, admin: true } }
  if (subscriptionIsActive(input.subscription, now)) {
    return { ...PREMIUM_ENTITLEMENTS, features: { ...PREMIUM_ENTITLEMENTS.features } }
  }
  if (input.trial && !input.trial.expired) {
    return { ...TRIAL_ENTITLEMENTS, features: { ...TRIAL_ENTITLEMENTS.features } }
  }
  return { ...STANDARD_ENTITLEMENTS, features: { ...STANDARD_ENTITLEMENTS.features } }
}

export function featureAllowed(entitlements: Entitlements, feature: FeatureKey): boolean {
  return Boolean(entitlements.features[feature])
}

/**
 * Race-safe daily quota check, evaluated against provider-reported usage rows.
 * Never invents costs; it only counts requests recorded by the server.
 */
export function quotaExceeded(usageToday: number, limit: number): { exceeded: boolean; remaining: number } {
  if (!Number.isFinite(limit) || limit <= 0) return { exceeded: true, remaining: 0 }
  const used = Number.isFinite(usageToday) ? Math.max(0, Math.floor(usageToday)) : 0
  return { exceeded: used >= limit, remaining: Math.max(0, limit - used) }
}
