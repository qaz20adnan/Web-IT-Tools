import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `/api/workspace` is where a member's cases, notes and chat history live, and no test imported it
 * before this file. `PROJECT_AUDIT` §4 claimed "no IDOR found" from reading the source; the claim is
 * checked here at the handler instead — every query that leaves this function must name the caller's
 * own id, and a request that names someone else's row must get the same 404 it would get for a row
 * that does not exist.
 *
 * `requireVerified()` and `countOwned()` are the real implementations; only `authenticate()` and the
 * row helpers are replaced, so the tenancy filter the budget check builds is exercised too.
 */

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (_event?: unknown): Promise<unknown> => ({})),
  writeAudit: vi.fn(async (_input: Record<string, unknown>): Promise<void> => undefined),
  supabaseCount: vi.fn(async (_table: string, _filter?: string): Promise<number> => 0),
  supabaseInsert: vi.fn(async (_table: string, _rows: unknown[]): Promise<unknown[]> => []),
  supabaseSelectAs: vi.fn(async (_table: string, _query: string): Promise<unknown[]> => []),
  supabaseUpdate: vi.fn(async (_table: string, _filter: string, _patch: Record<string, unknown>): Promise<unknown[]> => []),
  supabaseDeleteWhere: vi.fn(async (_table: string, _filter: string): Promise<unknown> => []),
}))

vi.mock('../netlify/lib/auth', async (importActual) => {
  const actual = await importActual<typeof import('../netlify/lib/auth')>()
  return { ...actual, authenticate: mocks.authenticate, writeAudit: mocks.writeAudit }
})

vi.mock('../netlify/lib/supabase', async (importActual) => {
  const actual = await importActual<typeof import('../netlify/lib/supabase')>()
  return {
    ...actual,
    supabaseCount: mocks.supabaseCount,
    supabaseInsert: mocks.supabaseInsert,
    supabaseSelectAs: mocks.supabaseSelectAs,
    supabaseUpdate: mocks.supabaseUpdate,
    supabaseDeleteWhere: mocks.supabaseDeleteWhere,
  }
})

import { handler } from '../netlify/functions/workspace'
import type { AuthAccount } from '../netlify/lib/auth'
import { HttpError } from '../netlify/lib/http'
import type { NetlifyEvent, NetlifyResponse } from '../netlify/lib/http'

const CALLER = 'aaaaaaaa-1111-4111-8111-111111111111'
const OTHER_CALLER = 'bbbbbbbb-2222-4222-8222-222222222222'
const VICTIM_CASE = 'cccccccc-3333-4333-8333-333333333333'
const VICTIM_CONVERSATION = 'dddddddd-4444-4444-8444-444444444444'
const OWN_CASE = 'eeeeeeee-5555-4555-8555-555555555555'
const OWN_CONVERSATION = 'ffffffff-6666-4666-8666-666666666666'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function account(overrides: {
  verified?: boolean
  workspaceFeature?: boolean
  itemLimit?: number
  plan?: string
} = {}): AuthAccount {
  return {
    user: { id: CALLER, email: 'ada@example.com' },
    profile: { id: CALLER, email: 'ada@example.com', full_name: 'Ada', role: 'standard_member', status: 'active', created_at: '2026-01-01T00:00:00Z' },
    role: 'standard_member',
    status: 'active',
    permissions: [],
    entitlements: {
      plan: (overrides.plan ?? 'standard') as never,
      features: { ai: true, vision: false, workspace: overrides.workspaceFeature ?? true, research: true, exports: true, admin: false },
      dailyAiLimit: 20,
      workspaceItemLimit: overrides.itemLimit ?? 50,
    },
    trial: null,
    subscription: null,
    usageToday: 3,
    emailVerified: overrides.verified ?? true,
  }
}

function event(body: unknown, httpMethod = 'POST'): NetlifyEvent {
  return {
    httpMethod,
    headers: { 'content-type': 'application/json', authorization: 'Bearer member-session-token' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    path: '/api/workspace',
  }
}

function payload(response: NetlifyResponse): Record<string, unknown> {
  return JSON.parse(response.body ?? '{}') as Record<string, unknown>
}

function errorOf(response: NetlifyResponse): { code?: string; message?: string; detail?: string } {
  return (payload(response).error ?? {}) as { code?: string; message?: string; detail?: string }
}

const ownerFilter = `user_id=eq.${CALLER}`

/** Every query string the handler sent for table reads, in order. */
function selects(): Array<{ table: string; query: string }> {
  return mocks.supabaseSelectAs.mock.calls.map((call) => ({ table: String(call[0]), query: String(call[1]) }))
}

function updates(): Array<{ table: string; filter: string; patch: Record<string, unknown> }> {
  return mocks.supabaseUpdate.mock.calls.map((call) => ({ table: String(call[0]), filter: String(call[1]), patch: call[2] as Record<string, unknown> }))
}

function deletes(): Array<{ table: string; filter: string }> {
  return mocks.supabaseDeleteWhere.mock.calls.map((call) => ({ table: String(call[0]), filter: String(call[1]) }))
}

function inserted(table: string): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  for (const call of mocks.supabaseInsert.mock.calls) {
    if (String(call[0]) === table) rows.push(...(call[1] as Array<Record<string, unknown>>))
  }
  return rows
}

function counts(): Array<{ table: string; filter: string }> {
  return mocks.supabaseCount.mock.calls.map((call) => ({ table: String(call[0]), filter: String(call[1] ?? '') }))
}

const aCase = { title: 'DNS fails only on the VPN', category: 'network', priority: 'high', symptoms: 'resolv.conf looks right' }
const aNote = { title: 'Uplink flaps', body: 'interface 3 every night', tags: ['uplink'] }
const aConversation = { title: 'Chat', provider: 'openrouter', model: 'x', messages: [{ role: 'user', content: 'why is it slow' }] }

beforeEach(() => {
  // `wrap()` logs every rejection; silenced per test because `unstubAllEnvs` below clears it.
  vi.stubEnv('LOG_LEVEL', 'silent')
  mocks.authenticate.mockImplementation(async () => account())
  mocks.writeAudit.mockImplementation(async () => undefined)
  mocks.supabaseCount.mockImplementation(async () => 0)
  mocks.supabaseInsert.mockImplementation(async (_table, rows) => (rows as Array<Record<string, unknown>>).map((row) => ({ ...row })))
  mocks.supabaseSelectAs.mockImplementation(async () => [])
  mocks.supabaseUpdate.mockImplementation(async (_table, _filter, patch) => [{ id: OWN_CASE, ...patch }])
  mocks.supabaseDeleteWhere.mockImplementation(async () => [])
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('the gates that run before any row is read', () => {
  it('is POST-only, and refuses before it authenticates', async () => {
    const response = await handler(event({ action: 'overview' }, 'GET'), {})
    expect(response.statusCode).toBe(405)
    expect(mocks.authenticate).not.toHaveBeenCalled()
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
  })

  it('caps the request body at 512 KB', async () => {
    const response = await handler(event({ action: 'note.save', item: { title: 'big', body: 'x'.repeat(600 * 1024) } }), {})
    expect(response.statusCode).toBe(413)
    expect(errorOf(response).code).toBe('payload_too_large')
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })

  it('will not serve a caller with no session', async () => {
    mocks.authenticate.mockImplementation(async () => {
      throw new HttpError(401, 'unauthorized', 'Sign in to continue.')
    })
    const response = await handler(event({ action: 'overview' }), {})
    expect(response.statusCode).toBe(401)
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
  })

  it('will not serve a suspended account, even with a valid token', async () => {
    mocks.authenticate.mockImplementation(async () => {
      throw new HttpError(403, 'forbidden', 'This account is suspended. Contact an administrator.')
    })
    expect((await handler(event({ action: 'case.list' }), {})).statusCode).toBe(403)
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
  })

  it('refuses an unverified address through the real requireVerified()', async () => {
    mocks.authenticate.mockImplementation(async () => account({ verified: false }))
    const response = await handler(event({ action: 'overview' }), {})
    expect(response.statusCode).toBe(403)
    expect(errorOf(response).message).toBe('Verify your email address to continue.')
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
  })

  it('refuses a plan without the workspace feature', async () => {
    mocks.authenticate.mockImplementation(async () => account({ workspaceFeature: false }))
    const response = await handler(event({ action: 'case.list' }), {})
    expect(response.statusCode).toBe(403)
    expect(errorOf(response).message).toBe('The private workspace is not available on this plan or account status.')
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
  })

  it('checks the plan before it parses the body, so a bad body cannot probe entitlements', async () => {
    mocks.authenticate.mockImplementation(async () => account({ workspaceFeature: false }))
    const response = await handler(event({ action: 'nonsense' }), {})
    expect(response.statusCode).toBe(403)
    expect(errorOf(response).message).toContain('not available on this plan')
  })

  it('reports the rejected field, not a generic failure', async () => {
    const response = await handler(event({ action: 'case.save', item: { title: 'ab' } }), {})
    expect(response.statusCode).toBe(400)
    expect(errorOf(response).code).toBe('invalid_input')
    expect(errorOf(response).message).toMatch(/^item\.title: /)
  })

  it('refuses a target that is not a UUID before any query is built', async () => {
    for (const id of ['1', 'not-a-uuid', '../../etc/passwd', VICTIM_CASE.slice(0, 30)]) {
      const response = await handler(event({ action: 'case.get', id }), {})
      expect(response.statusCode).toBe(400)
      expect(errorOf(response).detail).toBeUndefined()
    }
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
  })
})

describe('every query names the caller, never anybody else', () => {
  const reads: Array<[string, Record<string, unknown>]> = [
    ['overview', { action: 'overview' }],
    ['case.list', { action: 'case.list' }],
    ['case.get', { action: 'case.get', id: OWN_CASE }],
    ['note.list', { action: 'note.list' }],
    ['conversation.list', { action: 'conversation.list' }],
    ['conversation.get', { action: 'conversation.get', id: OWN_CONVERSATION }],
  ]

  it.each(reads)('%s scopes every select', async (_label, body) => {
    await handler(event(body), {})
    expect(selects().length).toBeGreaterThan(0)
    for (const query of selects()) expect(query.query).toContain(ownerFilter)
    expect(JSON.stringify(selects())).not.toContain(OTHER_CALLER)
  })

  it('carries the owner filter into the message rows too, not only the parent', async () => {
    mocks.supabaseSelectAs.mockImplementation(async (table) => (table === 'conversations' ? [{ id: OWN_CONVERSATION }] : []))
    await handler(event({ action: 'conversation.get', id: OWN_CONVERSATION }), {})
    const messageQuery = selects().find((entry) => entry.table === 'conversation_messages')
    expect(messageQuery?.query).toContain(`conversation_id=eq.${OWN_CONVERSATION}`)
    expect(messageQuery?.query).toContain(ownerFilter)
  })

  it('counts only the caller’s own rows when it checks the budget', async () => {
    await handler(event({ action: 'case.save', item: aCase }), {})
    const budget = counts()
    expect(budget).toHaveLength(3)
    for (const entry of budget) {
      expect(entry.filter).toBe(`${ownerFilter}&archived_at=is.null`)
    }
  })
})

describe('another account’s row is answered as if it did not exist', () => {
  it('case.get on a foreign id asks for both ids and answers 404', async () => {
    const response = await handler(event({ action: 'case.get', id: VICTIM_CASE }), {})
    expect(response.statusCode).toBe(404)
    expect(errorOf(response).message).toBe('Case not found.')
    const query = selects()[0]?.query ?? ''
    expect(query).toContain(`id=eq.${VICTIM_CASE}`)
    expect(query).toContain(ownerFilter)
  })

  it('conversation.get on a foreign id answers 404 and never reads its messages', async () => {
    const response = await handler(event({ action: 'conversation.get', id: VICTIM_CONVERSATION }), {})
    expect(response.statusCode).toBe(404)
    expect(errorOf(response).message).toBe('Conversation not found.')
    expect(selects().some((entry) => entry.table === 'conversation_messages')).toBe(false)
  })

  it('case.delete on a foreign id writes nothing and audits nothing', async () => {
    const response = await handler(event({ action: 'case.delete', id: VICTIM_CASE }), {})
    expect(response.statusCode).toBe(404)
    expect(mocks.supabaseDeleteWhere).not.toHaveBeenCalled()
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('note.delete on a foreign id checks ownership before it deletes', async () => {
    const response = await handler(event({ action: 'note.delete', id: VICTIM_CASE }), {})
    expect(response.statusCode).toBe(404)
    expect(errorOf(response).message).toBe('Note not found.')
    expect(mocks.supabaseDeleteWhere).not.toHaveBeenCalled()
  })

  it('conversation.delete on a foreign id removes neither the history nor the row', async () => {
    const response = await handler(event({ action: 'conversation.delete', id: VICTIM_CONVERSATION }), {})
    expect(response.statusCode).toBe(404)
    expect(mocks.supabaseDeleteWhere).not.toHaveBeenCalled()
  })

  it('a save that targets a foreign case is refused before the update is built', async () => {
    const response = await handler(event({ action: 'case.save', item: { ...aCase, id: VICTIM_CASE } }), {})
    expect(response.statusCode).toBe(404)
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
  })

  it('a rename that targets a foreign conversation is refused before the update', async () => {
    const response = await handler(event({ action: 'conversation.rename', id: VICTIM_CONVERSATION, title: 'mine now' }), {})
    expect(response.statusCode).toBe(404)
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
  })

  it('an archive that targets a foreign case is refused before the update', async () => {
    const response = await handler(event({ action: 'case.archive', id: VICTIM_CASE }), {})
    expect(response.statusCode).toBe(404)
    expect(mocks.supabaseUpdate).not.toHaveBeenCalled()
  })

  it('a note update with no matching owned row is a 404, not a silent success', async () => {
    mocks.supabaseUpdate.mockImplementation(async () => [])
    const response = await handler(event({ action: 'note.save', item: { ...aNote, id: VICTIM_CASE } }), {})
    expect(response.statusCode).toBe(404)
    expect(errorOf(response).message).toBe('Note not found.')
    expect(updates()[0]?.filter).toContain(ownerFilter)
  })
})

describe('writes carry ownership in the row, and cannot take it from the body', () => {
  it('a new case is inserted with the caller’s id and a generated UUID', async () => {
    await handler(event({ action: 'case.save', item: aCase }), {})
    const [row] = inserted('cases')
    expect(row?.user_id).toBe(CALLER)
    expect(String(row?.id)).toMatch(UUID)
    expect(row?.created_at).toBe(row?.updated_at)
  })

  it('a body that brings its own user_id cannot move a row to another account', async () => {
    const response = await handler(event({ action: 'case.save', item: { ...aCase, user_id: OTHER_CALLER, role: 'owner', is_admin: true, archived_at: '2020-01-01T00:00:00Z' } }), {})
    expect(response.statusCode).toBe(200)
    const [row] = inserted('cases')
    expect(row?.user_id).toBe(CALLER)
    // `role`, `is_admin` and `archived_at` are not columns a case save can write at all.
    for (const key of ['role', 'is_admin', 'archived_at']) expect(Object.keys(row ?? {})).not.toContain(key)
  })

  it('an update patch never carries user_id, so saving cannot transfer ownership', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: OWN_CASE, user_id: CALLER }])
    await handler(event({ action: 'case.save', item: { ...aCase, id: OWN_CASE, user_id: OTHER_CALLER } }), {})
    const [update] = updates()
    expect(update?.filter).toBe(`id=eq.${OWN_CASE}&${ownerFilter}`)
    expect(Object.keys(update?.patch ?? {})).not.toContain('user_id')
  })

  it('saving an owned case also clears archived_at, which is what re-activates it', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: OWN_CASE, user_id: CALLER }])
    await handler(event({ action: 'case.save', item: { ...aCase, id: OWN_CASE } }), {})
    expect(updates()[0]?.patch.archived_at).toBe(null)
  })

  it('archiving stamps a timestamp and restoring clears it, both scoped to the caller', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: OWN_CASE, user_id: CALLER }])
    await handler(event({ action: 'case.archive', id: OWN_CASE }), {})
    expect(String(updates()[0]?.patch.archived_at)).toMatch(/T/)
    expect(updates()[0]?.filter).toContain(ownerFilter)

    mocks.supabaseUpdate.mockClear()
    await handler(event({ action: 'case.restore', id: OWN_CASE }), {})
    expect(updates()[0]?.patch.archived_at).toBe(null)
  })

  it('a new note is inserted under the caller and cannot arrive pre-archived by another route', async () => {
    await handler(event({ action: 'note.save', item: { ...aNote, archived_at: '2020-01-01T00:00:00Z' } }), {})
    const [row] = inserted('notes')
    expect(row?.user_id).toBe(CALLER)
    expect(Object.keys(row ?? {})).not.toContain('archived_at')
  })

  it('deleting a case filters on both ids and audits the actor afterwards', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: OWN_CASE, user_id: CALLER }])
    await handler(event({ action: 'case.delete', id: OWN_CASE }), {})
    expect(deletes()[0]).toEqual({ table: 'cases', filter: `id=eq.${OWN_CASE}&${ownerFilter}` })
    const auditCallOrder = mocks.writeAudit.mock.invocationCallOrder[0]
    const deleteOrder = mocks.supabaseDeleteWhere.mock.invocationCallOrder[0]
    expect(mocks.writeAudit.mock.calls[0]?.[0]).toMatchObject({ actorId: CALLER, action: 'workspace.case_delete', targetId: OWN_CASE, outcome: 'success' })
    // Pinned as it is written today: the row goes first, the audit trail second.
    expect(deleteOrder).toBeLessThan(auditCallOrder)
  })

  it('saving a conversation writes the parent and every message under the caller', async () => {
    const response = await handler(event({ action: 'conversation.save', item: { ...aConversation, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] } }), {})
    const parent = inserted('conversations')[0]
    const messages = inserted('conversation_messages')
    expect(parent?.user_id).toBe(CALLER)
    expect(messages).toHaveLength(2)
    for (const message of messages) {
      expect(message.user_id).toBe(CALLER)
      expect(message.conversation_id).toBe(parent?.id)
    }
    expect(payload(response).id).toBe(parent?.id)
  })

  it('a message row cannot be re-addressed to another account by the body', async () => {
    await handler(event({ action: 'conversation.save', item: { ...aConversation, messages: [{ role: 'user', content: 'a', user_id: OTHER_CALLER }] } }), {})
    expect(inserted('conversation_messages')[0]?.user_id).toBe(CALLER)
  })

  it('re-saving a conversation replaces its history inside the caller’s own scope', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: OWN_CONVERSATION, user_id: CALLER }])
    await handler(event({ action: 'conversation.save', item: { ...aConversation, id: OWN_CONVERSATION } }), {})
    expect(updates()[0]?.filter).toBe(`id=eq.${OWN_CONVERSATION}&${ownerFilter}`)
    expect(deletes()[0]).toEqual({ table: 'conversation_messages', filter: `conversation_id=eq.${OWN_CONVERSATION}&${ownerFilter}` })
    expect(inserted('conversation_messages')).toHaveLength(1)
  })

  /**
   * L-17 pinned, not fixed: `conversation.save` deletes the history and re-inserts whatever the body
   * carries, so the same request with `messages: []` empties the conversation. No UI sends the action
   * today, and the wipe can only ever hit the caller's own rows — but a test has to name the
   * consequence, or the next reader assumes an empty body is a no-op.
   */
  it('re-saving with an empty message array erases the history instead of leaving it alone', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: OWN_CONVERSATION, user_id: CALLER }])
    const response = await handler(event({ action: 'conversation.save', item: { ...aConversation, id: OWN_CONVERSATION, messages: [] } }), {})
    expect(response.statusCode).toBe(200)
    expect(payload(response).id).toBe(OWN_CONVERSATION)
    expect(deletes()).toEqual([{ table: 'conversation_messages', filter: `conversation_id=eq.${OWN_CONVERSATION}&${ownerFilter}` }])
    expect(inserted('conversation_messages')).toHaveLength(0)
  })

  it('deleting a conversation removes the messages before the parent', async () => {
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: OWN_CONVERSATION, user_id: CALLER }])
    const response = await handler(event({ action: 'conversation.delete', id: OWN_CONVERSATION }), {})
    expect(payload(response).deleted).toBe(true)
    expect(deletes().map((entry) => entry.table)).toEqual(['conversation_messages', 'conversations'])
  })

  it('feedback is recorded against the caller as an open item, with no audit row', async () => {
    await handler(event({ action: 'feedback.submit', item: { contentType: 'article', contentId: 'kb-1', reason: 'outdated', message: 'the port table predates 2026' } }), {})
    expect(inserted('content_feedback')[0]).toMatchObject({ user_id: CALLER, status: 'open', content_type: 'article', reason: 'outdated' })
    expect(mocks.writeAudit).not.toHaveBeenCalled()
  })

  it('feedback refuses a content type the enum does not know', async () => {
    const response = await handler(event({ action: 'feedback.submit', item: { contentType: 'wiki', contentId: 'x', reason: 'other' } }), {})
    expect(response.statusCode).toBe(400)
    expect(errorOf(response).message).toMatch(/contentType/)
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })
})

describe('the plan limit is enforced on new items only', () => {
  it('a plan with no workspace storage is refused before counting', async () => {
    mocks.authenticate.mockImplementation(async () => account({ itemLimit: 0 }))
    const response = await handler(event({ action: 'case.save', item: aCase }), {})
    expect(response.statusCode).toBe(403)
    expect(errorOf(response).message).toBe('Your plan does not include workspace storage.')
    expect(mocks.supabaseCount).not.toHaveBeenCalled()
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })

  it('the combined count of cases, notes and conversations is what hits the ceiling', async () => {
    mocks.authenticate.mockImplementation(async () => account({ itemLimit: 5 }))
    mocks.supabaseCount.mockImplementation(async (table) => (table === 'cases' ? 2 : table === 'notes' ? 2 : 1))
    const response = await handler(event({ action: 'case.save', item: aCase }), {})
    expect(response.statusCode).toBe(422)
    expect(errorOf(response).message).toBe('Workspace limit reached (5 items). Archive or delete an item first.')
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })

  it('one spare slot is still writable', async () => {
    mocks.authenticate.mockImplementation(async () => account({ itemLimit: 5 }))
    mocks.supabaseCount.mockImplementation(async (table) => (table === 'cases' ? 2 : table === 'notes' ? 2 : 0))
    const response = await handler(event({ action: 'note.save', item: aNote }), {})
    expect(response.statusCode).toBe(200)
    expect(inserted('notes')).toHaveLength(1)
  })

  it('editing an existing item never pays the budget', async () => {
    mocks.authenticate.mockImplementation(async () => account({ itemLimit: 1 }))
    mocks.supabaseSelectAs.mockImplementation(async () => [{ id: OWN_CASE, user_id: CALLER }])
    const response = await handler(event({ action: 'case.save', item: { ...aCase, id: OWN_CASE } }), {})
    expect(response.statusCode).toBe(200)
    expect(mocks.supabaseCount).not.toHaveBeenCalled()
  })

  it('archived rows are not counted against the limit, so archiving really frees space', async () => {
    await handler(event({ action: 'conversation.save', item: aConversation }), {})
    for (const entry of counts()) expect(entry.filter).toContain('archived_at=is.null')
  })

  it('feedback is not a workspace item and is never budget-checked', async () => {
    mocks.authenticate.mockImplementation(async () => account({ itemLimit: 0 }))
    const response = await handler(event({ action: 'feedback.submit', item: { contentType: 'news', contentId: 'x', reason: 'other' } }), {})
    expect(response.statusCode).toBe(200)
    expect(mocks.supabaseCount).not.toHaveBeenCalled()
  })
})

describe('what the response is allowed to reveal', () => {
  it('overview returns the caller’s own plan, usage and trial, and only six of each list', async () => {
    const response = await handler(event({ action: 'overview' }), {})
    const body = payload(response)
    expect(body.plan).toBe('standard')
    expect(body.usageToday).toBe(3)
    expect(body.dailyAiLimit).toBe(20)
    for (const query of selects()) {
      expect(query.query).toContain('archived_at=is.null')
      expect(query.query).toContain('limit=6')
    }
  })

  it('the conversation list selects metadata only, never the message bodies', async () => {
    await handler(event({ action: 'conversation.list' }), {})
    const query = selects()[0]?.query ?? ''
    expect(query).toContain('select=id,title,provider,model,created_at,updated_at,archived_at')
    expect(query).not.toContain('content')
  })

  it('a list hides archived rows unless the caller asks for them', async () => {
    await handler(event({ action: 'case.list' }), {})
    expect(selects()[0]?.query).toContain('archived_at=is.null')
    expect(selects()[0]?.query).toContain('limit=200')

    mocks.supabaseSelectAs.mockClear()
    await handler(event({ action: 'case.list', includeArchived: true }), {})
    expect(selects()[0]?.query).not.toContain('archived_at=is.null')
  })

  it('notes list the caller’s own rows and honour the same archive switch', async () => {
    await handler(event({ action: 'note.list', includeArchived: true }), {})
    expect(selects()[0]?.table).toBe('notes')
    expect(selects()[0]?.query).not.toContain('archived_at=is.null')
    expect(selects()[0]?.query).toContain(ownerFilter)
  })

  it('the conversation list caps at 100 and orders newest first', async () => {
    await handler(event({ action: 'conversation.list' }), {})
    expect(selects()[0]?.query).toContain('order=updated_at.desc')
    expect(selects()[0]?.query).toContain('limit=100')
  })

  it('messages are read oldest first so a replay renders in order', async () => {
    mocks.supabaseSelectAs.mockImplementation(async (table) => (table === 'conversations' ? [{ id: OWN_CONVERSATION }] : []))
    await handler(event({ action: 'conversation.get', id: OWN_CONVERSATION }), {})
    expect(selects().find((entry) => entry.table === 'conversation_messages')?.query).toContain('order=created_at.asc')
  })
})

describe('the schema is the only thing a client gets to say', () => {
  it('refuses an action it does not know, and reaches no row helper', async () => {
    const response = await handler(event({ action: 'case.erase_everything' }), {})
    expect(response.statusCode).toBe(400)
    expect(errorOf(response).message).toMatch(/action/)
    expect(mocks.supabaseSelectAs).not.toHaveBeenCalled()
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })

  it('refuses a priority and a status outside their enumerations', async () => {
    for (const item of [{ ...aCase, priority: 'urgent' }, { ...aCase, status: 'wontfix' }]) {
      const response = await handler(event({ action: 'case.save', item }), {})
      expect(response.statusCode).toBe(400)
      expect(mocks.supabaseInsert).not.toHaveBeenCalled()
    }
  })

  it('applies the documented defaults instead of trusting absent fields', async () => {
    await handler(event({ action: 'case.save', item: { title: 'only a title' } }), {})
    expect(inserted('cases')[0]).toMatchObject({ category: 'other', priority: 'medium', status: 'open', environment: '', logs: '' })
  })

  it('refuses a note with more tags than the schema allows', async () => {
    const response = await handler(event({ action: 'note.save', item: { ...aNote, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) } }), {})
    expect(response.statusCode).toBe(400)
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })

  it('refuses a conversation longer than 100 messages', async () => {
    const messages = Array.from({ length: 101 }, (_, i) => ({ role: 'user', content: `m${i}` }))
    const response = await handler(event({ action: 'conversation.save', item: { ...aConversation, messages } }), {})
    expect(response.statusCode).toBe(400)
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })

  it('refuses a message role the enum does not know', async () => {
    const response = await handler(event({ action: 'conversation.save', item: { ...aConversation, messages: [{ role: 'moderator', content: 'x' }] } }), {})
    expect(response.statusCode).toBe(400)
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })

  it('names up to three problems at once so one round trip is enough to fix them', async () => {
    const response = await handler(event({ action: 'case.save', item: { title: 'ab', category: 'x'.repeat(80), priority: 'urgent', status: 'wontfix' } }), {})
    const issues = String(errorOf(response).message).split('; ')
    expect(issues.length).toBeLessThanOrEqual(3)
    expect(issues[0]).toMatch(/^item\./)
  })

  it('an empty message body is refused rather than stored', async () => {
    const response = await handler(event({ action: 'conversation.save', item: { ...aConversation, messages: [{ role: 'user', content: '' }] } }), {})
    expect(response.statusCode).toBe(400)
    expect(mocks.supabaseInsert).not.toHaveBeenCalled()
  })
})

describe('a write that the database refuses is not reported as a success', () => {
  it('a new case that comes back empty is an upstream failure', async () => {
    mocks.supabaseInsert.mockImplementation(async () => [])
    const response = await handler(event({ action: 'case.save', item: aCase }), {})
    expect(response.statusCode).toBe(502)
    expect(errorOf(response).message).toBe('The case could not be saved.')
  })

  it('a conversation parent that comes back empty is an upstream failure, and no messages are written', async () => {
    mocks.supabaseInsert.mockImplementation(async (table, rows) => (table === 'conversations' ? [] : (rows as unknown[])))
    const response = await handler(event({ action: 'conversation.save', item: aConversation }), {})
    expect(response.statusCode).toBe(502)
    expect(errorOf(response).message).toBe('The conversation could not be saved.')
    expect(inserted('conversation_messages')).toHaveLength(0)
  })

  it('the trailing Unknown-action throw is unreachable, because the union rejects it first', async () => {
    const response = await handler(event({ action: 'overview', unexpected: true }), {})
    expect(response.statusCode).toBe(200)
    expect(errorOf(response).message).not.toBe('Unknown workspace action.')
  })
})
