import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  authenticate,
  requirePermission,
  setPlatformSetting,
  trialDays,
  writeAudit,
  type AuthAccount,
} from '../lib/auth'
import { HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { isRole, ASSIGNABLE_ROLES, type Role } from '../lib/rbac'
import { authAdminRequest, supabaseCount, supabaseInsert, supabaseSelectAs, supabaseUpdate } from '../lib/supabase'

const roleSchema = z.enum([
  'super_admin',
  'content_manager',
  'technical_editor',
  'support_specialist',
  'premium_member',
  'standard_member',
  'trial_member',
  'suspended_member',
])

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('overview') }),
  z.object({
    action: z.literal('users.list'),
    q: z.string().trim().max(120).optional(),
    role: roleSchema.optional(),
    status: z.enum(['active', 'suspended', 'pending']).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    offset: z.number().int().min(0).max(10000).optional(),
  }),
  z.object({
    action: z.literal('users.update'),
    userId: z.string().uuid(),
    role: roleSchema.optional(),
    status: z.enum(['active', 'suspended']).optional(),
  }),
  z.object({ action: z.literal('users.delete'), userId: z.string().uuid() }),
  z.object({
    action: z.literal('audit.list'),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).max(100000).optional(),
  }),
  z.object({ action: z.literal('feedback.list') }),
  z.object({ action: z.literal('feedback.resolve'), id: z.string().uuid() }),
  z.object({ action: z.literal('settings.get') }),
  z.object({
    action: z.literal('settings.update'),
    trialDays: z.number().int().min(1).max(365).optional(),
    signupsEnabled: z.boolean().optional(),
    maintenanceMode: z.boolean().optional(),
    announcement: z.string().max(500).optional(),
  }),
  z.object({ action: z.literal('subscriptions.list') }),
  z.object({
    action: z.literal('subscriptions.set'),
    userId: z.string().uuid(),
    planId: z.enum(['premium', 'standard']),
    periodEnd: z.string().datetime().nullable().optional(),
  }),
])

type AdminBody = z.infer<typeof actionSchema>

interface ProfileRow {
  id: string
  email: string
  full_name: string | null
  role: Role
  status: 'active' | 'suspended' | 'pending'
  created_at: string
  updated_at?: string
}

function escapeFilter(value: string): string {
  return value.replace(/[%*,()\\]/g, ' ').trim()
}

async function activeSuperAdmins(): Promise<number> {
  return supabaseCount('profiles', `role=eq.super_admin&status=eq.active`)
}

async function loadProfile(userId: string): Promise<ProfileRow> {
  const rows = await supabaseSelectAs<ProfileRow>('profiles', `select=*&id=eq.${encodeURIComponent(userId)}&limit=1`)
  if (!rows[0]) throw new HttpError(404, 'not_found', 'User not found.')
  return rows[0]
}

function assertNotSelf(account: AuthAccount, userId: string, action: string): void {
  if (account.profile.id === userId) throw new HttpError(422, 'invalid_input', `You cannot ${action} your own account.`)
}

export const handler: Handler = wrap(async (event) => {
  requireMethod(event, ['POST'])
  const account = await authenticate(event)
  const parsed = actionSchema.safeParse(readJsonBody<AdminBody>(event, 256 * 1024))
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  const body = parsed.data

  if (body.action === 'overview') {
    requirePermission(account, 'reports.read')
    const [users, staff, suspended, openFeedback, plans, recentAudit, auditTotal, usage7d] = await Promise.all([
      supabaseCount('profiles'),
      supabaseCount('profiles', `role=in.(${['super_admin', 'content_manager', 'technical_editor', 'support_specialist'].join(',')})`),
      supabaseCount('profiles', 'status=eq.suspended'),
      supabaseCount('content_feedback', 'status=eq.open'),
      supabaseSelectAs<Record<string, unknown>>('subscriptions', 'select=plan_id,status,current_period_end&limit=1000'),
      supabaseSelectAs<Record<string, unknown>>('audit_events', 'select=*&order=created_at.desc&limit=10'),
      supabaseCount('audit_events'),
      supabaseSelectAs<Record<string, unknown>>('usage_events', `select=kind,created_at&created_at=gte.${encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString())}&limit=5000`),
    ])
    const planCounts: Record<string, number> = { premium: 0, standard: 0, trial: 0 }
    for (const row of plans) {
      const plan = String(row.plan_id ?? 'standard')
      const status = String(row.status ?? '')
      if (status === 'active' || status === 'trialing') planCounts[plan] = (planCounts[plan] ?? 0) + 1
    }
    const usageByDay: Record<string, number> = {}
    for (const row of usage7d) {
      const day = String(row.created_at ?? '').slice(0, 10)
      if (day) usageByDay[day] = (usageByDay[day] ?? 0) + 1
    }
    const usageSeries = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(Date.now() - (6 - index) * 86_400_000).toISOString().slice(0, 10)
      return { date, requests: usageByDay[date] ?? 0 }
    })
    return json(200, {
      ok: true,
      users,
      staff,
      suspended,
      openFeedback,
      auditTotal,
      planCounts,
      usageSeries,
      recentAudit,
    })
  }

  if (body.action === 'users.list') {
    requirePermission(account, 'users.read')
    const filters: string[] = []
    if (body.role) filters.push(`role=eq.${body.role}`)
    if (body.status) filters.push(`status=eq.${body.status}`)
    const term = body.q ? escapeFilter(body.q) : ''
    if (term) filters.push(`or=(email.ilike.*${encodeURIComponent(term)}*,full_name.ilike.*${encodeURIComponent(term)}*)`)
    const limit = body.limit ?? 50
    const offset = body.offset ?? 0
    const query = `select=*${filters.length ? `&${filters.join('&')}` : ''}&order=created_at.desc&limit=${limit}&offset=${offset}`
    const [items, total] = await Promise.all([
      supabaseSelectAs<ProfileRow>('profiles', query),
      supabaseCount('profiles', filters.filter((entry) => !entry.startsWith('or=')).join('&')),
    ])
    return json(200, { ok: true, items, total, limit, offset })
  }

  if (body.action === 'users.update') {
    if (body.role) requirePermission(account, 'roles.assign')
    if (body.status) requirePermission(account, 'users.suspend')
    if (!body.role && !body.status) throw new HttpError(400, 'invalid_input', 'Nothing to update.')
    assertNotSelf(account, body.userId, body.status === 'suspended' ? 'suspend' : 'change the role of')
    const target = await loadProfile(body.userId)

    if (body.role && !ASSIGNABLE_ROLES.includes(body.role)) {
      throw new HttpError(400, 'invalid_input', 'That role cannot be assigned.')
    }
    if (target.role === 'super_admin' && ((body.role && body.role !== 'super_admin') || body.status === 'suspended')) {
      const admins = await activeSuperAdmins()
      if (admins <= 1) throw new HttpError(422, 'invalid_input', 'The last active super administrator cannot be demoted or suspended.')
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.role) patch.role = body.role
    if (body.status) patch.status = body.status
    const updated = await supabaseUpdate<ProfileRow>('profiles', `id=eq.${encodeURIComponent(body.userId)}`, patch)
    await writeAudit({
      actorId: account.profile.id,
      actorEmail: account.profile.email,
      action: body.role ? 'admin.role_assign' : body.status === 'suspended' ? 'admin.user_suspend' : 'admin.user_reactivate',
      targetType: 'profile',
      targetId: body.userId,
      outcome: 'success',
      detail: { fromRole: target.role, toRole: body.role ?? target.role, fromStatus: target.status, toStatus: body.status ?? target.status },
    })
    return json(200, { ok: true, item: updated[0] ?? null })
  }

  if (body.action === 'users.delete') {
    requirePermission(account, 'users.delete')
    assertNotSelf(account, body.userId, 'delete')
    const target = await loadProfile(body.userId)
    if (target.role === 'super_admin') {
      const admins = await activeSuperAdmins()
      if (admins <= 1) throw new HttpError(422, 'invalid_input', 'The last active super administrator cannot be deleted.')
    }
    await writeAudit({
      actorId: account.profile.id,
      actorEmail: account.profile.email,
      action: 'admin.user_delete',
      targetType: 'profile',
      targetId: body.userId,
      outcome: 'success',
      detail: { email: target.email, role: target.role },
    })
    await authAdminRequest(`/users/${encodeURIComponent(body.userId)}`, { method: 'DELETE' })
    return json(200, { ok: true, deleted: true })
  }

  if (body.action === 'audit.list') {
    requirePermission(account, 'audit_logs.read')
    const limit = body.limit ?? 50
    const offset = body.offset ?? 0
    const rows = await supabaseSelectAs<Record<string, unknown>>(
      'audit_events',
      `select=*&order=created_at.desc&limit=${limit}&offset=${offset}`,
    )
    return json(200, { ok: true, items: rows, limit, offset })
  }

  if (body.action === 'feedback.list') {
    requirePermission(account, 'content.read')
    const rows = await supabaseSelectAs<Record<string, unknown>>(
      'content_feedback',
      'select=*&status=eq.open&order=created_at.desc&limit=100',
    )
    return json(200, { ok: true, items: rows })
  }

  if (body.action === 'feedback.resolve') {
    requirePermission(account, 'content.update')
    const updated = await supabaseUpdate<Record<string, unknown>>('content_feedback', `id=eq.${encodeURIComponent(body.id)}`, {
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_by: account.profile.id,
    })
    if (!updated[0]) throw new HttpError(404, 'not_found', 'Feedback item not found.')
    await writeAudit({
      actorId: account.profile.id,
      actorEmail: account.profile.email,
      action: 'content.feedback_resolve',
      targetType: 'content_feedback',
      targetId: body.id,
      outcome: 'success',
    })
    return json(200, { ok: true, item: updated[0] })
  }

  if (body.action === 'settings.get') {
    requirePermission(account, 'settings.manage')
    const rows = await supabaseSelectAs<Record<string, unknown>>('platform_settings', 'select=key,value,updated_at&order=key.asc')
    return json(200, { ok: true, items: rows, trialDays: await trialDays() })
  }

  if (body.action === 'settings.update') {
    requirePermission(account, 'settings.manage')
    const entries: Array<[string, unknown]> = []
    if (body.trialDays !== undefined) entries.push(['trial_days', body.trialDays])
    if (body.signupsEnabled !== undefined) entries.push(['signups_enabled', body.signupsEnabled])
    if (body.maintenanceMode !== undefined) entries.push(['maintenance_mode', body.maintenanceMode])
    if (body.announcement !== undefined) entries.push(['announcement', body.announcement])
    if (entries.length === 0) throw new HttpError(400, 'invalid_input', 'No settings were provided.')
    for (const [key, value] of entries) {
      await setPlatformSetting(key, value, account.profile.id)
    }
    await writeAudit({
      actorId: account.profile.id,
      actorEmail: account.profile.email,
      action: 'settings.update',
      targetType: 'platform_settings',
      targetId: entries.map(([key]) => key).join(','),
      outcome: 'success',
      detail: { keys: entries.map(([key]) => key) },
    })
    return json(200, { ok: true })
  }

  if (body.action === 'subscriptions.list') {
    requirePermission(account, 'subscriptions.manage')
    const [subscriptions, profiles] = await Promise.all([
      supabaseSelectAs<Record<string, unknown>>('subscriptions', 'select=*&order=updated_at.desc&limit=200'),
      supabaseSelectAs<Record<string, unknown>>('profiles', 'select=id,email,role,status&limit=1000'),
    ])
    const byId = new Map(profiles.map((profile) => [String(profile.id), profile]))
    const items = subscriptions.map((row) => ({
      ...row,
      email: byId.get(String(row.user_id))?.email ?? null,
    }))
    return json(200, { ok: true, items })
  }

  if (body.action === 'subscriptions.set') {
    requirePermission(account, 'subscriptions.manage')
    const target = await loadProfile(body.userId)
    if (!isRole(target.role)) throw new HttpError(422, 'invalid_input', 'The target account has an invalid role.')
    const periodEnd = body.periodEnd ?? null
    if (periodEnd && Date.parse(periodEnd) <= Date.now()) throw new HttpError(422, 'invalid_input', 'The billing period end must be in the future.')
    const now = new Date().toISOString()
    const rows = await supabaseInsert<Record<string, unknown>>(
      'subscriptions',
      [{
        user_id: body.userId,
        plan_id: body.planId,
        status: 'active',
        provider: 'manual',
        current_period_end: periodEnd,
        updated_at: now,
        created_at: now,
      }],
      'user_id',
    )
    await supabaseInsert<Record<string, unknown>>('billing_events', [
      {
        id: randomUUID(),
        user_id: body.userId,
        type: 'manual.plan_set',
        amount_cents: null,
        currency: null,
        provider: 'manual',
        reference: null,
        metadata: { planId: body.planId, periodEnd, actor: account.profile.id },
        created_at: now,
      },
    ])
    await writeAudit({
      actorId: account.profile.id,
      actorEmail: account.profile.email,
      action: 'subscriptions.manual_set',
      targetType: 'profile',
      targetId: body.userId,
      outcome: 'success',
      detail: { planId: body.planId, periodEnd, targetEmail: target.email },
    })
    return json(200, { ok: true, item: rows[0] ?? null, paymentProvider: 'manual' })
  }

  throw new HttpError(400, 'invalid_input', 'Unknown administrative action.')
})
