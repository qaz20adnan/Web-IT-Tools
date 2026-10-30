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
import { HttpError, json, readJsonBody, requireMethod, wrap, type Handler, type NetlifyResponse } from '../lib/http'
import {
  assignableRolesFor,
  canAssignRole,
  canManageRole,
  isRole,
  isStaffRole,
  type Role,
} from '../lib/rbac'
import { authAdminRequest, supabaseCount, supabaseInsert, supabaseSelectAs, supabaseUpdate } from '../lib/supabase'
import {
  createLocalAccountByAdmin,
  deleteLocalAccountByAdmin,
  getLocalAccount,
  listLocalAccounts,
  listLocalAudits,
  countLocalAudits,
  recordLocalAudit,
  resetLocalPasswordByAdmin,
  revokeLocalSessions,
  updateLocalAccount,
} from '../lib/local-auth'
import { localAuthEnabled } from '../lib/local-auth'

interface AuthAdminUser {
  id: string
  last_sign_in_at?: string | null
}

const roleSchema = z.enum([
  'owner',
  'admin',
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
    userId: z.string().trim().min(1).max(120),
    role: roleSchema.optional(),
    status: z.enum(['active', 'suspended']).optional(),
  }),
  z.object({ action: z.literal('users.delete'), userId: z.string().trim().min(1).max(120) }),
  z.object({
    action: z.literal('users.create'),
    username: z.string().trim().min(3).max(40),
    email: z.string().trim().email().max(120),
    password: z.string().min(1).max(1024),
    fullName: z.string().trim().max(120).optional(),
    role: roleSchema,
  }),
  z.object({
    action: z.literal('users.reset_password'),
    userId: z.string().trim().min(1).max(120),
    password: z.string().min(1).max(1024),
  }),
  z.object({ action: z.literal('users.revoke_sessions'), userId: z.string().trim().min(1).max(120) }),
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

async function activeOwners(): Promise<number> {
  return supabaseCount('profiles', `role=eq.owner&status=eq.active`)
}

async function activeSuperAdmins(): Promise<number> {
  return supabaseCount('profiles', `role=eq.super_admin&status=eq.active`)
}

function targetRoleOf(profile: ProfileRow): Role {
  return isRole(profile.role) ? profile.role : 'standard_member'
}

async function loadProfile(userId: string): Promise<ProfileRow> {
  const rows = await supabaseSelectAs<ProfileRow>('profiles', `select=*&id=eq.${encodeURIComponent(userId)}&limit=1`)
  if (!rows[0]) throw new HttpError(404, 'not_found', 'User not found.')
  return rows[0]
}

function assertNotSelf(account: AuthAccount, userId: string, action: string): void {
  if (account.profile.id === userId) throw new HttpError(422, 'invalid_input', `You cannot ${action} your own account.`)
}

async function handleLocalAdminAccount(
  account: AuthAccount,
  body: AdminBody,
): Promise<NetlifyResponse> {
  const recordAudit = async (action: string, targetType: string | null, targetId: string | null, outcome: 'success' | 'failure', detail: Record<string, unknown> | null) => {
    await recordLocalAudit({
      actorId: account.profile.id,
      actorEmail: account.profile.email,
      action,
      targetType,
      targetId,
      outcome,
      detail,
    })
  }

  if (body.action === 'overview') {
    requirePermission(account, 'reports.read')
    const items = await listLocalAccounts()
    const auditItems = await listLocalAudits(1000)
    const suspended = items.filter((entry) => entry.status === 'suspended').length
    const staff = items.filter((entry) => isStaffRole(entry.role)).length
    return json(200, {
      ok: true,
      users: items.length,
      staff,
      suspended,
      openFeedback: 0,
      auditTotal: auditItems.length,
      planCounts: { premium: 0, standard: 0, trial: 0 },
      usageSeries: [],
      recentAudit: auditItems.slice(0, 10),
    })
  }

  if (body.action === 'users.list') {
    requirePermission(account, 'users.read')
    const role = body.role
    const status = body.status
    const term = body.q ? body.q.replace(/[%*,()\\]/g, ' ').trim() : ''
    const entries = await listLocalAccounts()
    const filtered = entries.filter((entry) => {
      if (role && entry.role !== role) return false
      if (status && entry.status !== status) return false
      if (!term) return true
      const needle = term.toLowerCase()
      return (
        entry.email.toLowerCase().includes(needle) ||
        (entry.fullName ?? '').toLowerCase().includes(needle) ||
        entry.username.toLowerCase().includes(needle)
      )
    })
    const limit = body.limit ?? 50
    const offset = body.offset ?? 0
    const items = filtered.slice(offset, offset + limit).map((entry) => ({
      ...entry,
      last_sign_in_at: null,
      manageable: entry.id !== account.profile.id && canManageRole(account.role, entry.role),
    }))
    return json(200, {
      ok: true,
      items,
      total: filtered.length,
      limit,
      offset,
      assignableRoles: assignableRolesFor(account.role),
    })
  }

  if (body.action === 'users.create') {
    requirePermission(account, 'users.update')
    if (body.role !== 'standard_member') requirePermission(account, 'roles.assign')
    const accountRecord = await createLocalAccountByAdmin({
      username: body.username,
      email: body.email,
      password: body.password,
      fullName: body.fullName ?? null,
      role: body.role,
    })
    await recordAudit('admin.user_create', 'local_account', accountRecord.id, 'success', {
      fromRole: 'none',
      toRole: accountRecord.role,
      email: accountRecord.email,
    })
    return json(200, { ok: true, item: accountRecord })
  }

  if (body.action === 'users.update') {
    if (body.role) requirePermission(account, 'roles.assign')
    if (body.status) requirePermission(account, 'users.suspend')
    if (!body.role && !body.status) throw new HttpError(400, 'invalid_input', 'Nothing to update.')
    if (account.profile.id === body.userId) {
      throw new HttpError(422, 'invalid_input', `You cannot ${body.status === 'suspended' ? 'suspend' : 'change the role of'} your own account.`)
    }
    const target = await getLocalAccount(body.userId)
    if (!target) throw new HttpError(404, 'not_found', 'User not found.')
    const manageableTarget = canManageRole(account.role, target.role)
    if (!manageableTarget) {
      throw new HttpError(403, 'forbidden', 'You cannot modify an account with an equal or higher role.')
    }
    if (body.role && !canAssignRole(account.role, body.role)) {
      throw new HttpError(403, 'forbidden', 'You cannot grant or revoke that role.')
    }
    const protectedRoles: Role[] = [target.role === 'owner' ? 'owner' : 'super_admin']
    const updated = await updateLocalAccount(
      body.userId,
      { role: body.role, status: body.status },
      { protectActiveRoles: protectedRoles },
    )
    await recordAudit('admin.user_update', 'local_account', body.userId, 'success', {
      fromRole: target.role,
      toRole: updated.role,
      fromStatus: target.status,
      toStatus: updated.status,
    })
    return json(200, { ok: true, item: updated })
  }

  if (body.action === 'users.reset_password') {
    requirePermission(account, 'users.update')
    const updated = await getLocalAccount(body.userId)
    if (!updated) throw new HttpError(404, 'not_found', 'User not found.')
    if (canManageRole(account.role, updated.role) || account.role === 'owner') {
      await resetLocalPasswordByAdmin(body.userId, body.password)
      await recordAudit('admin.user_password_reset', 'local_account', body.userId, 'success', { email: updated.email })
      return json(200, { ok: true })
    }
    throw new HttpError(403, 'forbidden', 'You cannot reset the password of an equal or higher role.')
  }

  if (body.action === 'users.revoke_sessions') {
    requirePermission(account, 'users.update')
    const updated = await getLocalAccount(body.userId)
    if (!updated) throw new HttpError(404, 'not_found', 'User not found.')
    if (canManageRole(account.role, updated.role) || account.role === 'owner') {
      const removed = await revokeLocalSessions(body.userId)
      await recordAudit('admin.user_sessions_revoke', 'local_account', body.userId, 'success', { removed })
      return json(200, { ok: true, removed })
    }
    throw new HttpError(403, 'forbidden', 'You cannot manage an account with an equal or higher role.')
  }

  if (body.action === 'users.delete') {
    requirePermission(account, 'users.delete')
    if (account.profile.id === body.userId) {
      throw new HttpError(422, 'invalid_input', 'You cannot delete your own account.')
    }
    const target = await getLocalAccount(body.userId)
    if (!target) throw new HttpError(404, 'not_found', 'User not found.')
    const manageableTarget = canManageRole(account.role, target.role)
    if (!manageableTarget) {
      throw new HttpError(403, 'forbidden', 'You cannot delete an account with an equal or higher role.')
    }
    const protectedRoles: Role[] = [target.role === 'owner' ? 'owner' : 'super_admin']
    await deleteLocalAccountByAdmin(body.userId, { protectActiveRoles: protectedRoles })
    await recordAudit('admin.user_delete', 'local_account', body.userId, 'success', { email: target.email, role: target.role })
    return json(200, { ok: true, deleted: true })
  }

  if (body.action === 'audit.list') {
    requirePermission(account, 'audit_logs.read')
    const limit = body.limit ?? 50
    const offset = body.offset ?? 0
    const items = await listLocalAudits(limit, offset)
    const total = await countLocalAudits()
    return json(200, { ok: true, items, total, limit, offset })
  }

  throw new HttpError(400, 'invalid_input', 'Administrative actions are unavailable in local development mode.')
}

export const handler: Handler = wrap(async (event) => {
  requireMethod(event, ['POST'])
  const account = await authenticate(event)
  const parsed = actionSchema.safeParse(readJsonBody<AdminBody>(event, 256 * 1024))
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  const body = parsed.data

  if (localAuthEnabled()) {
    return handleLocalAdminAccount(account, body)
  }

  if (body.action === 'overview') {
    requirePermission(account, 'reports.read')
    const [users, staff, suspended, openFeedback, plans, recentAudit, auditTotal, usage7d] = await Promise.all([
      supabaseCount('profiles'),
      supabaseCount('profiles', `role=in.(${['owner', 'admin', 'super_admin', 'content_manager', 'technical_editor', 'support_specialist'].join(',')})`),
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
    const [rows, total] = await Promise.all([
      supabaseSelectAs<ProfileRow>('profiles', query),
      supabaseCount('profiles', filters.join('&')),
    ])
    // Best-effort enrichment with the last sign-in timestamp from Supabase Auth.
    const lastSignIn = new Map<string, string | null>()
    try {
      const authUsers = await authAdminRequest<{ users?: AuthAdminUser[] }>('/users?per_page=1000&page=1')
      for (const entry of authUsers.users ?? []) lastSignIn.set(entry.id, entry.last_sign_in_at ?? null)
    } catch {
      /* The profile list remains usable when the auth admin API is unavailable. */
    }
    const items = rows.map((row) => {
      const role = targetRoleOf(row)
      return {
        ...row,
        role,
        last_sign_in_at: lastSignIn.get(row.id) ?? null,
        manageable: row.id !== account.profile.id && canManageRole(account.role, role),
      }
    })
    return json(200, {
      ok: true,
      items,
      total,
      limit,
      offset,
      assignableRoles: assignableRolesFor(account.role),
    })
  }

  if (body.action === 'users.update') {
    if (body.role) requirePermission(account, 'roles.assign')
    if (body.status) requirePermission(account, 'users.suspend')
    if (!body.role && !body.status) throw new HttpError(400, 'invalid_input', 'Nothing to update.')
    assertNotSelf(account, body.userId, body.status === 'suspended' ? 'suspend' : 'change the role of')
    const target = await loadProfile(body.userId)
    const targetRole = targetRoleOf(target)

    if (body.role && !canAssignRole(account.role, body.role)) {
      throw new HttpError(403, 'forbidden', 'You cannot grant or revoke that role.')
    }
    if (!canManageRole(account.role, targetRole)) {
      throw new HttpError(403, 'forbidden', 'You cannot modify an account with an equal or higher role.')
    }

    const removesOwner =
      targetRole === 'owner' &&
      target.status === 'active' &&
      ((body.role !== undefined && body.role !== 'owner') || body.status === 'suspended')
    const removesSuperAdmin =
      targetRole === 'super_admin' &&
      target.status === 'active' &&
      ((body.role !== undefined && body.role !== 'super_admin') || body.status === 'suspended')

    if (removesOwner && (await activeOwners()) <= 1) {
      throw new HttpError(422, 'invalid_input', 'The last active platform owner cannot be demoted or suspended.')
    }
    if (removesSuperAdmin && (await activeSuperAdmins()) <= 1) {
      throw new HttpError(422, 'invalid_input', 'The last active super administrator cannot be demoted or suspended.')
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (body.role) patch.role = body.role
    if (body.status) patch.status = body.status
    const updated = await supabaseUpdate<ProfileRow>('profiles', `id=eq.${encodeURIComponent(body.userId)}`, patch)

    if ((removesOwner && (await activeOwners()) === 0) || (removesSuperAdmin && (await activeSuperAdmins()) === 0)) {
      await supabaseUpdate<ProfileRow>('profiles', `id=eq.${encodeURIComponent(body.userId)}`, {
        role: target.role,
        status: target.status,
        updated_at: new Date().toISOString(),
      })
      throw new HttpError(422, 'invalid_input', 'The last active privileged account cannot be demoted or suspended.')
    }
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
    const targetRole = targetRoleOf(target)
    if (!canManageRole(account.role, targetRole)) {
      throw new HttpError(403, 'forbidden', 'You cannot delete an account with an equal or higher role.')
    }
    if (targetRole === 'owner' && target.status === 'active') {
      const owners = await activeOwners()
      if (owners <= 1) throw new HttpError(422, 'invalid_input', 'The last active platform owner cannot be deleted.')
    }
    if (targetRole === 'super_admin' && target.status === 'active') {
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
