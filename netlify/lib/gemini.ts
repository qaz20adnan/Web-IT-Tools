import { createHash } from 'node:crypto'
import { geminiSettings } from './env'
import { fetchText, mapUpstreamStatus } from './fetch'
import { HttpError } from './http'
import { validateAiEndpoint } from './host'

export interface ResearchSource {
  url: string
  title: string
  host: string
}

export interface GroundedResearch {
  content: string
  model: string
  /** True only when the search tool actually ran and returned grounded content. */
  searchUsed: boolean
  queries: string[]
  sources: ResearchSource[]
  /** Billable grounding requests reported by the API for this answer. */
  searchRequests: number
  totalTokens: number | null
  elapsedMs: number
  incomplete: boolean
}

const MAX_RESPONSE_BYTES = 6 * 1024 * 1024
const MAX_SOURCES = 12
const MAX_QUERIES = 8

function requireConfiguration(): ReturnType<typeof geminiSettings> {
  const settings = geminiSettings()
  if (!settings.apiKey) {
    throw new HttpError(503, 'not_configured', 'Live web research is not configured on this deployment.')
  }
  if (!settings.webSearchEnabled) {
    throw new HttpError(503, 'not_configured', 'Live web research is switched off for this deployment (GEMINI_WEB_SEARCH_ENABLED is not true).')
  }
  return settings
}

/** True when a grounded research request can actually run right now. */
export function researchReady(): boolean {
  const settings = geminiSettings()
  return Boolean(settings.apiKey) && settings.webSearchEnabled
}

const FRESH_NEEDLES = [
  /latest/i,
  /current version/i,
  /this (year|month|week)/i,
  /recent/i,
  /update[sd]? (roll|released|available)|security update/i,
  /cve-\d{4}-\d{4,}/i,
  /\bnews\b/i,
  /\bprice\b/i,
  /اليوم|هذه الأيام|أحدث|آخر تحديث|هذا العام|إصدار/i,
  /خطأ|رمز الخطأ|error code|event id|0x[0-9a-f]{6,8}/i,
]

/**
 * Heuristic used only for `webSearch: 'auto'`: it may add a search, it never
 * removes one that the user asked for explicitly.
 */
export function needsLiveSearch(question: string): boolean {
  const text = question.slice(0, 4000)
  return FRESH_NEEDLES.some((pattern) => pattern.test(text))
}

function interactionEndpoint(baseUrl: string): string {
  return `${baseUrl}/interactions`
}

function textPart(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Only URLs the provider actually returned are kept. Anything that is not an
 * absolute http(s) URL, or that repeats an earlier citation, is dropped so the
 * UI can never show a fabricated source.
 */
function toSource(value: unknown): ResearchSource | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const raw = typeof record.url === 'string' ? record.url.trim() : ''
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const title = (typeof record.title === 'string' ? record.title : '').trim().slice(0, 200)
  return { url: url.toString().slice(0, 2048), title: title || url.hostname.replace(/^www\./, ''), host: url.hostname.replace(/^www\./, '') }
}

function dedupeSources(items: unknown[]): ResearchSource[] {
  const seen = new Set<string>()
  const sources: ResearchSource[] = []
  for (const item of items) {
    const source = toSource(item)
    if (!source) continue
    const key = source.url.replace(/[&?].*$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    sources.push(source)
    if (sources.length >= MAX_SOURCES) break
  }
  return sources
}

function collectStrings(value: unknown, limit = MAX_QUERIES): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => textPart(entry).trim())
    .filter(Boolean)
    .slice(0, limit)
}

interface ParsedInteraction {
  content: string
  sources: ResearchSource[]
  queries: string[]
  searchUsed: boolean
  searchRequests: number
  totalTokens: number | null
  incomplete: boolean
}

/**
 * Reads the Interactions API response: `steps[]` carries the search call, the
 * search result and the model output whose text blocks hold `url_citation`
 * annotations. Kept pure so tests can pin the contract without a live key.
 */
export function parseInteractionResponse(payload: unknown): ParsedInteraction {
  const root = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>
  const steps = Array.isArray(root.steps) ? root.steps : []
  const textBlocks: string[] = []
  const citations: unknown[] = []
  const queries: string[] = []
  let sawSearchCall = false
  let searchErrored = false

  for (const entry of steps) {
    if (!entry || typeof entry !== 'object') continue
    const step = entry as Record<string, unknown>
    if (step.type === 'google_search_call') {
      sawSearchCall = true
      const args = (step.arguments && typeof step.arguments === 'object' ? step.arguments : {}) as Record<string, unknown>
      for (const query of collectStrings(args.queries)) {
        if (!queries.includes(query)) queries.push(query)
      }
    }
    if (step.type === 'google_search_result' && step.is_error === true) searchErrored = true
    if (step.type === 'model_output') {
      const blocks = Array.isArray(step.content) ? step.content : []
      for (const block of blocks) {
        if (!block || typeof block !== 'object') continue
        const record = block as Record<string, unknown>
        const text = textPart(record.text)
        if (text.trim()) textBlocks.push(text)
        if (Array.isArray(record.annotations)) citations.push(...record.annotations)
      }
    }
  }

  const usage = (root.usage && typeof root.usage === 'object' ? root.usage : {}) as Record<string, unknown>
  let searchRequests = 0
  const grounded = Array.isArray(usage.grounding_tool_count) ? usage.grounding_tool_count : []
  for (const entry of grounded) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (record.type === 'google_search' && typeof record.count === 'number' && Number.isFinite(record.count)) {
      searchRequests += Math.max(0, Math.floor(record.count))
    }
  }
  const status = textPart(root.status)
  const totalTokens = typeof usage.total_tokens === 'number' && Number.isFinite(usage.total_tokens) ? usage.total_tokens : null

  return {
    content: textBlocks.join('\n\n').trim(),
    sources: dedupeSources(citations),
    queries: queries.slice(0, MAX_QUERIES),
    searchUsed: (sawSearchCall || searchRequests > 0) && !searchErrored,
    searchRequests: searchRequests || (sawSearchCall ? Math.max(1, queries.length) : 0),
    totalTokens,
    incomplete: status === 'incomplete' || status === 'failed' || status === 'cancelled',
  }
}

const cache = new Map<string, { expiresAt: number; value: ParsedInteraction }>()

function cacheKey(model: string, system: string, turns: Array<{ role: string; content: string }>): string {
  return createHash('sha256').update(JSON.stringify({ model, system, turns })).digest('hex')
}

function readCache(key: string, ttlMs: number): ParsedInteraction | null {
  if (ttlMs <= 0) return null
  const hit = cache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key)
    return null
  }
  return hit.value
}

function writeCache(key: string, ttlMs: number, value: ParsedInteraction): void {
  if (ttlMs <= 0) return
  if (cache.size > 200) {
    const now = Date.now()
    for (const [entryKey, entry] of cache) if (entry.expiresAt <= now) cache.delete(entryKey)
    if (cache.size > 200) cache.clear()
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, value })
}

export function clearResearchCache(): void {
  cache.clear()
}

/**
 * One grounded request to the documented Interactions endpoint. The conversation
 * is replayed statelessly (`store: false`) so nothing is retained server side.
 */
export async function runGroundedResearch(input: {
  system: string
  turns: Array<{ role: 'user' | 'model'; content: string }>
}): Promise<GroundedResearch> {
  const settings = requireConfiguration()
  const started = Date.now()
  const key = cacheKey(settings.model, input.system, input.turns)
  const cached = readCache(key, settings.cacheTtlMs)
  if (cached) {
    return {
      ...cached,
      model: settings.model,
      elapsedMs: Date.now() - started,
      searchRequests: cached.searchRequests,
    }
  }

  await validateAiEndpoint(interactionEndpoint(settings.baseUrl))

  const body = {
    model: settings.model,
    system_instruction: input.system,
    input: input.turns.map((turn) => ({ role: turn.role, parts: [{ text: turn.content }] })),
    tools: [{ type: 'google_search' }],
    generation_config: { max_output_tokens: Math.min(settings.maxOutputTokens, 8192), temperature: 0.3 },
    store: false,
  }

  let response: Awaited<ReturnType<typeof fetchText>>
  try {
    response = await fetchText(interactionEndpoint(settings.baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': settings.apiKey },
      body: JSON.stringify(body),
      timeoutMs: settings.timeoutMs,
      maxBytes: MAX_RESPONSE_BYTES,
    })
  } catch (error) {
    if (error instanceof HttpError && error.code === 'timeout') {
      throw new HttpError(504, 'timeout', 'Live web research timed out. No fabricated answer was returned.')
    }
    throw error
  }
  if (!response.ok) {
    throw mapUpstreamStatus(response.status, response.text.slice(0, 300), settings.apiKey)
  }

  let payload: unknown
  try {
    payload = JSON.parse(response.text)
  } catch {
    throw new HttpError(502, 'upstream_error', 'The research provider returned a non-JSON response.')
  }

  const parsed = parseInteractionResponse(payload)
  if (!parsed.content) {
    if (parsed.incomplete) throw new HttpError(502, 'upstream_error', 'The research provider returned an incomplete answer.')
    throw new HttpError(502, 'upstream_error', 'The research provider returned an empty response.')
  }
  writeCache(key, settings.cacheTtlMs, parsed)

  return {
    content: parsed.content,
    model: settings.model,
    searchUsed: parsed.searchUsed,
    queries: parsed.queries,
    sources: parsed.sources,
    searchRequests: parsed.searchRequests,
    totalTokens: parsed.totalTokens,
    elapsedMs: Date.now() - started,
    incomplete: parsed.incomplete,
  }
}

export function researchStatus(): { configured: boolean; webSearchEnabled: boolean; model: string } {
  const settings = geminiSettings()
  return {
    configured: Boolean(settings.apiKey),
    webSearchEnabled: settings.webSearchEnabled,
    model: settings.model,
  }
}
