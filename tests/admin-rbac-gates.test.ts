import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/api/admin` is the most privileged endpoint on the platform and, until this
 * file, had no test at all. These cases prove the RBAC matrix is what actually
 * gates each action — that a signed-in member cannot demote anyone, that a
 * platform administrator cannot mint an owner, and that the "last privileged
 * account" lockout guards run before any write reaches the database.
 *
 * `requirePermission()` is the real implementation, not a stub: the mock below
 * keeps `netlify/lib/auth` intact and replaces only `authenticate()` (which
 * would otherwise reach Supabase) plus the two helpers that write rows.
 */

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (_event?: unknown): Promise<unknown> => ({})),
  writeAudit: vi.fn(async (_input: Record<string, unknown>): Promise<void> => undefined),
  setPlatformSetting: vi.fn(async (_key: string, _value: unknown, _actor: string | null): Promise<void> => undefined),
  supabaseCount: vi.fn(async (_table: string, _filter?: string): Promise<number> => 5),
  supabaseInsert: vi.fn(async (_table: string, _rows: unknown[], _onConflict?: string): Promise<unknown[]> => [{ id: 'row-1' }]),
  supabaseSelectAs: vi.fn(async (_table: string, _query: string): Promise<unknown[]> => []),
  supabaseUpdate: vi.fn(async (_table: string, _filter: string, _patch: Record<string, unknown>): Promise<unknown[]> => []),
  authAdminRequest: vi.fn(async (_path: string, _options?: Record<string, unknown>): Promise<unknown> => ({ users: [] })),
}))

vi.mock('../netlify/lib/auth', async (importActual) => {
  const actual = await importActual<typeof import('../netlify/lib/auth')>()
  return { ...actual, authenticate: mocks.authenticate, writeAudit: mocks.writeAudit, setPlatformSetting: mocks.setPlatformSetting }
})

vi.mock('../netlify/lib/supabase', async (importActual) => {
  const actual = await importActual<typeof import('../netlify/lib/supabase')>()
  return {
    ...actual,
    supabaseCount: mocks.supabaseCount,
    supabaseInsert: mocks.supabaseInsert,
    supabaseSelectAs: mocks.supabaseSelectAs,
    supabaseUpdate: mocks.supabaseUpdate,
    authAdminRequest: mocks.authAdminRequest,
  }
})

import { handler } from '../netlify/functions/admin'
import type { AuthAccount } from '../netlify/lib/auth'
import { HttpError, type NetlifyEvent, type NetlifyResponse } from '../netlify/lib/http'
import { permissionsFor, type Role } from '../netlify/lib/rbac'

const OWNER_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const FEEDBACK_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

function accountFor(role: Role, options: { id?: string; status?: 'active' | 'suspended' | 'pending' } = {}): AuthAccount {
  const id = options.id ?? OWNER_ID
  const status = options.status ?? 'active'
  const email = `actor-${role}@example.com`
  return {
    user: { id, email },
    profile: { id, email, full_name: null, role, status, created_at: '2026-01-01T00:00:00Z' },
    role,
    status,
    permissions: permissionsFor(role, status),
    entitlements: {
      plan: 'standard',
      features: { ai: true, vision: false, workspace: true, research: true, exports: true, admin: true },
      dailyAiLimit: 0,
      workspaceItemLimit: 0,
    },
    trial: null,
    subscription: null,
    usageToday: 0,
    emailVerified: true,
  }
}

function profileRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TARGET_ID,
    email: 'target@example.com',
    full_name: 'Target User',
    role: 'admin',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function event(body: unknown, httpMethod = 'POST'): NetlifyEvent {
  return {
    httpMethod,
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7', authorization: 'Bearer admin-session-token' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    path: '/api/admin',
  }
}

interface Envelope {
  ok?: boolean
  error?: { code?: string; message?: string; detail?: string }
  [key: string]: unknown
}

function payload(response: NetlifyResponse): Envelope {
  return JSON.parse(response.body ?? '{}') as Envelope
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return value as Array<Record<string, unknown>>
}

/** `restoreMocks` clears every implementation between tests, so they are re-set here. */
beforeEach(() => {
  // `wrap()` logs every rejection; silenced per test because the cleanup below unstub it.
  vi.stubEnv('LOG_LEVEL', 'silent')
  mocks.authenticate.mockImplementation(async () => accountFor('owner'))
  mocks.writeAudit.mockImplementation(async () => undefined)
  mocks.setPlatformSetting.mockImplementation(async () => undefined)
  mocks.supabaseCount.mockImplementation(async () => 5)
  mocks.supabaseInsert.mockImplementation(async () => [{ id: 'row-1' }])
  mocks.supabaseSelectAs.mockImplementation(async () => [])
  mocks.supabaseUpdate.mockImplementation(async () => [])
  mocks.authAdminRequest.mockImplementation(async () => ({ users: [] }))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('every admin action demands its own capability', () => {
  /** A member holding a valid session must not be able to drive any of these routes. */
  const table: Array<{ label: string; body: Record<string, unknown>; permission: string }> = [
    { label: 'overview', body: { action: 'overview' }, permission: 'reports.read' },
    { label: 'users.list', body: { action: 'users.list' }, permission: 'users.read' },
    { label: 'users.update role', body: { action: 'users.update', userId: TARGET_ID, role: 'standard_member' }, permission: 'roles.assign' },
    { label: 'users.update status', body: { action: 'users.update', userId: TARGET_ID, status: 'suspended' }, permission: 'users.suspend' },
    { label: 'users.delete', body: { action: 'users.delete', userId: TARGET_ID }, permission: 'users.delete' },
    { label: 'audit.list', body: { action: 'audit.list' }, permission: 'audit_logs.read' },
    { label: 'feedback.list', body: { action: 'feedback.list' }, permission: 'content.read' },
    { label: 'feedback.resolve', body: { action: 'feedback.resolve', id: FEEDBACK_ID }, permission: 'content.update' },
    { label: 'settings.get', body: { action: 'settings.get' }, permission: 'settings.manage' },
    { label: 'settings.update', body: { action: 'settings.update', trialDays: 14 }, permission: 'settings.manage' },
    { label: 'subscriptions.list', body: { action: 'subscriptions.list' }, permission: 'subscriptions.manage' },
    { label: 'subscriptions.set', body: { action: 'subscriptions.set', userId: TARGET_ID, planId: 'premium' }, permission: 'subscriptions.manage' },
  ]

  it.each(table)('$label: a member gets 403 and no row is touched', async ({ body, permission }) => {
    mocks.authenticate.mockImplementation(async () => accountFor('premium_member'))
    const response = await handler(event(body), {})
    expect(response.statusCode).toBe(403)
    expect(payload(response).error?.message).toBe(`Your role does not include the "${permission}" permission.`)
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
    expect(mocks.authAdminRequest).not.toHaveBeenCalled()
    expect(mocks.setPlatformSetting).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it.each(table)('$label: an owner reaches the data layer', async ({ body }) => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow()])
    mocks.supabaseUpdate.mockImplementation(async () => [profileRow({ role: 'standard_member' })])
    const response = await handler(event(body), {})
    expect(response.statusCode).toBe(200)
    expect(payload(response).ok).toBe(true)
  })

  it('users.update checks the role capability before the status capability', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('content_manager'))
    const response = await handler(event({ action: 'users.update', userId: TARGET_ID, role: 'technical_editor', status: 'suspended' }), {})
    expect(payload(response).error?.message).toContain('"roles.assign"')
  })

  it('a suspended account is refused before any permission is compared', async () => {
    mocks.authenticate.mockImplementation(async () => {
      throw new HttpError(403, 'forbidden', 'This account is suspended. Contact an administrator.')
    })
    const response = await handler(event({ action: 'users.list' }), {})
    expect(response.statusCode).toBe(403)
    expect(payload(response).error?.message).toBe('This account is suspended. Contact an administrator.')
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
  })

  it('no signed-in session means no answer at all', async () => {
    mocks.authenticate.mockImplementation(async () => {
      throw new HttpError(401, 'unauthorized', 'Sign in to continue.')
    })
    expect((await handler(event({ action: 'users.list' }), {})).statusCode).toBe(401)
  })
})

describe('the endpoint is POST-only, size-capped and schema-checked', () => {
  it('rejects a GET before it even authenticates', async () => {
    const response = await handler(event({ action: 'overview' }, 'GET'), {})
    expect(response.statusCode).toBe(405)
    expect(mocks.authenticate).not.toHaveBeenCalled()
  })

  it('rejects an oversized body instead of parsing it', async () => {
    const response = await handler(event({ action: 'feedback.resolve', id: 'x'.repeat(400 * 1024) }), {})
    expect(response.statusCode).toBe(413)
    expect(payload(response).error?.code).toBe('payload_too_large')
  })

  it('reports the rejected field and its rule rather than a generic failure', async () => {
    const response = await handler(event({ action: 'users.list', limit: 5000 }), {})
    expect(response.statusCode).toBe(400)
    expect(payload(response).error?.message).toBe('limit: Too big: expected number to be <=100')
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
  })

  it.each([
    [{ action: 'users.update', userId: TARGET_ID }, 'Nothing to update.'],
    [{ action: 'settings.update' }, 'No settings were provided.'],
    [{ action: 'subscriptions.set', userId: 'not-a-uuid', planId: 'premium' }, 'userId: Invalid UUID'],
    [{ action: 'subscriptions.set', userId: TARGET_ID, planId: 'diamond' }, 'planId: Invalid option: expected one of "premium"|"standard"'],
    [{ action: 'settings.update', trialDays: 0 }, 'trialDays: Too small: expected number to be >=1'],
    [{ action: 'settings.update', trialDays: 366 }, 'trialDays: Too big: expected number to be <=365'],
    [{ action: 'settings.update', trialDays: 1.5 }, 'trialDays: Invalid input: expected int, received number'],
    [{ action: 'users.update', userId: TARGET_ID, role: 'root' }, 'role: Invalid option'],
  ])('refuses a malformed request body', async (body, expected) => {
    const response = await handler(event(body), {})
    expect(response.statusCode).toBe(400)
    expect(payload(response).error?.message).toContain(expected)
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
    expect(mocks.setPlatformSetting).not.toHaveBeenCalled()
  })

  it('ignores fields the schema never declared instead of honouring them', async () => {
    const response = await handler(event({ action: 'overview', role: 'owner', is_admin: true, userId: TARGET_ID }), {})
    expect(response.statusCode).toBe(200)
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
    expect(mocks.authAdminRequest).not.toHaveBeenCalled()
  })
})

describe('rank, not just permission, limits what an administrator may change', () => {
  it('an administrator cannot grant owner', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('admin'))
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'standard_member' })])
    const response = await handler(event({ action: 'users.update', userId: TARGET_ID, role: 'owner' }), {})
    expect(response.statusCode).toBe(403)
    expect(payload(response).error?.message).toBe('You cannot grant or revoke that role.')
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
  })

  it('an administrator cannot modify an equal or higher account', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('admin'))
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'super_admin' })])
    const response = await handler(event({ action: 'users.update', userId: TARGET_ID, role: 'technical_editor' }), {})
    expect(response.statusCode).toBe(403)
    expect(payload(response).error?.message).toBe('You cannot modify an account with an equal or higher role.')
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
  })

  it('a platform administrator may change an account but never delete one', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('admin'))
    const response = await handler(event({ action: 'users.delete', userId: TARGET_ID }), {})
    expect(response.statusCode).toBe(403)
    expect(payload(response).error?.message).toBe('Your role does not include the "users.delete" permission.')
    expect(mocks.authAdminRequest).not.toHaveBeenCalled()
  })

  it('the legacy super administrator still cannot reach an owner', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('super_admin'))
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'owner', status: 'active' })])
    const response = await handler(event({ action: 'users.delete', userId: TARGET_ID }), {})
    expect(response.statusCode).toBe(403)
    expect(payload(response).error?.message).toBe('You cannot delete an account with an equal or higher role.')
    expect(mocks.authAdminRequest).not.toHaveBeenCalled()
  })

  it('a content manager cannot delete a member even though it may delete content', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('content_manager'))
    const response = await handler(event({ action: 'users.delete', userId: TARGET_ID }), {})
    expect(payload(response).error?.message).toContain('"users.delete"')
    expect(mocks.authAdminRequest).not.toHaveBeenCalled()
  })

  it('nobody may change their own account', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('owner', { id: TARGET_ID }))
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ action: 'users.update', userId: TARGET_ID, role: 'admin' }, 'change the role of your own account'],
      [{ action: 'users.update', userId: TARGET_ID, status: 'suspended' }, 'suspend your own account'],
      [{ action: 'users.delete', userId: TARGET_ID }, 'delete your own account'],
    ]
    for (const [body, words] of cases) {
      const response = await handler(event(body), {})
      expect(response.statusCode).toBe(422)
      expect(payload(response).error?.message).toBe(`You cannot ${words}.`)
    }
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
  })
})

describe('the last privileged account cannot be locked out', () => {
  it('refuses to demote or suspend the only active owner', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'owner', status: 'active' })])
    mocks.supabaseCount.mockImplementation(async () => 1)
    for (const patch of [{ role: 'admin' }, { status: 'suspended' }]) {
      const response = await handler(event({ action: 'users.update', userId: TARGET_ID, ...patch }), {})
      expect(response.statusCode).toBe(422)
      expect(payload(response).error?.message).toBe('The last active platform owner cannot be demoted or suspended.')
    }
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('refuses to demote the only active super administrator', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'super_admin', status: 'active' })])
    mocks.supabaseCount.mockImplementation(async () => 1)
    const response = await handler(event({ action: 'users.update', userId: TARGET_ID, role: 'admin' }), {})
    expect(payload(response).error?.message).toBe('The last active super administrator cannot be demoted or suspended.')
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
  })

  it('refuses to delete the only active owner or super administrator', async () => {
    mocks.supabaseCount.mockImplementation(async () => 1)
    for (const role of ['owner', 'super_admin']) {
      mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role, status: 'active' })])
      const response = await handler(event({ action: 'users.delete', userId: TARGET_ID }), {})
      expect(response.statusCode).toBe(422)
      expect(payload(response).error?.message).toBe(
        role === 'owner' ? 'The last active platform owner cannot be deleted.' : 'The last active super administrator cannot be deleted.',
      )
      expect(mocks.authAdminRequest).not.toHaveBeenCalled()
    }
  })

  it('lets the change through when a second privileged account exists', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'owner', status: 'active' })])
    mocks.supabaseCount.mockImplementation(async () => 2)
    mocks.supabaseUpdate.mockImplementation(async () => [profileRow({ role: 'admin' })])
    expect((await handler(event({ action: 'users.update', userId: TARGET_ID, role: 'admin' }), {})).statusCode).toBe(200)
    expect(mocks.supabaseUpdate).toHaveBeenCalledTimes(1)
  })

  it('does not protect an account that is already suspended', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'owner', status: 'suspended' })])
    mocks.supabaseCount.mockImplementation(async () => 1)
    mocks.supabaseUpdate.mockImplementation(async () => [profileRow({ role: 'admin', status: 'suspended' })])
    expect((await handler(event({ action: 'users.update', userId: TARGET_ID, role: 'admin' }), {})).statusCode).toBe(200)
  })
})

describe('writes that are allowed are audited beside the change', () => {
  it('logs the role change with the before and after values', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'admin', status: 'active' })])
    mocks.supabaseUpdate.mockImplementation(async () => [profileRow({ role: 'technical_editor' })])
    const response = await handler(event({ action: 'users.update', userId: TARGET_ID, role: 'technical_editor' }), {})
    expect(response.statusCode).toBe(200)
    expect(mocks.supabaseUpdate.mock.calls[0]?.[1]).toBe(`id=eq.${TARGET_ID}`)
    expect(mocks.supabaseUpdate.mock.calls[0]?.[2]).toMatchObject({ role: 'technical_editor' })
    expect(mocks.writeAudit).toHaveBeenCalledTimes(1)
    expect(mocks.writeAudit.mock.calls[0]?.[0]).toMatchObject({
      actorId: OWNER_ID,
      action: 'admin.role_assign',
      targetId: TARGET_ID,
      detail: { fromRole: 'admin', toRole: 'technical_editor', fromStatus: 'active', toStatus: 'active' },
    })
  })

  it('names the suspend and reactivate actions distinctly', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'admin', status: 'active' })])
    mocks.supabaseUpdate.mockImplementation(async () => [profileRow({ role: 'admin', status: 'suspended' })])
    await handler(event({ action: 'users.update', userId: TARGET_ID, status: 'suspended' }), {})
    expect(mocks.writeAudit.mock.calls[0]?.[0]).toMatchObject({ action: 'admin.user_suspend' })
    await handler(event({ action: 'users.update', userId: TARGET_ID, status: 'active' }), {})
    expect(mocks.writeAudit.mock.calls[1]?.[0]).toMatchObject({ action: 'admin.user_reactivate' })
  })

  it('records the deletion audit before issuing the deletion', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'admin' })])
    await handler(event({ action: 'users.delete', userId: TARGET_ID }), {})
    expect(mocks.writeAudit.mock.invocationCallOrder[0]).toBeLessThan(mocks.authAdminRequest.mock.invocationCallOrder[0])
    expect(mocks.authAdminRequest.mock.calls[0]?.[0]).toBe(`/users/${TARGET_ID}`)
    expect(mocks.authAdminRequest.mock.calls[0]?.[1]).toMatchObject({ method: 'DELETE' })
  })

  it('keeps a failed write unaudited', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'admin' })])
    mocks.supabaseUpdate.mockImplementation(async () => {
      throw new HttpError(502, 'upstream_error', 'Database is temporarily unavailable.')
    })
    const response = await handler(event({ action: 'users.update', userId: TARGET_ID, role: 'technical_editor' }), {})
    expect(response.statusCode).toBe(502)
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('answers 404 and writes nothing when the target profile does not exist', async () => {
    for (const body of [
      { action: 'users.update', userId: TARGET_ID, role: 'admin' },
      { action: 'users.delete', userId: TARGET_ID },
      { action: 'subscriptions.set', userId: TARGET_ID, planId: 'premium' },
    ]) {
      const response = await handler(event(body), {})
      expect(response.statusCode).toBe(404)
      expect(payload(response).error?.message).toBe('User not found.')
    }
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })
})

describe('unknown rows are treated as data, never as an empty success', () => {
  it('falls back to standard_member when the database holds a role nobody recognises', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'god_mode' })])
    const response = await handler(event({ action: 'users.list', limit: 10 }), {})
    expect(asRows(payload(response).items)[0]?.role).toBe('standard_member')
  })

  it('refuses to plan a subscription for an account with an invalid role', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow({ role: 'god_mode' })])
    const response = await handler(event({ action: 'subscriptions.set', userId: TARGET_ID, planId: 'premium' }), {})
    expect(response.statusCode).toBe(422)
    expect(payload(response).error?.message).toBe('The target account has an invalid role.')
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })

  it('never claims a user is manageable by their own account', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('admin'))
    mocks.supabaseSelectAs.mockImplementation(async () => [
      profileRow({ id: OWNER_ID, role: 'technical_editor' }),
      profileRow({ id: TARGET_ID, role: 'technical_editor' }),
    ])
    const items = asRows(payload(await handler(event({ action: 'users.list' }), {})).items)
    expect(items).toHaveLength(2)
    expect(items.find((row) => row.id === OWNER_ID)?.manageable).toBe(false)
    expect(items.find((row) => row.id === TARGET_ID)?.manageable).toBe(true)
  })

  it('answers with the role list RBAC holds, not the list the browser sent', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('admin'))
    const response = await handler(event({ action: 'users.list' }), {})
    const assignable = payload(response).assignableRoles as string[]
    expect(assignable).not.toContain('owner')
    expect(assignable).not.toContain('super_admin')
    expect(assignable).not.toContain('admin')
    expect(assignable).toContain('technical_editor')
  })

  it('leaves the last sign-in unknown when the auth admin API is down', async () => {
    mocks.authAdminRequest.mockImplementation(async () => {
      throw new HttpError(503, 'not_configured', 'Supabase service credentials are not configured.')
    })
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow()])
    const response = await handler(event({ action: 'users.list' }), {})
    expect(response.statusCode).toBe(200)
    expect(asRows(payload(response).items)[0]?.last_sign_in_at).toBeNull()
  })
})

describe('search terms cannot rewrite a PostgREST filter', () => {
  it('strips the operators that would close the or= group', async () => {
    const response = await handler(event({ action: 'users.list', q: 'a)or(email.ilike.%25*,role.eq.owner' }), {})
    expect(response.statusCode).toBe(200)
    const query = mocks.supabaseSelectAs.mock.calls[0]?.[1] ?? ''
    expect((query.match(/\(/g) ?? []).length).toBe(1)
    expect((query.match(/\)/g) ?? []).length).toBe(1)
    expect((query.match(/,/g) ?? []).length).toBe(1)
    expect(query).not.toContain('%25')
    const segments = query.split('&')
    expect(segments.filter((segment) => segment.startsWith('or='))).toHaveLength(1)
    expect(segments.some((segment) => segment.startsWith('role='))).toBe(false)
  })

  it('passes an ordinary term through encoded', async () => {
    await handler(event({ action: 'users.list', q: 'ada@example.com' }), {})
    expect(mocks.supabaseSelectAs.mock.calls[0]?.[1]).toContain('email.ilike.*ada%40example.com*')
  })

  it('combines the role and status filters with the search term', async () => {
    await handler(event({ action: 'users.list', role: 'trial_member', status: 'pending', q: 'ada' }), {})
    const query = mocks.supabaseSelectAs.mock.calls[0]?.[1] ?? ''
    expect(query).toContain('role=eq.trial_member')
    expect(query).toContain('status=eq.pending')
    expect(query).toContain('or=(email.ilike.*ada*')
    expect(mocks.supabaseCount.mock.calls[0]?.[1]).toBe('role=eq.trial_member&status=eq.pending&or=(email.ilike.*ada*,full_name.ilike.*ada*)')
  })

  it('rejects a term longer than the UI will accept', async () => {
    const response = await handler(event({ action: 'users.list', q: 'x'.repeat(121) }), {})
    expect(response.statusCode).toBe(400)
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
  })
})

describe('settings and subscriptions validate before they write', () => {
  it('stores each named key and audits them together', async () => {
    const response = await handler(
      event({ action: 'settings.update', trialDays: 21, signupsEnabled: false, maintenanceMode: true, announcement: 'Back at 18:00 UTC' }),
      {},
    )
    expect(response.statusCode).toBe(200)
    expect(mocks.setPlatformSetting.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([
      ['trial_days', 21, OWNER_ID],
      ['signups_enabled', false, OWNER_ID],
      ['maintenance_mode', true, OWNER_ID],
      ['announcement', 'Back at 18:00 UTC', OWNER_ID],
    ])
    expect(mocks.writeAudit.mock.calls[0]?.[0]).toMatchObject({
      action: 'settings.update',
      targetId: 'trial_days,signups_enabled,maintenance_mode,announcement',
    })
  })

  it('returns the stored settings on settings.get', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [{ key: 'maintenance_mode', value: true }])
    const response = await handler(event({ action: 'settings.get' }), {})
    expect(response.statusCode).toBe(200)
    expect(payload(response).items).toEqual([{ key: 'maintenance_mode', value: true }])
  })

  it('refuses a billing period that has already ended', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow()])
    const response = await handler(
      event({ action: 'subscriptions.set', userId: TARGET_ID, planId: 'premium', periodEnd: '2020-01-01T00:00:00Z' }),
      {},
    )
    expect(response.statusCode).toBe(422)
    expect(payload(response).error?.message).toBe('The billing period end must be in the future.')
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })

  it('plans premium or standard only, and writes the billing event beside it', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [profileRow()])
    mocks.supabaseInsert.mockImplementation(async () => [{ id: 'sub-1' }])
    const response = await handler(
      event({ action: 'subscriptions.set', userId: TARGET_ID, planId: 'premium', periodEnd: '2099-01-01T00:00:00Z' }),
      {},
    )
    expect(response.statusCode).toBe(200)
    expect(payload(response).paymentProvider).toBe('manual')
    expect(mocks.supabaseInsert.mock.calls[0]?.[0]).toBe('subscriptions')
    expect(mocks.supabaseInsert.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({ user_id: TARGET_ID, plan_id: 'premium', status: 'active', current_period_end: '2099-01-01T00:00:00Z' }),
    ])
    expect(mocks.supabaseInsert.mock.calls[0]?.[2]).toBe('user_id')
    expect(mocks.supabaseInsert.mock.calls[1]?.[0]).toBe('billing_events')
    expect(mocks.supabaseInsert.mock.calls[1]?.[1]).toEqual([
      expect.objectContaining({
        type: 'manual.plan_set',
        provider: 'manual',
        metadata: { planId: 'premium', periodEnd: '2099-01-01T00:00:00Z', actor: OWNER_ID },
      }),
    ])
    expect(mocks.writeAudit.mock.calls[0]?.[0]).toMatchObject({ action: 'subscriptions.manual_set', targetId: TARGET_ID })
  })

  it('pairs each subscription with the profile email the database holds', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('admin'))
    mocks.supabaseSelectAs.mockImplementation(async (table: string) =>
      table === 'subscriptions'
        ? [{ id: 's1', user_id: TARGET_ID, plan_id: 'premium', status: 'active' }]
        : [{ id: TARGET_ID, email: 'target@example.com', role: 'admin', status: 'active' }],
    )
    const response = await handler(event({ action: 'subscriptions.list' }), {})
    expect(asRows(payload(response).items)[0]).toMatchObject({ id: 's1', email: 'target@example.com' })
  })

  it('answers a subscription with no matching profile with a null email', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: 's1', user_id: TARGET_ID }])
    const response = await handler(event({ action: 'subscriptions.list' }), {})
    expect(asRows(payload(response).items)[0]?.email).toBeNull()
  })
})

describe('feedback handling stays inside its own capability', () => {
  it('lists only open items for a role with content.read', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('support_specialist'))
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: FEEDBACK_ID, status: 'open' }])
    const response = await handler(event({ action: 'feedback.list' }), {})
    expect(response.statusCode).toBe(200)
    expect(mocks.supabaseSelectAs.mock.calls[0]?.[1]).toContain('status=eq.open')
  })

  it('refuses to resolve feedback from a role that can read but not update', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('support_specialist'))
    const response = await handler(event({ action: 'feedback.resolve', id: FEEDBACK_ID }), {})
    expect(response.statusCode).toBe(403)
    expect(payload(response).error?.message).toContain('"content.update"')
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
  })

  it('marks the resolver and refuses a silently-empty update', async () => {
    mocks.authenticate.mockImplementation(async () => accountFor('content_manager'))
    const missing = await handler(event({ action: 'feedback.resolve', id: FEEDBACK_ID }), {})
    expect(missing.statusCode).toBe(404)
    expect(payload(missing).error?.message).toBe('Feedback item not found.')
    expect(mocks.writeAudit).not.toHaveBeenCalled()

    mocks.supabaseUpdate.mockImplementation(async () => [{ id: FEEDBACK_ID, status: 'resolved' }])
    const ok = await handler(event({ action: 'feedback.resolve', id: FEEDBACK_ID }), {})
    expect(ok.statusCode).toBe(200)
    expect(mocks.supabaseUpdate.mock.calls[0]?.[2]).toMatchObject({ status: 'resolved', resolved_by: OWNER_ID })
    expect(mocks.writeAudit.mock.calls[0]?.[0]).toMatchObject({ action: 'content.feedback_resolve', targetType: 'content_feedback' })
  })
})

describe('the overview aggregates rather than guesses', () => {
  it('counts only active and trialing subscriptions into their plan', async () => {
    mocks.supabaseSelectAs.mockImplementation(async (table: string) =>
      table === 'subscriptions'
        ? [
            { plan_id: 'premium', status: 'active' },
            { plan_id: 'premium', status: 'trialing' },
            { plan_id: 'premium', status: 'canceled' },
            { plan_id: 'standard', status: 'active' },
            { status: 'active' },
          ]
        : [],
    )
    const response = await handler(event({ action: 'overview' }), {})
    expect(payload(response).planCounts).toEqual({ premium: 2, standard: 2, trial: 0 })
  })

  it('answers seven days of usage even when nothing happened', async () => {
    mocks.supabaseSelectAs.mockImplementation(async (table: string) =>
      table === 'usage_events' ? [{ kind: 'ai', created_at: `${new Date().toISOString().slice(0, 10)}T10:00:00Z` }] : [],
    )
    const response = await handler(event({ action: 'overview' }), {})
    const series = payload(response).usageSeries as Array<{ date: string; requests: number }>
    expect(series).toHaveLength(7)
    expect(series[6]).toEqual({ date: new Date().toISOString().slice(0, 10), requests: 1 })
    expect(series.slice(0, 6).every((entry) => entry.requests === 0)).toBe(true)
  })

  it('reads the staff filter from the role list, not from the browser', async () => {
    await handler(event({ action: 'overview' }), {})
    const staffFilter = mocks.supabaseCount.mock.calls[1]?.[1] ?? ''
    expect(staffFilter).toBe('role=in.(owner,admin,super_admin,content_manager,technical_editor,support_specialist)')
  })
})

describe('actions the schema accepts are still answered deliberately', () => {
  /**
   * `users.create`, `users.reset_password` and `users.revoke_sessions` are
   * implemented only by the local development branch, and the UI never sends
   * them. Pinning the Supabase-path answer keeps that gap visible instead of
   * letting it become a silent no-op.
   */
  it.each(['users.create', 'users.reset_password', 'users.revoke_sessions'])('%s is refused on a Supabase deployment', async (action) => {
    const response = await handler(
      event({ action, userId: TARGET_ID, username: 'ada', email: 'ada@example.com', password: 'correct horse battery staple', role: 'standard_member' }),
      {},
    )
    expect(response.statusCode).toBe(400)
    expect(payload(response).error?.message).toBe('Unknown administrative action.')
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
    expect(mocks.authAdminRequest).not.toHaveBeenCalled()
  })
})
