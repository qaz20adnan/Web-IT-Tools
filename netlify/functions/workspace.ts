import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { authenticate, countOwned, requireVerified, writeAudit, type AuthAccount } from '../lib/auth'
import { HttpError, json, readJsonBody, requireMethod, wrap, type Handler } from '../lib/http'
import { supabaseDeleteWhere, supabaseInsert, supabaseSelectAs, supabaseUpdate } from '../lib/supabase'

const idSchema = z.string().uuid()

const caseSchema = z.object({
  id: idSchema.optional(),
  title: z.string().trim().min(3).max(200),
  category: z.string().trim().max(60).default('other'),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  status: z.enum(['open', 'investigating', 'resolved', 'closed']).default('open'),
  environment: z.string().max(4000).default(''),
  symptoms: z.string().max(20000).default(''),
  logs: z.string().max(60000).default(''),
  causes: z.string().max(20000).default(''),
  tests: z.string().max(20000).default(''),
  fixes: z.string().max(20000).default(''),
  resolution: z.string().max(20000).default(''),
  lessons: z.string().max(20000).default(''),
})

const noteSchema = z.object({
  id: idSchema.optional(),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(50000).default(''),
  tags: z.array(z.string().max(40)).max(20).default([]),
})

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(40000),
})

const conversationSchema = z.object({
  id: idSchema.optional(),
  title: z.string().trim().min(1).max(200),
  provider: z.string().max(60).default(''),
  model: z.string().max(200).default(''),
  messages: z.array(messageSchema).max(100).default([]),
})

const feedbackSchema = z.object({
  contentType: z.enum(['article', 'script', 'news', 'tool', 'page']),
  contentId: z.string().trim().min(1).max(200),
  reason: z.enum(['outdated', 'broken-link', 'unclear', 'unsafe', 'other']),
  message: z.string().trim().max(2000).default(''),
})

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('overview') }),
  z.object({ action: z.literal('case.list'), includeArchived: z.boolean().optional() }),
  z.object({ action: z.literal('case.get'), id: idSchema }),
  z.object({ action: z.literal('case.save'), item: caseSchema }),
  z.object({ action: z.literal('case.archive'), id: idSchema }),
  z.object({ action: z.literal('case.restore'), id: idSchema }),
  z.object({ action: z.literal('case.delete'), id: idSchema }),
  z.object({ action: z.literal('note.list'), includeArchived: z.boolean().optional() }),
  z.object({ action: z.literal('note.save'), item: noteSchema }),
  z.object({ action: z.literal('note.delete'), id: idSchema }),
  z.object({ action: z.literal('conversation.list') }),
  z.object({ action: z.literal('conversation.get'), id: idSchema }),
  z.object({ action: z.literal('conversation.save'), item: conversationSchema }),
  z.object({ action: z.literal('conversation.rename'), id: idSchema, title: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal('conversation.delete'), id: idSchema }),
  z.object({ action: z.literal('feedback.submit'), item: feedbackSchema }),
])

type WorkspaceBody = z.infer<typeof actionSchema>

function requireWorkspace(account: AuthAccount): void {
  requireVerified(account)
  if (!account.entitlements.features.workspace) {
    throw new HttpError(403, 'forbidden', 'The private workspace is not available on this plan or account status.')
  }
}

async function assertItemBudget(account: AuthAccount): Promise<void> {
  const limit = account.entitlements.workspaceItemLimit
  if (limit <= 0) throw new HttpError(403, 'forbidden', 'Your plan does not include workspace storage.')
  const [cases, notes, conversations] = await Promise.all([
    countOwned('cases', account.profile.id, 'archived_at=is.null'),
    countOwned('notes', account.profile.id, 'archived_at=is.null'),
    countOwned('conversations', account.profile.id, 'archived_at=is.null'),
  ])
  if (cases + notes + conversations >= limit) {
    throw new HttpError(422, 'invalid_input', `Workspace limit reached (${limit} items). Archive or delete an item first.`)
  }
}

async function ownedCase(account: AuthAccount, id: string): Promise<Record<string, unknown>> {
  const rows = await supabaseSelectAs<Record<string, unknown>>(
    'cases',
    `select=*&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(account.profile.id)}&limit=1`,
  )
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Case not found.')
  return rows[0]
}

async function ownedConversation(account: AuthAccount, id: string): Promise<Record<string, unknown>> {
  const rows = await supabaseSelectAs<Record<string, unknown>>(
    'conversations',
    `select=*&id=eq.${encodeURIComponent(id)}&user_id=eq.${encodeURIComponent(account.profile.id)}&limit=1`,
  )
  if (!rows[0]) throw new HttpError(404, 'not_found', 'Conversation not found.')
  return rows[0]
}

export const handler: Handler = wrap(async (event) => {
  requireMethod(event, ['POST'])
  const account = await authenticate(event)
  requireWorkspace(account)
  const userId = account.profile.id
  const parsed = actionSchema.safeParse(readJsonBody<WorkspaceBody>(event, 512 * 1024))
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
  }
  const body = parsed.data
  const uidFilter = `user_id=eq.${encodeURIComponent(userId)}`

  if (body.action === 'overview') {
    const [cases, notes, conversations] = await Promise.all([
      supabaseSelectAs<Record<string, unknown>>('cases', `select=*&${uidFilter}&archived_at=is.null&order=updated_at.desc&limit=6`),
      supabaseSelectAs<Record<string, unknown>>('notes', `select=*&${uidFilter}&archived_at=is.null&order=updated_at.desc&limit=6`),
      supabaseSelectAs<Record<string, unknown>>('conversations', `select=*&${uidFilter}&archived_at=is.null&order=updated_at.desc&limit=6`),
    ])
    return json(200, {
      ok: true,
      plan: account.entitlements.plan,
      usageToday: account.usageToday,
      dailyAiLimit: account.entitlements.dailyAiLimit,
      trial: account.trial,
      recentCases: cases,
      recentNotes: notes,
      recentConversations: conversations,
    })
  }

  if (body.action === 'case.list') {
    const archived = body.includeArchived ? '' : '&archived_at=is.null'
    const items = await supabaseSelectAs<Record<string, unknown>>(
      'cases',
      `select=*&${uidFilter}${archived}&order=updated_at.desc&limit=200`,
    )
    return json(200, { ok: true, items })
  }

  if (body.action === 'case.get') {
    return json(200, { ok: true, item: await ownedCase(account, body.id) })
  }

  if (body.action === 'case.save') {
    const item = body.item
    if (item.id) {
      await ownedCase(account, item.id)
    } else {
      await assertItemBudget(account)
    }
    const now = new Date().toISOString()
    if (item.id) {
      const updated = await supabaseUpdate<Record<string, unknown>>(
        'cases',
        `id=eq.${encodeURIComponent(item.id)}&${uidFilter}`,
        { ...item, updated_at: now, archived_at: null },
      )
      if (!updated[0]) throw new HttpError(404, 'not_found', 'Case not found.')
      return json(200, { ok: true, item: updated[0] })
    }
    const rows = await supabaseInsert<Record<string, unknown>>('cases', [
      { id: randomUUID(), user_id: userId, ...item, created_at: now, updated_at: now },
    ])
    if (!rows[0]) throw new HttpError(502, 'upstream_error', 'The case could not be saved.')
    return json(200, { ok: true, item: rows[0] })
  }

  if (body.action === 'case.archive' || body.action === 'case.restore') {
    await ownedCase(account, body.id)
    const updated = await supabaseUpdate<Record<string, unknown>>(
      'cases',
      `id=eq.${encodeURIComponent(body.id)}&${uidFilter}`,
      { archived_at: body.action === 'case.archive' ? new Date().toISOString() : null, updated_at: new Date().toISOString() },
    )
    return json(200, { ok: true, item: updated[0] ?? null })
  }

  if (body.action === 'case.delete') {
    await ownedCase(account, body.id)
    await supabaseDeleteWhere('cases', `id=eq.${encodeURIComponent(body.id)}&${uidFilter}`)
    await writeAudit({
      actorId: userId,
      actorEmail: account.profile.email,
      action: 'workspace.case_delete',
      targetType: 'case',
      targetId: body.id,
      outcome: 'success',
    })
    return json(200, { ok: true, deleted: true })
  }

  if (body.action === 'note.list') {
    const archived = body.includeArchived ? '' : '&archived_at=is.null'
    const items = await supabaseSelectAs<Record<string, unknown>>(
      'notes',
      `select=*&${uidFilter}${archived}&order=updated_at.desc&limit=200`,
    )
    return json(200, { ok: true, items })
  }

  if (body.action === 'note.save') {
    const item = body.item
    const now = new Date().toISOString()
    if (item.id) {
      const updated = await supabaseUpdate<Record<string, unknown>>(
        'notes',
        `id=eq.${encodeURIComponent(item.id)}&${uidFilter}`,
        { ...item, updated_at: now },
      )
      if (!updated[0]) throw new HttpError(404, 'not_found', 'Note not found.')
      return json(200, { ok: true, item: updated[0] })
    }
    await assertItemBudget(account)
    const rows = await supabaseInsert<Record<string, unknown>>('notes', [
      { id: randomUUID(), user_id: userId, ...item, created_at: now, updated_at: now },
    ])
    return json(200, { ok: true, item: rows[0] ?? null })
  }

  if (body.action === 'note.delete') {
    const rows = await supabaseSelectAs<Record<string, unknown>>('notes', `select=id&id=eq.${encodeURIComponent(body.id)}&${uidFilter}&limit=1`)
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Note not found.')
    await supabaseDeleteWhere('notes', `id=eq.${encodeURIComponent(body.id)}&${uidFilter}`)
    return json(200, { ok: true, deleted: true })
  }

  if (body.action === 'conversation.list') {
    const items = await supabaseSelectAs<Record<string, unknown>>(
      'conversations',
      `select=id,title,provider,model,created_at,updated_at,archived_at&${uidFilter}&archived_at=is.null&order=updated_at.desc&limit=100`,
    )
    return json(200, { ok: true, items })
  }

  if (body.action === 'conversation.get') {
    const conversation = await ownedConversation(account, body.id)
    const messages = await supabaseSelectAs<Record<string, unknown>>(
      'conversation_messages',
      `select=id,role,content,created_at&conversation_id=eq.${encodeURIComponent(body.id)}&${uidFilter}&order=created_at.asc&limit=200`,
    )
    return json(200, { ok: true, item: conversation, messages })
  }

  if (body.action === 'conversation.save') {
    const item = body.item
    const now = new Date().toISOString()
    let conversationId = item.id
    if (!conversationId) {
      await assertItemBudget(account)
      conversationId = randomUUID()
      const rows = await supabaseInsert<Record<string, unknown>>('conversations', [
        {
          id: conversationId,
          user_id: userId,
          title: item.title,
          provider: item.provider,
          model: item.model,
          created_at: now,
          updated_at: now,
        },
      ])
      if (!rows[0]) throw new HttpError(502, 'upstream_error', 'The conversation could not be saved.')
    } else {
      await ownedConversation(account, conversationId)
      await supabaseUpdate<Record<string, unknown>>(
        'conversations',
        `id=eq.${encodeURIComponent(conversationId)}&${uidFilter}`,
        { title: item.title, provider: item.provider, model: item.model, updated_at: now },
      )
      await supabaseDeleteWhere(
        'conversation_messages',
        `conversation_id=eq.${encodeURIComponent(conversationId)}&${uidFilter}`,
      )
    }
    if (item.messages.length > 0) {
      await supabaseInsert<Record<string, unknown>>(
        'conversation_messages',
        item.messages.map((message) => ({
          id: randomUUID(),
          conversation_id: conversationId,
          user_id: userId,
          role: message.role,
          content: message.content,
          created_at: now,
        })),
      )
    }
    return json(200, { ok: true, id: conversationId })
  }

  if (body.action === 'conversation.rename') {
    await ownedConversation(account, body.id)
    const updated = await supabaseUpdate<Record<string, unknown>>(
      'conversations',
      `id=eq.${encodeURIComponent(body.id)}&${uidFilter}`,
      { title: body.title, updated_at: new Date().toISOString() },
    )
    return json(200, { ok: true, item: updated[0] ?? null })
  }

  if (body.action === 'conversation.delete') {
    await ownedConversation(account, body.id)
    await supabaseDeleteWhere('conversation_messages', `conversation_id=eq.${encodeURIComponent(body.id)}&${uidFilter}`)
    await supabaseDeleteWhere('conversations', `id=eq.${encodeURIComponent(body.id)}&${uidFilter}`)
    return json(200, { ok: true, deleted: true })
  }

  if (body.action === 'feedback.submit') {
    const rows = await supabaseInsert<Record<string, unknown>>('content_feedback', [
      {
        id: randomUUID(),
        user_id: userId,
        content_type: body.item.contentType,
        content_id: body.item.contentId,
        reason: body.item.reason,
        message: body.item.message,
        status: 'open',
        created_at: new Date().toISOString(),
      },
    ])
    return json(200, { ok: true, item: rows[0] ?? null })
  }

  throw new HttpError(400, 'invalid_input', 'Unknown workspace action.')
})
