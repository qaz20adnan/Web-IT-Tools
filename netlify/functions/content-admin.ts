import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { serverConfig } from '../lib/env'
import { HttpError, json, readJsonBody, requireMethod, wrap, header, type Handler } from '../lib/http'
import { supabaseAdminConfigured, supabaseDelete, supabaseSelect, supabaseUpsert } from '../lib/supabase'
import { MAX_BODY_BYTES } from '../../shared/upload-limits'

const articleSchema = z.object({
  id: z.string().trim().min(1).max(120),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9-]+$/),
  title_en: z.string().min(1).max(300),
  title_ar: z.string().min(1).max(300),
  summary_en: z.string().min(1).max(2000),
  summary_ar: z.string().min(1).max(2000),
  body_en: z.string().min(1).max(100000),
  body_ar: z.string().min(1).max(100000),
  domain: z.enum(['windows-client', 'windows-server', 'printing', 'microsoft-365', 'networking', 'linux', 'cybersecurity', 'datacenter', 'backup-dr', 'cloud-devops', 'other']),
  tags: z.array(z.string().max(60)).max(30).default([]),
  product_version: z.string().max(120).default('all'),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
  verification: z.enum(['draft', 'ai-generated', 'source-verified', 'syntax-checked', 'lab-tested', 'production-validated']).default('draft'),
  author: z.string().max(120).default('editorial'),
  sources: z.array(z.object({ title: z.string().max(300), url: z.string().url().max(1000), publisher: z.string().max(200).optional(), retrievedAt: z.string().max(60).optional() })).max(20).default([]),
  related_script_ids: z.array(z.string().max(120)).max(20).default([]),
})

const payloadSchema = z.object({ items: z.array(articleSchema).min(1).max(50) })

function authorize(event: Parameters<Handler>[0]): void {
  if (!serverConfig.contentAdminToken) {
    throw new HttpError(503, 'not_configured', 'CONTENT_ADMIN_TOKEN is not configured on the server.')
  }
  const supplied = (header(event, 'authorization') ?? '').replace(/^Bearer\s+/i, '')
  const expected = Buffer.from(serverConfig.contentAdminToken)
  const actual = Buffer.from(supplied)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new HttpError(401, 'invalid_key', 'Invalid content admin token.')
  }
  if (!supabaseAdminConfigured()) {
    throw new HttpError(503, 'not_configured', 'Supabase service role credentials are not configured.')
  }
}

export const handler: Handler = wrap(async (event) => {
  requireMethod(event, ['GET', 'POST', 'DELETE'])
  authorize(event)

  if (event.httpMethod === 'GET') {
    const items = await supabaseSelect<Record<string, unknown>>('articles', 'select=*&order=updated_at.desc&limit=200')
    return json(200, { items, source: 'supabase' })
  }

  if (event.httpMethod === 'DELETE') {
    const id = event.queryStringParameters?.id?.trim()
    if (!id) throw new HttpError(400, 'invalid_input', 'A content id query parameter is required.')
    await supabaseDelete('articles', id)
    return json(200, { ok: true, id })
  }

  const parsed = payloadSchema.safeParse(readJsonBody(event, MAX_BODY_BYTES))
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '))
  }
  const rows = parsed.data.items.map((item) => ({
    ...item,
    updated_at: new Date().toISOString(),
  }))
  const saved = await supabaseUpsert('articles', rows)
  return json(200, { ok: true, items: saved })
})
