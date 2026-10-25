import { createHmac } from 'node:crypto'
import { serverConfig } from './env'
import { HttpError, header, type NetlifyEvent } from './http'
import { permissionsFor, isRole, isStaffRole, type Permission, type Role } from './rbac'
import {
  authUserVerified,
  authUser,
  supabaseAdminConfigured,
  supabaseCount,
  supabaseInsert,
  supabaseSelectAs,
  type SupabaseAuthUser,
} from './supabase'
import { computeTrial, quotaExceeded, resolveEntitlements, type Entitlements, type SubscriptionRecord, type TrialState } from './trial'
import { localAccountForAccessToken, localAuthEnabled, type LocalAccountRecord } from './local-auth'

export interface Profile {
  id: string
  email: string
  full_name: string | null
  role: string
  status: 'active' | 'suspended' | 'pending'
  created_at?: string
  updated_at?: string
}

export type AccountStatus = Profile['status']

/** Only active accounts may hold a usable session. */
export function canSignIn(status: AccountStatus): boolean {
  return status === 'active'
}

function assertActive(account: AuthAccount): void {
  if (canSignIn(account.status)) return
  if (account.status === 'suspended') {
    throw new HttpError(403, 'forbidden', 'This account is suspended. Contact an administrator.')
  }
  throw new HttpError(403, 'forbidden', 'This account is pending activation. Contact an administrator.')
}

export interface AuthAccount {
  user: SupabaseAuthUser
  profile: Profile
  role: Role
  status: AccountStatus
  permissions: Permission[]
  entitlements: Entitlements
  trial: TrialState | null
  subscription: SubscriptionRecord | null
  usageToday: number
  emailVerified: boolean
}

export interface PublicProfile {
  id: string
  email: string
  fullName: string | null
  role: Role
  status: AccountStatus
  createdAt: string | null
  emailVerified: boolean
}

export interface AccountPayload {
  configured: boolean
  databaseConfigured: boolean
  adminConfigured: boolean
  ownerConfigured: boolean
  profile: PublicProfile | null
  permissions: Permission[]
  entitlements: Entitlements | null
  trial: TrialState | null
  subscription: SubscriptionRecord | null
  usageToday: number
  trialDays: number
}

interface SettingRow {
  key: string
  value: unknown
  updated_at?: string
  updated_by?: string | null
}

interface TrialRow {
  user_id: string
  started_at: string
  ends_at: string
}

interface SubscriptionRow {
  user_id: string
  plan_id: string
  status: SubscriptionRecord['status']
  provider: string
  current_period_end: string | null
}

interface ClaimRow {
  email_hash: string
  first_user_id: string
  created_at: string
}

const settingsCache = new Map<string, { value: unknown; expires: number }>()

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? '').trim().toLowerCase()
}

export function emailHash(email: string): string {
  const pepper = serverConfig.hashPepper || serverConfig.supabaseUrl || 'nexora-local-pepper'
  return createHmac('sha256', pepper).update(normalizeEmail(email)).digest('hex')
}

export function bearer(event: NetlifyEvent): string | null {
  const raw = header(event, 'authorization') ?? ''
  const match = raw.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

export function authNotConfigured(): HttpError {
  return new HttpError(
    503,
    'not_configured',
    'Authentication and the database are not configured. Set SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY on the server, then apply the migration.',
  )
}

export function assertAuthBackend(): void {
  if (!serverConfig.supabaseUrl || !serverConfig.supabaseAnonKey || !serverConfig.supabaseServiceRoleKey) {
    throw authNotConfigured()
  }
}

export async function getPlatformSetting<T>(key: string, fallback: T): Promise<T> {
  const cached = settingsCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.value as T
  try {
    const rows = await supabaseSelectAs<SettingRow>('platform_settings', `select=key,value&key=eq.${encodeURIComponent(key)}&limit=1`)
    const value = (rows[0]?.value as T | undefined) ?? fallback
    settingsCache.set(key, { value, expires: Date.now() + 60_000 })
    return value
  } catch {
    return fallback
  }
}

export async function setPlatformSetting(key: string, value: unknown, actorId: string | null): Promise<void> {
  await supabaseInsert<Record<string, unknown>>(
    'platform_settings',
    [{ key, value, updated_at: new Date().toISOString(), updated_by: actorId }],
    'key',
  )
  settingsCache.delete(key)
}

export async function trialDays(): Promise<number> {
  const stored = await getPlatformSetting<number>('trial_days', serverConfig.trialDays)
  const days = Number(stored)
  return Number.isFinite(days) && days >= 1 && days <= 365 ? Math.floor(days) : serverConfig.trialDays
}

async function ensureProfile(user: SupabaseAuthUser): Promise<Profile> {
  const email = normalizeEmail(user.email)
  const existing = await supabaseSelectAs<Profile>('profiles', `select=*&id=eq.${encodeURIComponent(user.id)}&limit=1`)
  let profile = existing[0]
  if (!profile) {
    const fullName =
      typeof user.user_metadata?.full_name === 'string' ? (user.user_metadata.full_name as string).slice(0, 120) : null
    await supabaseInsert<Record<string, unknown>>(
      'profiles',
      [{ id: user.id, email, full_name: fullName, role: 'standard_member', status: 'active' }],
      'id',
      true,
    )
    const rows = await supabaseSelectAs<Profile>('profiles', `select=*&id=eq.${encodeURIComponent(user.id)}&limit=1`)
    profile = rows[0]
    if (!profile) throw new HttpError(500, 'unknown', 'The user profile could not be created.')
  }
  return profile
}

async function ensureTrial(profile: Profile): Promise<TrialRow | null> {
  const existing = await supabaseSelectAs<TrialRow>('trials', `select=*&user_id=eq.${encodeURIComponent(profile.id)}&limit=1`)
  if (existing[0]) return existing[0]

  const days = await trialDays()
  const email = normalizeEmail(profile.email)
  if (!email) return null
  const hash = emailHash(email)
  const claims = await supabaseSelectAs<ClaimRow>('trial_claims', `select=*&email_hash=eq.${encodeURIComponent(hash)}&limit=1`)
  let startedAt: string

  if (claims[0]) {
    if (claims[0].first_user_id !== profile.id) return null
    startedAt = claims[0].created_at
  } else {
    const inserted = await supabaseInsert<ClaimRow>(
      'trial_claims',
      [{ email_hash: hash, first_user_id: profile.id, created_at: new Date().toISOString() }],
      'email_hash',
      true,
    )
    if (inserted.length > 0) {
      startedAt = inserted[0].created_at ?? new Date().toISOString()
    } else {
      const reread = await supabaseSelectAs<ClaimRow>('trial_claims', `select=*&email_hash=eq.${encodeURIComponent(hash)}&limit=1`)
      if (!reread[0] || reread[0].first_user_id !== profile.id) return null
      startedAt = reread[0].created_at
    }
  }

  if (!startedAt) return null
  const endsAt = new Date(Date.parse(startedAt) + days * 86_400_000).toISOString()
  const rows = await supabaseInsert<TrialRow>(
    'trials',
    [{ user_id: profile.id, started_at: startedAt, ends_at: endsAt }],
    'user_id',
    true,
  )
  if (rows[0]) return rows[0]
  const reread = await supabaseSelectAs<TrialRow>('trials', `select=*&user_id=eq.${encodeURIComponent(profile.id)}&limit=1`)
  return reread[0] ?? null
}

async function loadSubscription(userId: string): Promise<SubscriptionRecord | null> {
  const rows = await supabaseSelectAs<SubscriptionRow>(
    'subscriptions',
    `select=*&user_id=eq.${encodeURIComponent(userId)}&limit=1`,
  )
  const row = rows[0]
  if (!row) return null
  return {
    status: row.status,
    planId: row.plan_id,
    provider: row.provider,
    currentPeriodEnd: row.current_period_end,
  }
}

function startOfTodayUtc(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

async function usageToday(userId: string): Promise<number> {
  try {
    return await supabaseCount('usage_events', `user_id=eq.${encodeURIComponent(userId)}&created_at=gte.${encodeURIComponent(startOfTodayUtc())}`)
  } catch {
    return 0
  }
}

export async function accountForUser(user: SupabaseAuthUser): Promise<AuthAccount> {
  assertAuthBackend()
  const profile = await ensureProfile(user)
  const role: Role = isRole(profile.role) ? profile.role : 'standard_member'
  const status: AccountStatus = profile.status === 'suspended' ? 'suspended' : profile.status === 'pending' ? 'pending' : 'active'
  const trialRow = profile.status === 'suspended' ? null : await ensureTrial(profile)
  const subscription = await loadSubscription(profile.id)
  const days = await trialDays()
  const trial = trialRow ? computeTrial(trialRow.started_at, days) : null
  const staff = isStaffRole(role)
  const entitlements = resolveEntitlements({ status, subscription, trial, isStaff: staff })
  const permissions = status === 'suspended' ? [] : permissionsFor(role, status)
  return {
    user,
    profile,
    role,
    status,
    permissions,
    entitlements,
    trial,
    subscription,
    usageToday: await usageToday(profile.id),
    emailVerified: authUserVerified(user),
  }
}

export function localAuthAccount(record: LocalAccountRecord): AuthAccount {
  const role = 'standard_member' as const
  const status = 'active' as const
  const trial = computeTrial(record.createdAt, serverConfig.trialDays)
  return {
    user: {
      id: record.id,
      email: record.email,
      email_confirmed_at: record.createdAt,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      user_metadata: { username: record.username, full_name: record.fullName },
    },
    profile: {
      id: record.id,
      email: record.email,
      full_name: record.fullName,
      role,
      status,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    },
    role,
    status,
    permissions: permissionsFor(role, status),
    entitlements: resolveEntitlements({ status, subscription: null, trial, isStaff: false }),
    trial,
    subscription: null,
    usageToday: 0,
    emailVerified: true,
  }
}

export async function authenticate(event: NetlifyEvent): Promise<AuthAccount> {
  const token = bearer(event)
  if (localAuthEnabled()) {
    if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to continue.')
    const record = await localAccountForAccessToken(token)
    if (!record) throw new HttpError(401, 'unauthorized', 'The local session is invalid or has expired.')
    return localAuthAccount(record)
  }
  assertAuthBackend()
  if (!token) throw new HttpError(401, 'unauthorized', 'Sign in to continue.')
  let user: SupabaseAuthUser
  try {
    user = await authUser(token)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(401, 'unauthorized', 'The session is invalid or has expired.')
  }
  if (!user?.id) throw new HttpError(401, 'unauthorized', 'The session is invalid or has expired.')
  const account = await accountForUser(user)
  assertActive(account)
  return account
}

export function requirePermission(account: AuthAccount, permission: Permission): void {
  if (account.status === 'suspended') {
    throw new HttpError(403, 'forbidden', 'This account is suspended. Contact support.')
  }
  if (!account.permissions.includes(permission)) {
    throw new HttpError(403, 'forbidden', `Your role does not include the "${permission}" permission.`)
  }
}

export function requireVerified(account: AuthAccount): void {
  if (!account.emailVerified) throw new HttpError(403, 'email_not_verified', 'Verify your email address to continue.')
}

/**
 * Authenticated, verified account with at least member access. Used by internal
 * tools (network diagnostics, research, AI) so a valid session is required on
 * the server even when the caller bypasses the UI.
 */
export async function requireMember(event: NetlifyEvent, permission: Permission = 'workspace.read'): Promise<AuthAccount> {
  const account = await authenticate(event)
  requireVerified(account)
  requirePermission(account, permission)
  return account
}

export function publicProfile(account: AuthAccount): PublicProfile {
  return {
    id: account.profile.id,
    email: account.profile.email,
    fullName: account.profile.full_name,
    role: account.role,
    status: account.status,
    createdAt: account.profile.created_at ?? null,
    emailVerified: account.emailVerified,
  }
}

export async function accountPayload(account: AuthAccount): Promise<AccountPayload> {
  return {
    configured: true,
    databaseConfigured: supabaseAdminConfigured(),
    adminConfigured: Boolean(serverConfig.adminEmail),
    ownerConfigured: Boolean(serverConfig.ownerEmail),
    profile: publicProfile(account),
    permissions: account.permissions,
    entitlements: account.entitlements,
    trial: account.trial,
    subscription: account.subscription,
    usageToday: account.usageToday,
    trialDays: await trialDays(),
  }
}

export interface AuditInput {
  actorId: string | null
  actorEmail: string | null
  action: string
  targetType: string
  targetId: string | null
  outcome: 'success' | 'failure' | 'denied'
  detail?: Record<string, unknown>
}

const FORBIDDEN_DETAIL_KEYS = /pass|token|secret|key|authorization|credential|session/i

function sanitizeDetail(detail?: Record<string, unknown>): Record<string, unknown> | null {
  if (!detail) return null
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(detail)) {
    if (FORBIDDEN_DETAIL_KEYS.test(key)) continue
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = typeof value === 'string' ? value.slice(0, 300) : value
    } else if (Array.isArray(value)) {
      safe[key] = value.filter((entry) => typeof entry === 'string' || typeof entry === 'number').slice(0, 20)
    } else if (typeof value === 'object') {
      safe[key] = sanitizeDetail(value as Record<string, unknown>)
    }
  }
  return safe
}

export async function writeAudit(input: AuditInput): Promise<void> {
  if (!supabaseAdminConfigured()) return
  try {
    await supabaseInsert<Record<string, unknown>>('audit_events', [
      {
        actor_id: input.actorId,
        actor_email: input.actorEmail,
        action: input.action,
        target_type: input.targetType,
        target_id: input.targetId,
        outcome: input.outcome,
        detail: sanitizeDetail(input.detail),
        created_at: new Date().toISOString(),
      },
    ])
  } catch (error) {
    // Auditing must never leak request data or break the operation. Log only the
    // error class, never payloads or secrets.
    if (process.env.LOG_LEVEL !== 'silent') console.error(`[nexora] audit_write_failed ${error instanceof Error ? error.name : 'unknown'}`)
  }
}

export async function recordUsage(input: {
  userId: string
  kind: string
  provider: string
  model: string
  tokensIn?: number | null
  tokensOut?: number | null
  costUsd?: number | null
}): Promise<void> {
  try {
    await supabaseInsert<Record<string, unknown>>('usage_events', [
      {
        user_id: input.userId,
        kind: input.kind,
        provider: input.provider,
        model: input.model,
        tokens_in: input.tokensIn ?? null,
        tokens_out: input.tokensOut ?? null,
        cost_usd: input.costUsd ?? null,
        created_at: new Date().toISOString(),
      },
    ])
  } catch {
    if (process.env.LOG_LEVEL !== 'silent') console.error('[nexora] usage_write_failed')
  }
}

/**
 * Enforces AI entitlements and quotas for signed-in users.
 *
 * Guests are rejected. Signed-in users must have the `ai.use` permission; a
 * suspended account is rejected even when it supplies its own provider key.
 */
export async function enforceAiAccess(event: NetlifyEvent): Promise<AuthAccount> {
  if (!bearer(event)) throw new HttpError(401, 'unauthorized', 'Sign in to use the AI assistant.')
  const account = await authenticate(event)
  requireVerified(account)
  requirePermission(account, 'ai.use')
  const usingOwnKey = Boolean(header(event, 'x-tn-key')?.trim())
  if (!usingOwnKey) {
    if (!account.entitlements.features.ai) {
      throw new HttpError(403, 'forbidden', 'AI features are not included in your current plan. Upgrade, start a trial, or connect your own provider key.')
    }
    const quota = quotaExceeded(account.usageToday, account.entitlements.dailyAiLimit)
    if (quota.exceeded) {
      throw new HttpError(429, 'rate_limited', 'Your daily AI quota is exhausted. Try again tomorrow or use your own provider key.')
    }
  }
  return account
}

export async function recordAiUsage(account: AuthAccount | null, kind: string, provider: string, model: string): Promise<void> {
  if (!account) return
  await recordUsage({ userId: account.profile.id, kind, provider, model })
}

export async function countOwned(table: string, userId: string, extra = ''): Promise<number> {
  return supabaseCount(table, `user_id=eq.${encodeURIComponent(userId)}${extra ? `&${extra}` : ''}`)
}
