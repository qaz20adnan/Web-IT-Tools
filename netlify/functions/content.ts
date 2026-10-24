import { json, requireMethod, wrap, type Handler } from '../lib/http'
import { supabasePublicConfigured, supabaseSelect } from '../lib/supabase'

export const handler: Handler = wrap(async (event) => {
  requireMethod(event, ['GET'])
  if (!supabasePublicConfigured()) {
    return json(200, { items: [], source: 'none' })
  }
  const limit = Math.min(Math.max(Number(event.queryStringParameters?.limit ?? '100') || 100, 1), 200)
  const items = await supabaseSelect<Record<string, unknown>>(
    'articles',
    `select=*&order=updated_at.desc&limit=${limit}`,
  )
  return json(200, { items, source: 'supabase' })
})
